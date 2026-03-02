import {
  Agent,
  SDK,
  validatePermissionManifest,
  type PermissionManifestV1,
} from '../src/index.js';
import type { RegistrationFile } from '../src/models/interfaces.js';
import { TrustModel } from '../src/models/enums.js';
import type { SDK as SDKCore } from '../src/core/sdk.js';

function makeValidManifest(): PermissionManifestV1 {
  return {
    type: 'https://agent.town/schemas/permission-manifest-v1',
    version: '1.0.0',
    permissions: [
      {
        id: 'network.fetch',
        effect: 'allow',
        constraints: {
          origins: ['https://api.example.com'],
          methods: ['GET'],
        },
      },
    ],
    risk: {
      level: 'low',
      rationale: ['Read-only calls'],
    },
    safety: {
      promptInjection: {
        declaredMitigations: ['domain-allowlist'],
      },
    },
  };
}

function makeAgent(): Agent {
  const rf: RegistrationFile = {
    name: 'Tool',
    description: 'Desc',
    endpoints: [],
    trustModels: [TrustModel.REPUTATION],
    owners: [],
    operators: [],
    active: true,
    x402support: false,
    metadata: {},
    updatedAt: 1,
  };
  return new Agent({} as SDKCore, rf);
}

describe('Permission manifest validation and agent storage', () => {
  it('[R15] valid manifest passes validation', () => {
    const out = validatePermissionManifest(makeValidManifest());
    expect(out).toEqual({ ok: true, errors: [] });
  });

  it('[R16] missing type fails', () => {
    const manifest: any = makeValidManifest();
    delete manifest.type;
    const out = validatePermissionManifest(manifest);
    expect(out.ok).toBe(false);
    expect(out.errors.join(' ')).toContain('type');
  });

  it('[R17] invalid type constant fails', () => {
    const manifest: any = makeValidManifest();
    manifest.type = 'https://wrong/type';
    const out = validatePermissionManifest(manifest);
    expect(out.ok).toBe(false);
  });

  it('[R18] empty permissions fails', () => {
    const manifest: any = makeValidManifest();
    manifest.permissions = [];
    const out = validatePermissionManifest(manifest);
    expect(out.ok).toBe(false);
  });

  it('[R19] invalid risk level fails', () => {
    const manifest: any = makeValidManifest();
    manifest.risk.level = 'impossible';
    const out = validatePermissionManifest(manifest);
    expect(out.ok).toBe(false);
  });

  it('[R20] wallet.eip1193.tx without required constraints fails', () => {
    const manifest: any = makeValidManifest();
    manifest.permissions = [{ id: 'wallet.eip1193.tx', effect: 'allow' }];
    const out = validatePermissionManifest(manifest);
    expect(out.ok).toBe(false);
    expect(out.errors.join(' ')).toContain('wallet.eip1193.tx');
  });

  it('[R20] wallet.eip1193.tx with required constraints passes', () => {
    const manifest: any = makeValidManifest();
    manifest.permissions = [
      {
        id: 'wallet.eip1193.tx',
        effect: 'allow',
        constraints: {
          allowedChainIds: [1, 11155111],
          maxValueWei: '1000000000000000',
          requireConfirmation: true,
        },
      },
    ];
    const out = validatePermissionManifest(manifest);
    expect(out.ok).toBe(true);
  });

  it('[R12,R14] setPermissionManifest stores value, updates updatedAt, and does not write metadata entry', () => {
    const agent = makeAgent();
    const manifest = makeValidManifest();
    const prev = agent.getRegistrationFile().updatedAt;
    agent.setPermissionManifest(manifest);

    expect(agent.getPermissionManifest()).toEqual(manifest);
    expect(agent.getRegistrationFile().updatedAt).toBeGreaterThanOrEqual(prev);

    const entries = (agent as any)._collectMetadataForRegistration() as Array<{ metadataKey: string }>;
    expect(entries.some((e) => e.metadataKey === 'permissionManifest')).toBe(false);
  });

  it('[R13,R14] setProvenance stores value, updates updatedAt, and does not write metadata entry', () => {
    const agent = makeAgent();
    const provenance = {
      type: 'https://agent.town/schemas/provenance-v1' as const,
      sources: [{ kind: 'github_repo', url: 'https://github.com/org/repo' }],
      publisher: { name: 'Agent Town' },
    };
    const prev = agent.getRegistrationFile().updatedAt;
    agent.setProvenance(provenance);

    expect(agent.getProvenance()).toEqual(provenance);
    expect(agent.getRegistrationFile().updatedAt).toBeGreaterThanOrEqual(prev);

    const entries = (agent as any)._collectMetadataForRegistration() as Array<{ metadataKey: string }>;
    expect(entries.some((e) => e.metadataKey === 'provenance')).toBe(false);
  });

  it('[R12] agent stores manifest on registration file for SDK-created entity', () => {
    const sdk = new SDK({ chainId: 1, rpcUrl: 'http://localhost:8545' });
    const agent = sdk.createEntity({ entityType: 'tool', name: 't', description: 'd' });
    const manifest = makeValidManifest();
    agent.setPermissionManifest(manifest);
    expect(agent.getRegistrationFile().permissionManifest).toEqual(manifest);
  });
});
