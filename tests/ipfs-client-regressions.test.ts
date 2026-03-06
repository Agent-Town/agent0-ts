import { afterEach, describe, expect, it, jest } from '@jest/globals';

import { IPFSClient } from '../src/core/ipfs-client.js';
import { EndpointType, TrustModel } from '../src/models/enums.js';

describe('IPFSClient regressions', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns the first successful gateway response without waiting for slower gateways', async () => {
    const client = new IPFSClient({ pinataEnabled: true, pinataJwt: 'jwt' });
    jest.spyOn(global, 'fetch').mockImplementation((input: any) => {
      const url = String(input);
      if (url.includes('ipfs.io')) {
        return Promise.resolve({
          ok: true,
          text: async () => 'fast-response',
        } as unknown as Response);
      }

      return new Promise(() => {});
    });

    const result = await Promise.race([
      client.get('cid'),
      new Promise<string>((_, reject) => setTimeout(() => reject(new Error('timed out waiting for fast gateway')), 100)),
    ]);

    expect(result).toBe('fast-response');
  });

  it('transforms raw ERC-8004 registration JSON into the internal RegistrationFile shape', async () => {
    const client = new IPFSClient({ pinataEnabled: true, pinataJwt: 'jwt' });
    jest.spyOn(client, 'getJson').mockResolvedValue({
      name: 'Agent',
      description: 'Transformed',
      services: [
        { name: 'mcp', endpoint: 'https://mcp.example.com', version: '2025-06-18' },
      ],
      supportedTrust: [TrustModel.REPUTATION],
      active: true,
      x402Support: true,
    } as any);

    const registrationFile = await client.getRegistrationFile('cid');

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
});
