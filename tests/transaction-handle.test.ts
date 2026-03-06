import { describe, expect, it, jest } from '@jest/globals';

import { TransactionHandle } from '../src/core/transaction-handle.js';

describe('TransactionHandle.waitMined', () => {
  it('does not cache rejected waits permanently', async () => {
    const chainClient = {
      waitForTransaction: jest
        .fn()
        .mockImplementationOnce(async () => {
          throw new Error('timed out');
        })
        .mockImplementationOnce(async () => ({
          transactionHash: '0xabc',
          blockNumber: 1n,
          status: 'success' as const,
          logs: [],
        })),
    };

    const computeResult = jest.fn(async () => 'ok');
    const handle = new TransactionHandle('0xabc', chainClient as any, computeResult);

    await expect(handle.waitMined({ timeoutMs: 1000 })).rejects.toThrow('timed out');
    await expect(handle.waitMined({ timeoutMs: 1000 })).resolves.toEqual(
      expect.objectContaining({
        result: 'ok',
      })
    );

    expect((chainClient.waitForTransaction as jest.Mock).mock.calls).toHaveLength(2);
    expect(computeResult).toHaveBeenCalledTimes(1);
  });
});
