import { keccak256, toBytes, type Hex } from 'viem';
import type { URI } from './types.js';

export type PermissionRiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface PermissionGrant {
  id: string;
  effect: 'allow';
  constraints?: Record<string, unknown>;
}

export interface PermissionManifestV1 {
  type: 'https://agent.town/schemas/permission-manifest-v1';
  version: string;
  permissions: PermissionGrant[];
  risk: {
    level: PermissionRiskLevel;
    rationale: string[];
  };
  safety: {
    promptInjection?: {
      declaredMitigations: string[];
    };
    [key: string]: unknown;
  };
}

export interface PermissionManifestRefV1 {
  type: 'https://agent.town/schemas/permission-manifest-ref-v1';
  uri: URI;
  hash: Hex;
  contentType: string;
}

export interface ProvenanceV1 {
  type: 'https://agent.town/schemas/provenance-v1';
  sources: Array<{
    kind: string;
    url: string;
    ref?: string;
    licenseSpdx?: string;
    attribution?: string;
  }>;
  publisher: {
    name: string;
    statement?: string;
    contact?: string;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function canonicalizeJson(value: unknown): string {
  if (value === null) return 'null';

  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('Cannot canonicalize non-finite number');
    }
    return JSON.stringify(value);
  }

  if (typeof value === 'string') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    const items = value.map((item) => {
      if (item === undefined) return 'null';
      return canonicalizeJson(item);
    });
    return `[${items.join(',')}]`;
  }

  if (isRecord(value)) {
    const keys = Object.keys(value).sort();
    const pairs: string[] = [];
    for (const key of keys) {
      const item = value[key];
      if (item === undefined || typeof item === 'function' || typeof item === 'symbol') {
        continue;
      }
      pairs.push(`${JSON.stringify(key)}:${canonicalizeJson(item)}`);
    }
    return `{${pairs.join(',')}}`;
  }

  throw new Error(`Cannot canonicalize value of type ${typeof value}`);
}

function hasRequiredTxConstraints(grant: Record<string, unknown>): boolean {
  if (grant.id !== 'wallet.eip1193.tx') return true;
  if (!isRecord(grant.constraints)) return false;

  const { allowedChainIds, maxValueWei, requireConfirmation } = grant.constraints;
  const validChainIds =
    Array.isArray(allowedChainIds) &&
    allowedChainIds.length > 0 &&
    allowedChainIds.every((id) => typeof id === 'number' && Number.isFinite(id));
  const validMaxValueWei =
    (typeof maxValueWei === 'string' && /^\d+$/.test(maxValueWei)) ||
    (typeof maxValueWei === 'number' && Number.isInteger(maxValueWei) && maxValueWei >= 0);
  const validRequireConfirmation = typeof requireConfirmation === 'boolean';

  return validChainIds && validMaxValueWei && validRequireConfirmation;
}

export function validatePermissionManifest(manifest: unknown): { ok: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!isRecord(manifest)) {
    return { ok: false, errors: ['manifest must be an object'] };
  }

  if (manifest.type !== 'https://agent.town/schemas/permission-manifest-v1') {
    errors.push('type must be https://agent.town/schemas/permission-manifest-v1');
  }

  if (typeof manifest.version !== 'string' || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(manifest.version)) {
    errors.push('version must be a semver-like string');
  }

  if (!Array.isArray(manifest.permissions) || manifest.permissions.length < 1) {
    errors.push('permissions must be a non-empty array');
  } else {
    manifest.permissions.forEach((p, idx) => {
      if (!isRecord(p)) {
        errors.push(`permissions[${idx}] must be an object`);
        return;
      }
      if (typeof p.id !== 'string' || p.id.length < 1) {
        errors.push(`permissions[${idx}].id must be a non-empty string`);
      }
      if (p.effect !== 'allow') {
        errors.push(`permissions[${idx}].effect must be "allow"`);
      }
      if (!hasRequiredTxConstraints(p)) {
        errors.push(
          `permissions[${idx}] wallet.eip1193.tx requires constraints.allowedChainIds, constraints.maxValueWei, constraints.requireConfirmation`
        );
      }
    });
  }

  if (!isRecord(manifest.risk)) {
    errors.push('risk must be an object');
  } else {
    if (!['low', 'medium', 'high', 'critical'].includes(String(manifest.risk.level))) {
      errors.push('risk.level must be one of low|medium|high|critical');
    }
    if (!Array.isArray(manifest.risk.rationale) || manifest.risk.rationale.length < 1) {
      errors.push('risk.rationale must be a non-empty array');
    } else if (!manifest.risk.rationale.every((r) => typeof r === 'string')) {
      errors.push('risk.rationale entries must be strings');
    }
  }

  if (!isRecord(manifest.safety)) {
    errors.push('safety must be an object');
  } else if (manifest.safety.promptInjection !== undefined) {
    if (!isRecord(manifest.safety.promptInjection)) {
      errors.push('safety.promptInjection must be an object');
    } else if (
      !Array.isArray(manifest.safety.promptInjection.declaredMitigations) ||
      !manifest.safety.promptInjection.declaredMitigations.every((m) => typeof m === 'string')
    ) {
      errors.push('safety.promptInjection.declaredMitigations must be an array of strings');
    }
  }

  return { ok: errors.length === 0, errors };
}

export function createPermissionManifestRef(
  manifest: PermissionManifestV1,
  uri: URI,
  contentType: string = 'application/json'
): PermissionManifestRefV1 {
  const canonical = canonicalizeJson(manifest);
  const hash = keccak256(toBytes(canonical));
  return {
    type: 'https://agent.town/schemas/permission-manifest-ref-v1',
    uri,
    hash,
    contentType,
  };
}
