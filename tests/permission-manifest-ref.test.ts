import { keccak256, toBytes } from 'viem';
import {
  createPermissionManifestRef,
  type PermissionManifestV1,
} from '../src/index.js';

describe('Permission manifest reference hashing', () => {
  it('[R21] creates hash from keccak256(utf8(JCS(manifest)))', () => {
    const manifest: PermissionManifestV1 = {
      type: 'https://agent.town/schemas/permission-manifest-v1',
      version: '1.0.0',
      permissions: [{ id: 'network.fetch', effect: 'allow' }],
      risk: { level: 'low', rationale: ['safe'] },
      safety: { promptInjection: { declaredMitigations: ['domain-allowlist'] } },
    };

    const expectedCanonical =
      '{"permissions":[{"effect":"allow","id":"network.fetch"}],"risk":{"level":"low","rationale":["safe"]},"safety":{"promptInjection":{"declaredMitigations":["domain-allowlist"]}},"type":"https://agent.town/schemas/permission-manifest-v1","version":"1.0.0"}';
    const expectedHash = keccak256(toBytes(expectedCanonical));

    const ref = createPermissionManifestRef(manifest, 'ipfs://cid');
    expect(ref.hash).toBe(expectedHash);
  });

  it('[R22] key-order permutations yield stable hash', () => {
    const a: PermissionManifestV1 = {
      type: 'https://agent.town/schemas/permission-manifest-v1',
      version: '1.0.0',
      permissions: [{ id: 'network.fetch', effect: 'allow', constraints: { b: 2, a: 1 } }],
      risk: { level: 'medium', rationale: ['r1'] },
      safety: { promptInjection: { declaredMitigations: ['m1'] } },
    };
    const b: PermissionManifestV1 = {
      version: '1.0.0',
      type: 'https://agent.town/schemas/permission-manifest-v1',
      safety: { promptInjection: { declaredMitigations: ['m1'] } },
      risk: { rationale: ['r1'], level: 'medium' },
      permissions: [{ effect: 'allow', id: 'network.fetch', constraints: { a: 1, b: 2 } }],
    };

    const refA = createPermissionManifestRef(a, 'ipfs://cid-a');
    const refB = createPermissionManifestRef(b, 'ipfs://cid-b');
    expect(refA.hash).toBe(refB.hash);
  });

  it('[R21] contentType defaults to application/json', () => {
    const manifest: PermissionManifestV1 = {
      type: 'https://agent.town/schemas/permission-manifest-v1',
      version: '1.0.0',
      permissions: [{ id: 'network.fetch', effect: 'allow' }],
      risk: { level: 'low', rationale: ['safe'] },
      safety: {},
    };
    const ref = createPermissionManifestRef(manifest, 'ipfs://cid');
    expect(ref.contentType).toBe('application/json');
  });
});
