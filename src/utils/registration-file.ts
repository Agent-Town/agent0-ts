import type { Endpoint, RegistrationFile } from '../models/interfaces.js';
import type { Address } from '../models/types.js';
import { EndpointType, type TrustModel } from '../models/enums.js';

function transformLegacyEndpoint(
  rawEndpoint: Record<string, unknown>
): { endpoint: Endpoint | null; walletAddress?: Address; walletChainId?: number } {
  const name = typeof rawEndpoint.name === 'string' ? rawEndpoint.name : '';
  const value = typeof rawEndpoint.endpoint === 'string' ? rawEndpoint.endpoint : '';
  const version = typeof rawEndpoint.version === 'string' ? rawEndpoint.version : undefined;

  const endpointTypeMap: Record<string, EndpointType> = {
    mcp: EndpointType.MCP,
    a2a: EndpointType.A2A,
    ens: EndpointType.ENS,
    did: EndpointType.DID,
    agentwallet: EndpointType.WALLET,
    wallet: EndpointType.WALLET,
  };

  const mappedType = endpointTypeMap[name.toLowerCase()];
  let walletAddress: Address | undefined;
  let walletChainId: number | undefined;

  if (mappedType === EndpointType.WALLET) {
    const walletMatch = value.match(/eip155:(\d+):(0x[a-fA-F0-9]{40})/);
    if (walletMatch) {
      walletChainId = Number(walletMatch[1]);
      walletAddress = walletMatch[2] as Address;
    }
  }

  return {
    endpoint: {
      type: (mappedType || name) as EndpointType,
      value,
      meta: version ? { version } : undefined,
    },
    walletAddress,
    walletChainId,
  };
}

function transformEndpoints(rawData: Record<string, unknown>): {
  endpoints: Endpoint[];
  walletAddress?: Address;
  walletChainId?: number;
} {
  const endpoints: Endpoint[] = [];
  let walletAddress: Address | undefined;
  let walletChainId: number | undefined;

  const rawServices = Array.isArray(rawData.services)
    ? rawData.services
    : Array.isArray(rawData.endpoints)
      ? rawData.endpoints
      : [];

  for (const entry of rawServices) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }

    const rawEndpoint = entry as Record<string, unknown>;
    if (typeof rawEndpoint.type === 'string' && rawEndpoint.value !== undefined) {
      endpoints.push({
        type: rawEndpoint.type as EndpointType,
        value: rawEndpoint.value as string,
        meta:
          rawEndpoint.meta && typeof rawEndpoint.meta === 'object' && !Array.isArray(rawEndpoint.meta)
            ? (rawEndpoint.meta as Record<string, unknown>)
            : undefined,
      });
      continue;
    }

    const transformed = transformLegacyEndpoint(rawEndpoint);
    if (transformed.endpoint) {
      endpoints.push(transformed.endpoint);
    }
    if (transformed.walletAddress) {
      walletAddress = transformed.walletAddress;
      walletChainId = transformed.walletChainId;
    }
  }

  if (!walletAddress && typeof rawData.walletAddress === 'string' && typeof rawData.walletChainId === 'number') {
    walletAddress = rawData.walletAddress as Address;
    walletChainId = rawData.walletChainId;
  }

  return { endpoints, walletAddress, walletChainId };
}

export function transformRegistrationFile(rawData: Record<string, unknown>): RegistrationFile {
  const { endpoints, walletAddress, walletChainId } = transformEndpoints(rawData);

  const trustModels: (TrustModel | string)[] = Array.isArray(rawData.supportedTrust)
    ? (rawData.supportedTrust as (TrustModel | string)[])
    : Array.isArray(rawData.trustModels)
      ? (rawData.trustModels as (TrustModel | string)[])
      : [];

  return {
    entityType: typeof rawData.entityType === 'string' ? (rawData.entityType as RegistrationFile['entityType']) : undefined,
    provenance:
      rawData.provenance && typeof rawData.provenance === 'object' && !Array.isArray(rawData.provenance)
        ? (rawData.provenance as RegistrationFile['provenance'])
        : undefined,
    permissionManifest:
      rawData.permissionManifest &&
      typeof rawData.permissionManifest === 'object' &&
      !Array.isArray(rawData.permissionManifest)
        ? (rawData.permissionManifest as RegistrationFile['permissionManifest'])
        : undefined,
    name: typeof rawData.name === 'string' ? rawData.name : '',
    description: typeof rawData.description === 'string' ? rawData.description : '',
    image: typeof rawData.image === 'string' ? rawData.image : undefined,
    walletAddress,
    walletChainId,
    endpoints,
    trustModels,
    owners: Array.isArray(rawData.owners)
      ? rawData.owners.filter((owner): owner is Address => typeof owner === 'string')
      : [],
    operators: Array.isArray(rawData.operators)
      ? rawData.operators.filter((operator): operator is Address => typeof operator === 'string')
      : [],
    active: typeof rawData.active === 'boolean' ? rawData.active : false,
    x402support:
      typeof rawData.x402support === 'boolean'
        ? rawData.x402support
        : (typeof rawData.x402Support === 'boolean' ? rawData.x402Support : false),
    metadata:
      rawData.metadata && typeof rawData.metadata === 'object' && !Array.isArray(rawData.metadata)
        ? (rawData.metadata as Record<string, unknown>)
        : {},
    updatedAt: typeof rawData.updatedAt === 'number' ? rawData.updatedAt : Math.floor(Date.now() / 1000),
  };
}
