/**
 * Portable SKILL.md installer example.
 *
 * SECURITY NOTE: This is an example flow. Do not use as-is in production
 * without environment-specific hardening (egress policy, authz, secret management).
 *
 * This example publishes two skills:
 * 1) an installer skill (`portable_verified_skill_installer`)
 * 2) a target skill (`verified_web_research`)
 *
 * Then it simulates an OpenClaw agent that:
 * - fetches installer metadata from chain,
 * - verifies installer SKILL.md bytes and hash,
 * - installs local helper tools (fetch + verify),
 * - fetches target skill metadata from chain,
 * - downloads + verifies target SKILL.md using installed tools,
 * - installs/exports for Codex, Claude Code, ChatGPT, and Claude.
 *
 * Run:
 *   npx tsx examples/skill-md-portable-installer-example.ts
 *
 * Required env:
 *   RPC_URL
 *   PRIVATE_KEY (or AGENT_PRIVATE_KEY)
 *   PINATA_JWT
 *
 * Optional env:
 *   CHAIN_ID (defaults to 11155111 / Sepolia)
 *   CODEX_HOME (for codex install target)
 *   CLAUDE_CODE_SKILLS_DIR (for claude-code install target)
 */

import './_env.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { hexToString } from 'viem';
import {
  SDK,
  IDENTITY_REGISTRY_ABI,
  IPFS_GATEWAYS,
  parseAgentId,
  type AgentId,
  type IPFSClient,
} from '../src/index.js';

const execFileAsync = promisify(execFile);

type PortableRuntime = 'codex' | 'claude-code' | 'chatgpt' | 'claude';
type SkillRole = 'installer' | 'target';

type PublishedSkill = {
  agentId: AgentId;
  registrationUri?: string;
  skillName: string;
  skillVersion: string;
  role: SkillRole;
  skillUri: string;
  skillSha256: string;
};

type SkillDescriptorFromChain = {
  skillAgentId: AgentId;
  tokenUri: string;
  skillUri: string;
  expectedSha256: string;
  hashAlgorithm: string;
  skillName: string;
  skillVersion: string;
  role: SkillRole | string;
};

type InstalledSkillRecord = {
  descriptor: SkillDescriptorFromChain;
  localPath: string;
  verifiedHash: string;
  content: string;
};

const SKILL_METADATA_KEYS = {
  skillUri: 'portable.skill.uri',
  skillSha256: 'portable.skill.sha256',
  hashAlgorithm: 'portable.skill.hash_alg',
  skillName: 'portable.skill.name',
  skillVersion: 'portable.skill.version',
  role: 'portable.skill.role',
} as const;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RUNTIME_ROOT = path.join(__dirname, '.portable-skill-runtime');
const INSTALLER_SKILL_SOURCE = path.join(
  __dirname,
  'skills',
  'portable_verified_skill_installer',
  'SKILL.md'
);
const TARGET_SKILL_SOURCE = path.join(__dirname, 'skills', 'verified_web_research', 'SKILL.md');

function sha256HexUtf8(content: string): string {
  return `0x${createHash('sha256').update(content, 'utf8').digest('hex')}`;
}

function sanitizeForPath(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
}

async function fetchTextFromUri(uri: string, ipfsClient?: IPFSClient): Promise<string> {
  if (uri.startsWith('ipfs://')) {
    const cid = uri.slice('ipfs://'.length);
    if (!cid) throw new Error(`Invalid IPFS URI: ${uri}`);

    if (ipfsClient) {
      return ipfsClient.get(cid);
    }

    const errors: string[] = [];
    for (const gateway of IPFS_GATEWAYS) {
      const url = `${gateway}${cid}`;
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
        if (res.ok) return await res.text();
        errors.push(`${url} -> HTTP ${res.status}`);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        errors.push(`${url} -> ${msg}`);
      }
    }
    throw new Error(`Failed to fetch ${uri} from all gateways: ${errors.join(' | ')}`);
  }

  if (uri.startsWith('http://') || uri.startsWith('https://')) {
    const res = await fetch(uri, { signal: AbortSignal.timeout(12_000) });
    if (!res.ok) {
      throw new Error(`Failed to fetch ${uri}: HTTP ${res.status}`);
    }
    return await res.text();
  }

  throw new Error(`Unsupported URI scheme for skill source: ${uri}`);
}

