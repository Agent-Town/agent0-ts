/**
 * End-to-end SKILL.md publishing + verified OpenClaw install.
 *
 * SECURITY NOTE: This is an example flow. Do not use as-is in production
 * without environment-specific hardening (egress policy, authz, secret management).
 *
 * Flow:
 * 1) Read a local SKILL.md file.
 * 2) Pin the SKILL.md bytes to IPFS and compute SHA-256.
 * 3) Publish a skill entity on-chain via agent0-ts.
 * 4) Store skill URI + hash in on-chain metadata keys.
 * 5) Simulate an OpenClaw agent that fetches metadata from chain,
 *    downloads SKILL.md, recomputes SHA-256, verifies, installs, and uses it.
 *
 * Run:
 *   npx tsx examples/skill-md-publish-openclaw-verify.ts
 *
 * Required env:
 *   RPC_URL
 *   PRIVATE_KEY (or AGENT_PRIVATE_KEY)
 *   PINATA_JWT
 *
 * Optional env:
 *   CHAIN_ID (defaults to 11155111 / Sepolia)
 */

import './_env.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
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

const METADATA_KEYS = {
  skillUri: 'openclaw.skill.uri',
  skillSha256: 'openclaw.skill.sha256',
  skillHashAlg: 'openclaw.skill.hash_alg',
  skillName: 'openclaw.skill.name',
  skillVersion: 'openclaw.skill.version',
} as const;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SKILL_SOURCE_PATH = path.join(__dirname, 'skills', 'verified_web_research', 'SKILL.md');
const OPENCLAW_INSTALL_ROOT = path.join(__dirname, '.openclaw-agent');

type InstalledSkill = {
  skillId: string;
  sourceUri: string;
  verifiedHash: string;
  localPath: string;
  content: string;
};

class OpenClawAgent {
  private readonly installedSkills = new Map<string, InstalledSkill>();

  constructor(private readonly name: string) {}

  addSkill(skill: InstalledSkill): void {
    this.installedSkills.set(skill.skillId, skill);
    console.log(`[OpenClaw] Installed skill "${skill.skillId}" from ${skill.sourceUri}`);
  }

  useSkill(skillId: string, task: string): string {
    const skill = this.installedSkills.get(skillId);
    if (!skill) {
      throw new Error(`Skill "${skillId}" is not installed`);
    }

    const skillSnippet = skill.content.split('\n').slice(0, 14).join('\n');
    return [
      `OpenClaw agent "${this.name}"`,
      `Task: ${task}`,
      `Using verified skill: ${skill.skillId}`,
      `Pinned SHA-256: ${skill.verifiedHash}`,
      `Installed from: ${skill.localPath}`,
      '',
      'Prompt scaffold generated from SKILL.md:',
      '---',
      skillSnippet,
      '---',
    ].join('\n');
  }
}

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
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`${url} -> ${message}`);
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

async function publishSkillMarkdown(sdk: SDK): Promise<{
  skillAgentId: AgentId;
  skillUri: string;
  skillHash: string;
  skillName: string;
}> {
  if (!sdk.ipfsClient) {
    throw new Error('IPFS client is required to publish skill markdown');
  }

  const skillMarkdown = await fs.readFile(SKILL_SOURCE_PATH, 'utf8');
  const skillHash = sha256HexUtf8(skillMarkdown);
  const skillCid = await sdk.ipfsClient.add(skillMarkdown, 'SKILL.md');
  const skillUri = `ipfs://${skillCid}`;

  const skillName = 'verified_web_research';
  const skillVersion = '1.0.0';

  const skillEntity = sdk.createSkill(
    `${skillName}@${skillVersion}`,
    'OpenClaw skill package published as SKILL.md with on-chain URI+hash verification metadata.'
  );

  skillEntity.setMetadata({
    [METADATA_KEYS.skillUri]: skillUri,
    [METADATA_KEYS.skillSha256]: skillHash,
    [METADATA_KEYS.skillHashAlg]: 'sha256',
    [METADATA_KEYS.skillName]: skillName,
    [METADATA_KEYS.skillVersion]: skillVersion,
  });

  skillEntity.setProvenance({
    type: 'https://agent.town/schemas/provenance-v1',
    sources: [
      {
        kind: 'openclaw_skill_markdown',
        url: skillUri,
        ref: `sha256:${skillHash}`,
      },
    ],
    publisher: {
      name: 'OpenClaw Skill Publisher Example',
      statement: 'Skill bytes are pinned and hash-anchored in chain metadata.',
    },
  });

  skillEntity.setActive(true);

  const publishTx = await skillEntity.registerIPFS();
  const { result: registration } = await publishTx.waitConfirmed();

  if (!registration.agentId) {
    throw new Error('Registration completed but no agentId was returned');
  }

  console.log(`[Publisher] Skill entity registered: ${registration.agentId}`);
  console.log(`[Publisher] Skill entity registration URI: ${registration.agentURI}`);
  console.log(`[Publisher] Skill markdown URI: ${skillUri}`);
  console.log(`[Publisher] Skill markdown SHA-256: ${skillHash}`);

  return {
    skillAgentId: registration.agentId,
    skillUri,
    skillHash,
    skillName,
  };
}

