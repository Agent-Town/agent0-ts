import type { ChainClient, ChainReceipt, Hex } from './chain-client.js';

export type TransactionWaitOptions = {
  timeoutMs?: number;
  /**
   * Number of confirmations to wait for (1 = mined).
   */
  confirmations?: number;
  /**
   * If true (default), throw if the receipt indicates the tx reverted.
   */
  throwOnRevert?: boolean;
};

export type TransactionMined<T> = {
  receipt: ChainReceipt;
  result: T;
};

export class TransactionHandle<T> {
  public readonly hash: Hex;
  private readonly memo = new Map<string, Promise<TransactionMined<T>>>();

  constructor(
    hash: Hex,
    private readonly chainClient: ChainClient,
    private readonly computeResult: (receipt: ChainReceipt) => Promise<T> | T
  ) {
    this.hash = hash;
  }

  async waitMined(opts: TransactionWaitOptions = {}): Promise<TransactionMined<T>> {
    const key = JSON.stringify({
      timeoutMs: opts.timeoutMs ?? null,
      confirmations: opts.confirmations ?? null,
      throwOnRevert: opts.throwOnRevert ?? null,
    });
    const existing = this.memo.get(key);
    if (existing) return await existing;

    const promise = (async () => {
      const receipt = await this.chainClient.waitForTransaction({
        hash: this.hash,
        timeoutMs: opts.timeoutMs,
        confirmations: opts.confirmations,
      });

      const throwOnRevert = opts.throwOnRevert ?? true;
      if (throwOnRevert && receipt.status === 'reverted') {
        throw new Error(`Transaction reverted: ${this.hash}`);
      }

      const result = await this.computeResult(receipt);
      return { receipt, result };
    })();

    this.memo.set(key, promise);
    try {
      return await promise;
    } catch (error) {
      this.memo.delete(key);
      throw error;
    }
  }

  /**
   * Alias of waitMined (naming convenience).
   */
  async waitConfirmed(opts: TransactionWaitOptions = {}): Promise<TransactionMined<T>> {
    return await this.waitMined(opts);
  }
}