async function readMetadataString(sdk: SDK, tokenId: number, key: string): Promise<string> {
  const raw = await sdk.chainClient.readContract<`0x${string}`>({
    address: sdk.identityRegistryAddress(),
    abi: IDENTITY_REGISTRY_ABI,
    functionName: 'getMetadata',
    args: [BigInt(tokenId), key],
  });

  if (!raw || raw === '0x') return '';
  return hexToString(raw);
}

async function readSkillDescriptorFromChain(
  sdk: SDK,
  skillAgentId: AgentId
): Promise<SkillDescriptorFromChain> {
  const { chainId, tokenId } = parseAgentId(skillAgentId);
  const currentChain = await sdk.chainId();
  if (chainId !== currentChain) {
    throw new Error(
      `Skill ${skillAgentId} is on chain ${chainId}, but SDK is configured for chain ${currentChain}`
    );
  }

  const tokenUri = await sdk.chainClient.readContract<string>({
    address: sdk.identityRegistryAddress(),
    abi: IDENTITY_REGISTRY_ABI,
    functionName: 'tokenURI',
    args: [BigInt(tokenId)],
  });

  const [skillUri, expectedSha256, hashAlgorithm, skillName, skillVersion, role] = await Promise.all([
    readMetadataString(sdk, tokenId, SKILL_METADATA_KEYS.skillUri),
    readMetadataString(sdk, tokenId, SKILL_METADATA_KEYS.skillSha256),
    readMetadataString(sdk, tokenId, SKILL_METADATA_KEYS.hashAlgorithm),
    readMetadataString(sdk, tokenId, SKILL_METADATA_KEYS.skillName),
    readMetadataString(sdk, tokenId, SKILL_METADATA_KEYS.skillVersion),
    readMetadataString(sdk, tokenId, SKILL_METADATA_KEYS.role),
  ]);

  if (!skillUri) throw new Error(`Missing metadata key "${SKILL_METADATA_KEYS.skillUri}"`);
  if (!expectedSha256) throw new Error(`Missing metadata key "${SKILL_METADATA_KEYS.skillSha256}"`);
  if (!hashAlgorithm || hashAlgorithm.toLowerCase() !== 'sha256') {
    throw new Error(`Unsupported hash algorithm "${hashAlgorithm}". Expected sha256.`);
  }

  return {
    skillAgentId,
    tokenUri,
    skillUri,
    expectedSha256,
    hashAlgorithm,
    skillName: skillName || `skill-${chainId}-${tokenId}`,
    skillVersion: skillVersion || '0.0.0',
    role: role || 'target',
  };
}