async function installVerifiedSkillFromChain(params: {
  sdk: SDK;
  skillAgentId: AgentId;
  installRoot: string;
}): Promise<InstalledSkill> {
  const { chainId, tokenId } = parseAgentId(params.skillAgentId);
  const currentChain = await params.sdk.chainId();
  if (chainId !== currentChain) {
    throw new Error(
      `Skill is on chain ${chainId}, but installer SDK is configured for chain ${currentChain}`
    );
  }

  const tokenUri = await params.sdk.chainClient.readContract<string>({
    address: params.sdk.identityRegistryAddress(),
    abi: IDENTITY_REGISTRY_ABI,
    functionName: 'tokenURI',
    args: [BigInt(tokenId)],
  });
  console.log(`[Installer] tokenURI from blockchain: ${tokenUri}`);

  const skillUri = await readMetadataString(params.sdk, tokenId, METADATA_KEYS.skillUri);
  const expectedHash = await readMetadataString(params.sdk, tokenId, METADATA_KEYS.skillSha256);
  const hashAlgorithm = await readMetadataString(params.sdk, tokenId, METADATA_KEYS.skillHashAlg);
  const skillNameFromChain = await readMetadataString(params.sdk, tokenId, METADATA_KEYS.skillName);

  if (!skillUri) {
    throw new Error(`Missing metadata key "${METADATA_KEYS.skillUri}"`);
  }
  if (!expectedHash) {
    throw new Error(`Missing metadata key "${METADATA_KEYS.skillSha256}"`);
  }
  if (!hashAlgorithm || hashAlgorithm.toLowerCase() !== 'sha256') {
    throw new Error(
      `Unsupported hash algorithm "${hashAlgorithm}". This example supports only sha256.`
    );
  }

  const skillMarkdown = await fetchTextFromUri(skillUri, params.sdk.ipfsClient);
  const actualHash = sha256HexUtf8(skillMarkdown);
  if (actualHash !== expectedHash) {
    throw new Error(
      `Hash mismatch for ${skillUri}. Expected ${expectedHash}, computed ${actualHash}.`
    );
  }

  const skillId = skillNameFromChain || `skill-${chainId}-${tokenId}`;
  const installDir = path.join(params.installRoot, 'skills', sanitizeForPath(skillId));
  await fs.mkdir(installDir, { recursive: true });
  const installedSkillPath = path.join(installDir, 'SKILL.md');
  await fs.writeFile(installedSkillPath, skillMarkdown, 'utf8');

  const installReceiptPath = path.join(installDir, 'skill-install.json');
  const installReceipt = {
    installedAt: new Date().toISOString(),
    skillAgentId: params.skillAgentId,
    sourceUri: skillUri,
    expectedHash,
    computedHash: actualHash,
    hashAlgorithm,
    verified: true,
    tokenUri,
  };
  await fs.writeFile(installReceiptPath, JSON.stringify(installReceipt, null, 2), 'utf8');

  console.log(`[Installer] Verified hash for ${skillUri}`);
  console.log(`[Installer] Skill installed at ${installedSkillPath}`);

  return {
    skillId,
    sourceUri: skillUri,
    verifiedHash: actualHash,
    localPath: installedSkillPath,
    content: skillMarkdown,
  };
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
    throw new Error('PRIVATE_KEY (or AGENT_PRIVATE_KEY) is required to publish skill entity');
  }
  if (!pinataJwt || pinataJwt.trim() === '') {
    throw new Error('PINATA_JWT is required to pin SKILL.md and registration JSON');
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

  const { skillAgentId, skillName } = await publishSkillMarkdown(publisherSdk);
  const installed = await installVerifiedSkillFromChain({
    sdk: installerSdk,
    skillAgentId,
    installRoot: OPENCLAW_INSTALL_ROOT,
  });

  const openClawAgent = new OpenClawAgent('openclaw-verifier');
  openClawAgent.addSkill(installed);

  const taskPrompt = openClawAgent.useSkill(
    skillName,
    'Investigate whether ERC-8004 registrations can carry permission manifests and explain the trust implications.'
  );
  console.log('\n[OpenClaw] Example skill usage payload:\n');
  console.log(taskPrompt);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
