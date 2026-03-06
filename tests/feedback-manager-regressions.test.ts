import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { encodeAbiParameters, encodeEventTopics } from 'viem';

import type { ChainReceipt, Hex } from '../src/core/chain-client.js';
import { REPUTATION_REGISTRY_ABI } from '../src/core/contracts.js';
import { FeedbackManager } from '../src/core/feedback-manager.js';
import type { SubgraphClient } from '../src/core/subgraph-client.js';
import type { Address } from '../src/models/types.js';

const REPUTATION_REGISTRY = '0x0000000000000000000000000000000000000456' as Address;
const IDENTITY_REGISTRY = '0x0000000000000000000000000000000000000789' as Address;
const REVIEWER = '0x00000000000000000000000000000000000000aa' as Address;

const NEW_FEEDBACK_EVENT = REPUTATION_REGISTRY_ABI.find(
  (entry: any) => entry.type === 'event' && entry.name === 'NewFeedback'
) as any;

function makeChainClient(overrides: Record<string, unknown> = {}): any {
  return {
    chainId: 1,
    rpcUrl: 'http://localhost:8545',
    getAddress: jest.fn(async () => REVIEWER),
    ensureAddress: jest.fn(async () => REVIEWER),
    readContract: jest.fn(async () => 0n),
    writeContract: jest.fn(async () => '0x1' as Hex),
    sendTransaction: jest.fn(async () => '0x1' as Hex),
    waitForTransaction: jest.fn(async ({ hash }: { hash: Hex }) => ({
      transactionHash: hash,
      blockNumber: 1n,
      status: 'success' as const,
      logs: [],
    })),
    getEventLogs: jest.fn(async () => []),
    getBlockNumber: jest.fn(async () => 1n),
    getBlockTimestamp: jest.fn(async () => 1n),
    keccak256Utf8: jest.fn(() => `0x${'11'.repeat(32)}` as Hex),
    isAddress: jest.fn(() => true),
    toChecksumAddress: jest.fn((address: string) => address as Address),
    signMessage: jest.fn(async () => '0x1' as Hex),
    signTypedData: jest.fn(async () => '0x1' as Hex),
    ...overrides,
  };
}

function makeFeedbackRow(id: string, value: string, createdAt: string = '1') {
  return {
    id,
    clientAddress: REVIEWER,
    value,
    tag1: '',
    tag2: '',
    endpoint: '',
    feedbackURI: '',
    isRevoked: false,
    createdAt,
    feedbackFile: {},
    responses: [],
  };
}

function makeReceiptWithFeedbackIndex(hash: Hex, feedbackIndex: bigint): ChainReceipt {
  const topics = encodeEventTopics({
    abi: [NEW_FEEDBACK_EVENT],
    eventName: 'NewFeedback',
    args: {
      agentId: 7n,
      clientAddress: REVIEWER,
      indexedTag1: '',
    },
  }) as Hex[];

  const data = encodeAbiParameters(
    [
      { name: 'feedbackIndex', type: 'uint64' },
      { name: 'value', type: 'int128' },
      { name: 'valueDecimals', type: 'uint8' },
      { name: 'tag1', type: 'string' },
      { name: 'tag2', type: 'string' },
      { name: 'endpoint', type: 'string' },
      { name: 'feedbackURI', type: 'string' },
      { name: 'feedbackHash', type: 'bytes32' },
    ],
    [feedbackIndex, 80n, 0, '', '', '', '', `0x${'00'.repeat(32)}`]
  ) as Hex;

  return {
    transactionHash: hash,
    blockNumber: 1n,
    status: 'success',
    logs: [
      {
        address: REPUTATION_REGISTRY,
        topics,
        data,
      },
    ],
  };
}