async function publishSkillEntity(params: {
  sdk: SDK;
  sourcePath: string;
  skillName: string;
  skillVersion: string;
  description: string;
  role: SkillRole;
}): Promise<PublishedSkill> {
  const { sdk } = params;
  if (!sdk.ipfsClient) {
    throw new Error('IPFS client is required (initialize SDK with ipfs config)');
  }

  const markdown = await fs.readFile(params.sourcePath, 'utf8');
  const skillSha256 = sha256HexUtf8(markdown);
  const skillCid = await sdk.ipfsClient.add(markdown, 'SKILL.md');
  const skillUri = `ipfs://${skillCid}`;

  const entity = sdk.createSkill(`${params.skillName}@${params.skillVersion}`, params.description);
  entity.setMetadata({
    [SKILL_METADATA_KEYS.skillUri]: skillUri,
    [SKILL_METADATA_KEYS.skillSha256]: skillSha256,
    [SKILL_METADATA_KEYS.hashAlgorithm]: 'sha256',
    [SKILL_METADATA_KEYS.skillName]: params.skillName,
    [SKILL_METADATA_KEYS.skillVersion]: params.skillVersion,
    [SKILL_METADATA_KEYS.role]: params.role,
  });
  entity.setProvenance({
    type: 'https://agent.town/schemas/provenance-v1',
    sources: [
      {
        kind: 'skill_markdown',
        url: skillUri,
        ref: `sha256:${skillSha256}`,
      },
    ],
    publisher: {
      name: 'Portable Skill Installer Example',
      statement: 'Skill bytes are hash-pinned in on-chain metadata for verification.',
    },
  });
  entity.setActive(true);

  const tx = await entity.registerIPFS();
  const { result } = await tx.waitConfirmed();
  if (!result.agentId) {
    throw new Error(`Skill publish for ${params.skillName} returned no agentId`);
  }

  console.log(`[Publisher] ${params.role} skill published: ${result.agentId}`);
  console.log(`[Publisher] ${params.skillName} URI: ${skillUri}`);
  console.log(`[Publisher] ${params.skillName} SHA-256: ${skillSha256}`);

  return {
    agentId: result.agentId,
    registrationUri: result.agentURI,
    skillName: params.skillName,
    skillVersion: params.skillVersion,
    role: params.role,
    skillUri,
    skillSha256,
  };
}

class PortableInstallerAgent {
  private toolPaths?: { fetchToolPath: string; verifyToolPath: string; manifestPath: string };
  private installedSkills = new Map<string, InstalledSkillRecord>();

  constructor(
    private readonly sdk: SDK,
    private readonly name: string,
    private readonly runtimeRoot: string
  ) {}

  private async installLocalTools(): Promise<void> {
    const toolsDir = path.join(this.runtimeRoot, 'tools');
    await fs.mkdir(toolsDir, { recursive: true });

    const fetchToolPath = path.join(toolsDir, 'fetch-skill.mjs');
    const verifyToolPath = path.join(toolsDir, 'verify-skill.mjs');
    const manifestPath = path.join(toolsDir, 'install-manifest.json');
    const gatewaysLiteral = JSON.stringify([...IPFS_GATEWAYS]);

    const fetchToolSource = `#!/usr/bin/env node
import fs from 'node:fs/promises';

const gateways = ${gatewaysLiteral};

async function fetchText(uri) {
  if (uri.startsWith('ipfs://')) {
    const cid = uri.slice('ipfs://'.length);
    if (!cid) throw new Error('Invalid IPFS URI');
    const errors = [];
    for (const gateway of gateways) {
      const url = \`\${gateway}\${cid}\`;
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
        if (res.ok) return await res.text();
        errors.push(\`\${url} -> HTTP \${res.status}\`);
      } catch (error) {
        errors.push(\`\${url} -> \${error instanceof Error ? error.message : String(error)}\`);
      }
    }
    throw new Error(\`Failed to fetch \${uri} from all gateways: \${errors.join(' | ')}\`);
  }
  if (uri.startsWith('http://') || uri.startsWith('https://')) {
    const res = await fetch(uri, { signal: AbortSignal.timeout(12000) });
    if (!res.ok) throw new Error(\`HTTP \${res.status}\`);
    return await res.text();
  }
  throw new Error(\`Unsupported URI scheme: \${uri}\`);
}

async function main() {
  const [uri, outPath] = process.argv.slice(2);
  if (!uri || !outPath) {
    throw new Error('Usage: fetch-skill.mjs <uri> <output_path>');
  }
  const content = await fetchText(uri);
  await fs.writeFile(outPath, content, 'utf8');
  console.log(outPath);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
`;

    const verifyToolSource = `#!/usr/bin/env node
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';

async function main() {
  const [filePath] = process.argv.slice(2);
  if (!filePath) {
    throw new Error('Usage: verify-skill.mjs <file_path>');
  }
  const content = await fs.readFile(filePath, 'utf8');
  const hash = '0x' + createHash('sha256').update(content, 'utf8').digest('hex');
  console.log(hash);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
`;

    await fs.writeFile(fetchToolPath, fetchToolSource, 'utf8');
    await fs.writeFile(verifyToolPath, verifyToolSource, 'utf8');
    await fs.chmod(fetchToolPath, 0o755);
    await fs.chmod(verifyToolPath, 0o755);

    const manifest = {
      installedAt: new Date().toISOString(),
      tools: [
        { name: 'fetch-skill', path: fetchToolPath, version: '1.0.0' },
        { name: 'verify-skill', path: verifyToolPath, version: '1.0.0' },
      ],
    };
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

    this.toolPaths = { fetchToolPath, verifyToolPath, manifestPath };
    console.log(`[${this.name}] Installed local tooling at ${toolsDir}`);
  }

