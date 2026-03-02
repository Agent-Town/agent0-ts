# Agent0 SDK Extensions v0.2

This document describes the new additive SDK features implemented for:

- Multi-entity identities (`entityType`)
- Permission manifests (`permissionManifest`)
- Provenance claims (`provenance`)
- Canonical reputation tags
- Entity-type-aware search

These changes are additive and preserve existing `createAgent`, `Agent`, `giveFeedback`, and registration behavior.

## What Was Added

### 1) New entity types

New model types:

```ts
type EntityTypeCanonical =
  | 'agent'
  | 'human'
  | 'tool'
  | 'skill'
  | 'experience'
  | 'house'
  | 'organization';

type EntityType = EntityTypeCanonical | (string & {});
```

Default interpretation:

- If `entityType` is missing, SDK treats it as `"agent"`.

### 2) `RegistrationFile` extensions

New optional fields:

```ts
entityType?: EntityType;
provenance?: ProvenanceV1;
permissionManifest?: PermissionManifestV1 | PermissionManifestRefV1;
```

### 3) New SDK creation APIs

```ts
createEntity(input: CreateEntityInput): Agent;
createHuman(name, description, image?): Agent;
createTool(name, description, image?): Agent;
createSkill(name, description, image?): Agent;
createExperience(name, description, image?): Agent;
createHouse(name, description, image?): Agent;
createOrganization(name, description, image?): Agent;
```

`createAgent` is unchanged and remains the default agent path.

### 4) New `Agent` methods

```ts
get entityType(): EntityType;
setEntityType(type: EntityType): this;

setPermissionManifest(manifest: PermissionManifestV1 | PermissionManifestRefV1): this;
getPermissionManifest(): PermissionManifestV1 | PermissionManifestRefV1 | undefined;

setProvenance(provenance: ProvenanceV1): this;
getProvenance(): ProvenanceV1 | undefined;
```

All setters update `updatedAt`.

### 5) Permission manifest types and validation

New exports:

- `PermissionGrant`
- `PermissionManifestV1`
- `PermissionManifestRefV1`
- `ProvenanceV1`
- `validatePermissionManifest(manifest)`
- `createPermissionManifestRef(manifest, uri, contentType?)`

Validation includes:

- Required top-level fields
- `type` constant checks
- semver-like `version`
- non-empty `permissions`
- `risk.level` enum
- `wallet.eip1193.tx` constraint requirements:
  - `allowedChainIds`
  - `maxValueWei`
  - `requireConfirmation`

### 6) Manifest reference hashing

`createPermissionManifestRef(...)` computes:

- `hash = keccak256(utf8(JCS(manifest)))`

where JCS is JSON canonicalization (RFC 8785 style key ordering).  
This makes hashes stable across equivalent key order permutations.

### 7) Registration JSON helper and serialization behavior

New `IPFSClient` helper:

```ts
buildRegistrationJson(registrationFile, chainId?, identityRegistryAddress?): Record<string, unknown>
```

`addRegistrationFile(...)` now uses this helper internally.

Serialization rules:

- `entityType` is emitted only when non-default (`!== "agent"`).
- `provenance` emitted when present.
- `permissionManifest` emitted when present.
- Existing ERC-8004 required fields are unchanged.

### 8) Search: `entityType` filter

`SearchFilters` now supports:

```ts
entityType?: EntityType | EntityType[];
```

Behavior:

- Single string: exact match.
- Array: ANY match.
- Missing type in data defaults to `"agent"`.

Fallback support:

- If search results do not include `entityType`, SDK hydrates from `agentURI` registration JSON.
- Hydration cap is enforced to avoid unbounded fanout:
  - `ENTITY_TYPE_HYDRATION_MAX = 200`
  - error message includes `ENTITY_TYPE_FILTER_TOO_BROAD` when exceeded.

### 9) Canonical reputation tags

New utilities:

```ts
buildCanonicalTags({ dimension, signal }): { tag1, tag2 };
isCanonicalTag(tag): boolean;
```

Outputs use namespace:

- `erc8004.v1/<dimension>`
- `erc8004.v1/<signal>`

### 10) New exports

Added to package public surface via `src/index.ts` re-export chain:

- Permission manifest/provenance types and helpers
- Reputation tag utilities
- `ENTITY_TYPE_HYDRATION_MAX`

## Usage Examples

### Create a non-agent entity

```ts
const tool = sdk.createTool(
  'GitHub Issues Tool',
  'Create and read issues on GitHub'
);
```

### Attach permission manifest + provenance

```ts
tool.setPermissionManifest({
  type: 'https://agent.town/schemas/permission-manifest-v1',
  version: '1.0.0',
  permissions: [
    {
      id: 'network.fetch',
      effect: 'allow',
      constraints: { origins: ['https://api.github.com'], methods: ['GET', 'POST'] },
    },
  ],
  risk: { level: 'medium', rationale: ['Writes external state'] },
  safety: { promptInjection: { declaredMitigations: ['domain-allowlist', 'user-confirmation'] } },
});

tool.setProvenance({
  type: 'https://agent.town/schemas/provenance-v1',
  sources: [{ kind: 'github_repo', url: 'https://github.com/org/repo', licenseSpdx: 'MIT' }],
  publisher: { name: 'Your Org' },
});
```

### Build a manifest reference

```ts
const ref = createPermissionManifestRef(manifest, 'ipfs://<cid>');
tool.setPermissionManifest(ref);
```

### Search by entity type

```ts
const tools = await sdk.searchAgents({ entityType: 'tool' });
const peopleOrOrgs = await sdk.searchAgents({ entityType: ['human', 'organization'] });
```

### Build canonical feedback tags

```ts
const { tag1, tag2 } = buildCanonicalTags({
  dimension: 'security',
  signal: 'prompt_injection_detected',
});
await sdk.giveFeedback(agentId, 80, tag1, tag2);
```

## Notes on HTTP registration

`registerHTTP(uri)` remains pointer-based and does not auto-upload JSON.  
If you use HTTP registration and want these extension fields discoverable, host the JSON yourself (you can generate it via `buildRegistrationJson(...)`).

## Test Coverage

The implementation includes a TDD traceability test (`tests/spec-traceability.test.ts`) mapping requirements `R1..R34` to explicit test cases across the new test files.
