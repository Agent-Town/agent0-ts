import { Agent, IPFSClient } from '../src/index.js';
import type { RegistrationFile } from '../src/models/interfaces.js';

function makeRegistrationFile(): RegistrationFile {
  return {
    name: 'Tool',
    description: 'Desc',
    entityType: 'tool',
    provenance: {
      type: 'https://agent.town/schemas/provenance-v1',
      sources: [{ kind: 'github_repo', url: 'https://github.com/org/repo' }],
      publisher: { name: 'Agent Town' },
    },
    permissionManifest: {
      type: 'https://agent.town/schemas/permission-manifest-v1',
      version: '1.0.0',
      permissions: [{ id: 'network.fetch', effect: 'allow' }],
      risk: { level: 'low', rationale: ['safe'] },
      safety: {},
    },
    endpoints: [],
    trustModels: [],
    owners: [],
    operators: [],
    active: true,
    x402support: false,
    metadata: {},
    updatedAt: 1,
  };
}

describe('HTTP/IPFS registration parity', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('[R33] buildRegistrationJson and addRegistrationFile use equivalent payload', async () => {
    const client = new IPFSClient({ pinataEnabled: true, pinataJwt: 'jwt' });
    const rf = makeRegistrationFile();
    const built = client.buildRegistrationJson(rf, 11155111, '0x000000000000000000000000000000000000dEaD');

    const spy = jest.spyOn(client as any, 'addJson').mockImplementation(async (data: any) => {
      expect(data).toEqual(built);
      return 'cid';
    });

    const cid = await client.addRegistrationFile(rf, 11155111, '0x000000000000000000000000000000000000dEaD');
    expect(cid).toBe('cid');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('[R33] registerHTTP remains pointer-only and does not auto-upload registration JSON', async () => {
    const ipfsAdd = jest.fn();
    const writeContract = jest.fn<Promise<string>, [any]>(async () => '0x' + '11'.repeat(32));
    const fakeSdk = {
      ipfsClient: { addRegistrationFile: ipfsAdd },
      identityRegistryAddress: () => '0x000000000000000000000000000000000000dEaD',
      chainClient: { writeContract },
      chainId: async () => 11155111,
    };

    const agent = new Agent(fakeSdk as any, makeRegistrationFile());
    await agent.registerHTTP('https://example.com/agent.json');

    expect(ipfsAdd).not.toHaveBeenCalled();
    expect(writeContract).toHaveBeenCalledTimes(1);
    const firstCall = writeContract.mock.calls[0]?.[0];
    if (!firstCall) {
      throw new Error('writeContract was not called with expected args');
    }
    expect(firstCall.args[0]).toBe('https://example.com/agent.json');
    expect(Array.isArray(firstCall.args[1])).toBe(true);
  });
});