  private async ensureToolsInstalled(): Promise<void> {
    if (!this.toolPaths) {
      await this.installLocalTools();
    }
  }

  private async verifySkillWithBuiltInFetcher(
    descriptor: SkillDescriptorFromChain
  ): Promise<{ content: string; computedHash: string }> {
    const content = await fetchTextFromUri(descriptor.skillUri, this.sdk.ipfsClient);
    const computedHash = sha256HexUtf8(content);
    if (computedHash !== descriptor.expectedSha256) {
      throw new Error(
        `Hash mismatch for installer skill ${descriptor.skillAgentId}: expected ${descriptor.expectedSha256}, got ${computedHash}`
      );
    }
    return { content, computedHash };
  }

  private async verifySkillWithInstalledTools(
    descriptor: SkillDescriptorFromChain
  ): Promise<{ content: string; computedHash: string }> {
    await this.ensureToolsInstalled();

    const tools = this.toolPaths!;
    const tmpDir = path.join(this.runtimeRoot, 'tmp');
    await fs.mkdir(tmpDir, { recursive: true });

    const tempFile = path.join(
      tmpDir,
      `${sanitizeForPath(descriptor.skillName)}-${Date.now()}-downloaded-SKILL.md`
    );

    await execFileAsync(process.execPath, [tools.fetchToolPath, descriptor.skillUri, tempFile], {
      timeout: 30_000,
    });

    const verifyResult = await execFileAsync(process.execPath, [tools.verifyToolPath, tempFile], {
      timeout: 30_000,
    });
    const computedHash = verifyResult.stdout.trim();

    if (computedHash !== descriptor.expectedSha256) {
      throw new Error(
        `Hash mismatch for ${descriptor.skillAgentId}: expected ${descriptor.expectedSha256}, got ${computedHash}`
      );
    }

    const content = await fs.readFile(tempFile, 'utf8');
    return { content, computedHash };
  }

  private async writeInstallReceipt(params: {
    platform: PortableRuntime | 'bootstrap';
    descriptor: SkillDescriptorFromChain;
    computedHash: string;
    localPath: string;
  }): Promise<void> {
    const receiptPath = `${params.localPath}.install.json`;
    const receipt = {
      installedAt: new Date().toISOString(),
      runtime: params.platform,
      skillAgentId: params.descriptor.skillAgentId,
      tokenUri: params.descriptor.tokenUri,
      sourceUri: params.descriptor.skillUri,
      expectedHash: params.descriptor.expectedSha256,
      computedHash: params.computedHash,
      hashAlgorithm: params.descriptor.hashAlgorithm,
      verified: true,
    };
    await fs.writeFile(receiptPath, JSON.stringify(receipt, null, 2), 'utf8');
  }