describe('FeedbackManager regressions', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('hashes nested feedback-file fields instead of dropping them', async () => {
    let hashedJson = '';
    const chainClient = makeChainClient({
      keccak256Utf8: jest.fn((message: string) => {
        hashedJson = message;
        return `0x${'22'.repeat(32)}` as Hex;
      }),
    });
    const ipfsClient = {
      addJson: jest.fn(async () => 'bafy-feedback'),
    };
    const manager = new FeedbackManager(
      chainClient,
      ipfsClient as any,
      REPUTATION_REGISTRY,
      IDENTITY_REGISTRY
    );

    await manager.giveFeedback('1:7', 80, 'quality', undefined, undefined, {
      context: { nested: { evidence: 'kept' } },
      proofOfPayment: { txHash: '0xabc', chainId: 1 },
    });

    const parsed = JSON.parse(hashedJson);
    expect(parsed.context.nested.evidence).toBe('kept');
    expect(parsed.proofOfPayment.txHash).toBe('0xabc');
  });

  it('aggregates mixed-chain feedback searches across chain-specific subgraphs', async () => {
    const chainClient = makeChainClient();
    const defaultSubgraph = {
      searchFeedback: jest.fn(async () => [
        makeFeedbackRow('1:1:0x00000000000000000000000000000000000000aa:1', '80'),
      ]),
    } as unknown as SubgraphClient;
    const secondSubgraph = {
      searchFeedback: jest.fn(async () => [
        makeFeedbackRow('2:2:0x00000000000000000000000000000000000000aa:1', '90'),
      ]),
    } as unknown as SubgraphClient;

    const manager = new FeedbackManager(
      chainClient,
      undefined,
      undefined,
      undefined,
      defaultSubgraph
    );
    manager.setSubgraphClientGetter(
      (chainId) => (chainId === 2 ? secondSubgraph : defaultSubgraph),
      1
    );

    const results = await manager.searchFeedback({
      agents: ['1:1', '2:2'],
    });

    expect(results.map((result) => result.agentId)).toEqual(['1:1', '2:2']);
    expect(
      ((defaultSubgraph.searchFeedback as jest.Mock).mock.calls[0] as any[])[0].agents
    ).toEqual(['1:1']);
    expect(((secondSubgraph.searchFeedback as jest.Mock).mock.calls[0] as any[])[0].agents).toEqual(
      ['2:2']
    );
  });

  it('paginates reputation summaries beyond the first 1000 feedback rows', async () => {
    const firstPage = Array.from({ length: 1000 }, (_, index) =>
      makeFeedbackRow(`1:7:${REVIEWER}:${index + 1}`, '80')
    );
    const secondPage = [
      makeFeedbackRow(`1:7:${REVIEWER}:1001`, '100'),
      makeFeedbackRow(`1:7:${REVIEWER}:1002`, '60'),
    ];
    const searchFeedback = jest.fn(async (_params: any, _first: number, skip: number) => {
      if (skip === 0) return firstPage;
      if (skip === 1000) return secondPage;
      return [];
    });
    const subgraph = {
      searchFeedback,
    } as unknown as SubgraphClient;

    const manager = new FeedbackManager(
      makeChainClient(),
      undefined,
      undefined,
      undefined,
      subgraph
    );
    manager.setSubgraphClientGetter(() => subgraph, 1);

    const summary = await manager.getReputationSummary('1:7');

    expect(summary.count).toBe(1002);
    expect(summary.averageValue).toBeCloseTo((1000 * 80 + 100 + 60) / 1002, 2);
    expect(searchFeedback).toHaveBeenCalledTimes(2);
  });

  it('uses the mined receipt feedback index instead of the pre-read prediction', async () => {
    const chainClient = makeChainClient({
      readContract: jest.fn(async () => 0n),
      writeContract: jest.fn(async () => '0xabc' as Hex),
      waitForTransaction: jest.fn(async ({ hash }: { hash: Hex }) =>
        makeReceiptWithFeedbackIndex(hash, 2n)
      ),
    });
    const manager = new FeedbackManager(
      chainClient,
      undefined,
      REPUTATION_REGISTRY,
      IDENTITY_REGISTRY
    );

    const tx = await manager.giveFeedback('1:7', 80);
    const { result } = await tx.waitConfirmed();

    expect(result.id[2]).toBe(2);
  });
});
