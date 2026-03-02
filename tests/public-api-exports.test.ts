import {
  ENTITY_TYPE_HYDRATION_MAX,
  SDK,
  buildCanonicalTags,
  createPermissionManifestRef,
  isCanonicalTag,
  validatePermissionManifest,
  type CreateEntityInput,
  type EntityType,
  type PermissionManifestRefV1,
  type PermissionManifestV1,
  type ProvenanceV1,
} from '../src/index.js';

describe('Public API exports', () => {
  it('[R32] exports new runtime helpers from root entrypoint', () => {
    expect(typeof buildCanonicalTags).toBe('function');
    expect(typeof isCanonicalTag).toBe('function');
    expect(typeof validatePermissionManifest).toBe('function');
    expect(typeof createPermissionManifestRef).toBe('function');
    expect(typeof ENTITY_TYPE_HYDRATION_MAX).toBe('number');
  });

  it('[R32] exported types are usable from root without deep imports', () => {
    const et: EntityType = 'tool';
    const input: CreateEntityInput = { entityType: et, name: 'n', description: 'd' };
    const sdk = new SDK({ chainId: 1, rpcUrl: 'http://localhost:8545' });
    const agent = sdk.createEntity(input);

    const manifest: PermissionManifestV1 = {
      type: 'https://agent.town/schemas/permission-manifest-v1',
      version: '1.0.0',
      permissions: [{ id: 'network.fetch', effect: 'allow' }],
      risk: { level: 'low', rationale: ['ok'] },
      safety: {},
    };
    const ref: PermissionManifestRefV1 = createPermissionManifestRef(manifest, 'ipfs://cid');
    const provenance: ProvenanceV1 = {
      type: 'https://agent.town/schemas/provenance-v1',
      sources: [{ kind: 'github_repo', url: 'https://github.com/org/repo' }],
      publisher: { name: 'Agent Town' },
    };

    agent.setPermissionManifest(ref);
    agent.setProvenance(provenance);
    expect(agent.getPermissionManifest()).toEqual(ref);
    expect(agent.getProvenance()).toEqual(provenance);
  });
});