  private async installForRuntime(params: {
    platform: PortableRuntime;
    descriptor: SkillDescriptorFromChain;
    content: string;
    computedHash: string;
  }): Promise<string> {
    const skillFolderName = sanitizeForPath(params.descriptor.skillName);

    if (params.platform === 'codex') {
      const codexHome = process.env.CODEX_HOME
        ? path.resolve(process.env.CODEX_HOME)
        : path.join(this.runtimeRoot, 'codex-home');
      const installDir = path.join(codexHome, 'skills', skillFolderName);
      await fs.mkdir(installDir, { recursive: true });
      const installPath = path.join(installDir, 'SKILL.md');
      await fs.writeFile(installPath, params.content, 'utf8');
      await this.writeInstallReceipt({
        platform: params.platform,
        descriptor: params.descriptor,
        computedHash: params.computedHash,
        localPath: installPath,
      });
      return installPath;
    }

    if (params.platform === 'claude-code') {
      const claudeCodeSkillsDir = process.env.CLAUDE_CODE_SKILLS_DIR
        ? path.resolve(process.env.CLAUDE_CODE_SKILLS_DIR)
        : path.join(this.runtimeRoot, 'claude-code', 'skills');
      const installDir = path.join(claudeCodeSkillsDir, skillFolderName);
      await fs.mkdir(installDir, { recursive: true });
      const installPath = path.join(installDir, 'SKILL.md');
      await fs.writeFile(installPath, params.content, 'utf8');
      await this.writeInstallReceipt({
        platform: params.platform,
        descriptor: params.descriptor,
        computedHash: params.computedHash,
        localPath: installPath,
      });
      return installPath;
    }

    const exportDir = path.join(this.runtimeRoot, 'portable-bundles', params.platform);
    await fs.mkdir(exportDir, { recursive: true });
    const bundlePath = path.join(exportDir, `${skillFolderName}.prompt.md`);
    const bundle = [
      `# Portable Skill Bundle (${params.platform})`,
      '',
      `- Skill agent id: \`${params.descriptor.skillAgentId}\``,
      `- Source URI: \`${params.descriptor.skillUri}\``,
      `- Verified SHA-256: \`${params.computedHash}\``,
      '',
      '## How To Use',
      'Copy the skill section below into your project/system instructions.',
      '',
      '## SKILL.md',
      '```md',
      params.content,
      '```',
    ].join('\n');
    await fs.writeFile(bundlePath, bundle, 'utf8');
    return bundlePath;
  }

  async installInstallerSkill(skillAgentId: AgentId): Promise<InstalledSkillRecord> {
    const descriptor = await readSkillDescriptorFromChain(this.sdk, skillAgentId);
    const { content, computedHash } = await this.verifySkillWithBuiltInFetcher(descriptor);

    const installerDir = path.join(this.runtimeRoot, 'bootstrap-installer', sanitizeForPath(descriptor.skillName));
    await fs.mkdir(installerDir, { recursive: true });
    const installerPath = path.join(installerDir, 'SKILL.md');
    await fs.writeFile(installerPath, content, 'utf8');

    await this.installLocalTools();
    await this.writeInstallReceipt({
      platform: 'bootstrap',
      descriptor,
      computedHash,
      localPath: installerPath,
    });

    const record: InstalledSkillRecord = {
      descriptor,
      localPath: installerPath,
      verifiedHash: computedHash,
      content,
    };
    this.installedSkills.set(descriptor.skillName, record);

    console.log(`[${this.name}] Installer skill verified and bootstrapped: ${descriptor.skillName}`);
    return record;
  }

