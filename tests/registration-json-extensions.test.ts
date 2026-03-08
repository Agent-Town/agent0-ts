import { Agent, IPFSClient, SDK } from '../src/index.js';
import { transformRegistrationFile } from '../src/utils/index.js';

describe('Registration JSON extensions', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('[R7] default agent serialization omits entityType', async () => {
    const sdk = new SDK({ chainId: 1, rpcUrl: 'http://localhost:8545' });
    const agent = sdk.createAgent('Agent', 'Desc');

    const client = new IPFSClient({ pinataEnabled: true, pinataJwt: 'jwt' });
    const spy = jest
      .spyOn(client as any, 'addJson')
      .mockImplementation(async (data: any) => {
        expect(data.entityType).toBeUndefined();
        return 'cid';
      });

    await client.addRegistrationFile(agent.getRegistrationFile());
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('[R7,R8,R9] non-default entity serialization includes entityType/provenance/manifest', async () => {
    const sdk = new SDK({ chainId: 1, rpcUrl: 'http://localhost:8545' });
    const agent = sdk.createEntity({
      entityType: 'tool',
      name: 'Tool',
      description: 'Desc',
    });

    const provenance = {
      type: 'https://agent.town/schemas/provenance-v1' as const,
      sources: [{ kind: 'github_repo', url: 'https://github.com/org/repo' }],
      publisher: { name: 'Agent Town' },
    };
    const manifest = {
      type: 'https://agent.town/schemas/permission-manifest-v1' as const,
      version: '1.0.0',
      permissions: [{ id: 'network.fetch', effect: 'allow' as const }],
      risk: { level: 'low' as const, rationale: ['safe'] },
      safety: { promptInjection: { declaredMitigations: ['domain-allowlist'] } },
    };
    agent.setProvenance(provenance);
    agent.setPermissionManifest(manifest);

    const client = new IPFSClient({ pinataEnabled: true, pinataJwt: 'jwt' });
    const spy = jest
      .spyOn(client as any, 'addJson')
      .mockImplementation(async (data: any) => {
        expect(data.entityType).toBe('tool');
        expect(data.provenance).toEqual(provenance);
        expect(data.permissionManifest).toEqual(manifest);
        return 'cid';
      });

    await client.addRegistrationFile(agent.getRegistrationFile());
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('[R10,R11] transform parses extension fields and defaults entityType', () => {
    const sdk = new SDK({ chainId: 1, rpcUrl: 'http://localhost:8545' });

    const rawDefault = {
      type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
      name: 'Agent',
      description: 'Desc',
      services: [],
      active: true,
      x402Support: false,
    };
    const rfDefault = transformRegistrationFile(rawDefault);
    const agentDefault = new Agent(sdk as any, rfDefault);
    expect(agentDefault.entityType).toBe('agent');

    const rawExtended = {
      ...rawDefault,
      entityType: 'experience',
      provenance: {
        type: 'https://agent.town/schemas/provenance-v1',
        sources: [{ kind: 'github_repo', url: 'https://github.com/a/b' }],
        publisher: { name: 'X' },
      },
      permissionManifest: {
        type: 'https://agent.town/schemas/permission-manifest-ref-v1',
        uri: 'ipfs://abc',
        hash: '0x' + '11'.repeat(32),
        contentType: 'application/json',
      },
    };
    const rfExtended = transformRegistrationFile(rawExtended);
    expect(rfExtended.entityType).toBe('experience');
    expect(rfExtended.provenance).toEqual(rawExtended.provenance);
    expect(rfExtended.permissionManifest).toEqual(rawExtended.permissionManifest);
  });

  it('[R10] provenance roundtrip remains stable', () => {
    const client = new IPFSClient({ pinataEnabled: true, pinataJwt: 'jwt' });
    const sdk = new SDK({ chainId: 1, rpcUrl: 'http://localhost:8545' });
    const agent = sdk.createEntity({
      entityType: 'house',
      name: 'House',
      description: 'Desc',
    });
    const provenance = {
      type: 'https://agent.town/schemas/provenance-v1' as const,
      sources: [
        {
          kind: 'github_repo',
          url: 'https://github.com/org/repo',
          ref: 'commit:abcdef',
          licenseSpdx: 'MIT',
        },
      ],
      publisher: {
        name: 'Agent Town',
        statement: 'References upstream OSS',
      },
    };
    agent.setProvenance(provenance);

    const built = client.buildRegistrationJson(agent.getRegistrationFile());
    const transformed = transformRegistrationFile(built);
    expect(transformed.provenance).toEqual(provenance);
  });
});
