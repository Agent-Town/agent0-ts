import { afterEach, describe, expect, it, jest } from '@jest/globals';

import { IPFSClient } from '../src/core/ipfs-client.js';
import { SDK } from '../src/core/sdk.js';
import { EndpointType, TrustModel } from '../src/models/enums.js';

describe('SDK and IPFS regressions', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('rejects cross-chain owner lookups instead of silently reading the current chain registry', async () => {
    const sdk = new SDK({ chainId: 1, rpcUrl: 'http://localhost:8545' });
    (sdk as any)._chainClient = {
      readContract: jest.fn(),
    };

    await expect(
      sdk.isAgentOwner('2:7', '0x0000000000000000000000000000000000000001')
    ).rejects.toThrow('Agent 2:7 is not on current chain 1');
    await expect(sdk.getAgentOwner('2:7')).rejects.toThrow('Agent 2:7 is not on current chain 1');
    expect((sdk as any)._chainClient.readContract).not.toHaveBeenCalled();
  });

  it('fails fast when callers try to configure the unsupported filecoinPin backend', () => {
    expect(() => new IPFSClient({ filecoinPinEnabled: true } as any)).toThrow(
      'Filecoin Pin is not yet supported'
    );
    expect(
      () => new SDK({ chainId: 1, rpcUrl: 'http://localhost:8545', ipfs: 'filecoinPin' as any })
    ).toThrow("ipfs='filecoinPin' is not yet supported");
  });

  it('transforms raw ERC-8004 registration files into the internal RegistrationFile shape on IPFS reads', async () => {
    const client = new IPFSClient({ pinataEnabled: true, pinataJwt: 'test-jwt' });
    jest.spyOn(client, 'getJson').mockResolvedValue({
      name: 'Example Agent',
      description: 'Agent description',
      services: [
        {
          name: 'mcp',
          endpoint: 'https://mcp.example.com',
          version: '2025-06-18',
        },
      ],
      supportedTrust: [TrustModel.REPUTATION],
      active: true,
      x402Support: true,
    });

    const registrationFile = await client.getRegistrationFile('bafy-test');

    expect(registrationFile.endpoints).toEqual([
      {
        type: EndpointType.MCP,
        value: 'https://mcp.example.com',
        meta: { version: '2025-06-18' },
      },
    ]);
    expect(registrationFile.trustModels).toEqual([TrustModel.REPUTATION]);
    expect(registrationFile.x402support).toBe(true);
  });

  it('returns on the first successful IPFS gateway response instead of waiting for slower gateways', async () => {
    const client = new IPFSClient({ pinataEnabled: true, pinataJwt: 'test-jwt' });
    let releaseSlowResponse: (() => void) | undefined;

    jest.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('gateway.pinata.cloud')) {
        return Promise.resolve({
          ok: true,
          text: async () => 'fast-response',
        } as Response);
      }
      if (url.includes('ipfs.io')) {
        return new Promise<Response>((resolve) => {
          releaseSlowResponse = () =>
            resolve({
              ok: true,
              text: async () => 'slow-response',
            } as Response);
        });
      }
      return Promise.reject(new Error('gateway failed'));
    });

    const result = await Promise.race([
      client.get('bafy-fast'),
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error('timed out waiting for first success')), 50)
      ),
    ]);

    expect(result).toBe('fast-response');
    expect(releaseSlowResponse).toBeDefined();
  });
});