  async installTargetSkill(params: {
    skillAgentId: AgentId;
    runtimes: PortableRuntime[];
  }): Promise<{ descriptor: SkillDescriptorFromChain; runtimeOutputs: Record<PortableRuntime, string> }> {
    const descriptor = await readSkillDescriptorFromChain(this.sdk, params.skillAgentId);
    const { content, computedHash } = await this.verifySkillWithInstalledTools(descriptor);

    const runtimeOutputs = {} as Record<PortableRuntime, string>;
    for (const runtime of params.runtimes) {
      runtimeOutputs[runtime] = await this.installForRuntime({
        platform: runtime,
        descriptor,
        content,
        computedHash,
      });
    }

    const defaultLocalPath = runtimeOutputs.codex || runtimeOutputs['claude-code'];
    const record: InstalledSkillRecord = {
      descriptor,
      localPath: defaultLocalPath,
      verifiedHash: computedHash,
      content,
    };
    this.installedSkills.set(descriptor.skillName, record);

    console.log(`[${this.name}] Target skill verified and installed: ${descriptor.skillName}`);
    return { descriptor, runtimeOutputs };
  }

  useSkill(skillName: string, task: string): string {
    const installed = this.installedSkills.get(skillName);
    if (!installed) {
      throw new Error(`Skill "${skillName}" is not installed`);
    }

    const snippet = installed.content.split('\n').slice(0, 14).join('\n');
    return [
      `Portable installer agent "${this.name}"`,
      `Task: ${task}`,
      `Using skill: ${skillName}@${installed.descriptor.skillVersion}`,
      `Verified hash: ${installed.verifiedHash}`,
      '',
      'Skill scaffold excerpt:',
      '---',
      snippet,
      '---',
    ].join('\n');
  }
}

async function main(): Promise<void> {
  const chainId = Number(process.env.CHAIN_ID ?? 11155111);
  const rpcUrl = process.env.RPC_URL;
  const privateKey = process.env.PRIVATE_KEY ?? process.env.AGENT_PRIVATE_KEY;
  const pinataJwt = process.env.PINATA_JWT;

  if (!rpcUrl || rpcUrl.trim() === '') {
    throw new Error('RPC_URL is required');
  }
  if (!privateKey || privateKey.trim() === '') {
    throw new Error('PRIVATE_KEY (or AGENT_PRIVATE_KEY) is required');
  }
  if (!pinataJwt || pinataJwt.trim() === '') {
    throw new Error('PINATA_JWT is required');
  }

  const publisherSdk = new SDK({
    chainId,
    rpcUrl,
    privateKey,
    ipfs: 'pinata',
    pinataJwt,
  });

  const installerSdk = new SDK({
    chainId,
    rpcUrl,
  });

  const installerSkill = await publishSkillEntity({
    sdk: publisherSdk,
    sourcePath: INSTALLER_SKILL_SOURCE,
    skillName: 'portable_verified_skill_installer',
    skillVersion: '1.0.0',
    role: 'installer',
    description:
      'Bootstraps local tooling and installs verified SKILL.md packages from chain metadata.',
  });

  const targetSkill = await publishSkillEntity({
    sdk: publisherSdk,
    sourcePath: TARGET_SKILL_SOURCE,
    skillName: 'verified_web_research',
    skillVersion: '1.0.0',
    role: 'target',
    description: 'Verifiable web research workflow skill package.',
  });

  const agent = new PortableInstallerAgent(installerSdk, 'portable-openclaw-installer', RUNTIME_ROOT);

  await agent.installInstallerSkill(installerSkill.agentId);

  const installResult = await agent.installTargetSkill({
    skillAgentId: targetSkill.agentId,
    runtimes: ['codex', 'claude-code', 'chatgpt', 'claude'],
  });

  console.log('\n[Portable] Runtime install/export outputs:');
  for (const runtime of ['codex', 'claude-code', 'chatgpt', 'claude'] as const) {
    console.log(`- ${runtime}: ${installResult.runtimeOutputs[runtime]}`);
  }

  const usage = agent.useSkill(
    installResult.descriptor.skillName,
    'Compare two security architecture proposals and produce a sourced risk tradeoff summary.'
  );
  console.log('\n[Portable] Example skill usage payload:\n');
  console.log(usage);

  console.log('\n[Portable] Note on compatibility:');
  console.log('- Codex and Claude Code can install file-based skills directly.');
  console.log('- ChatGPT and Claude use exported prompt bundles (manual import/paste).');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
