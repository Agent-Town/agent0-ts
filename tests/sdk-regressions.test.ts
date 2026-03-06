import { describe, expect, it } from '@jest/globals';

import { SDK } from '../src/core/sdk.js';

describe('SDK regressions', () => {
  it('rejects owner lookups for agent IDs on a different chain instead of reading the current chain registry', async () => {
    const sdk = new SDK({
      chainId: 1,
      rpcUrl: 'http://localhost:8545',
    });

    await expect(sdk.isAgentOwner('137:7', '0x1234567890123456789012345678901234567890')).rejects.toThrow(
      'not on current chain'
    );
    await expect(sdk.getAgentOwner('137:7')).rejects.toThrow('not on current chain');
  });

  it('fails fast when filecoinPin is requested instead of advertising a late runtime backend', () => {
    expect(() =>
      new SDK({
        chainId: 1,
        rpcUrl: 'http://localhost:8545',
        ipfs: 'filecoinPin' as any,
        filecoinPrivateKey: 'filecoin-private-key',
      } as any)
    ).toThrow('not yet supported');
  });
});
