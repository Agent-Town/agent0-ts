import { afterEach, describe, expect, it, jest } from '@jest/globals';

import { Agent } from '../src/core/agent.js';
import type { ChainReceipt, Hex } from '../src/core/chain-client.js';
import type { SDK } from '../src/core/sdk.js';
import { TrustModel } from '../src/models/enums.js';
import type { RegistrationFile } from '../src/models/interfaces.js';
import type { Address } from '../src/models/types.js';

const IDENTITY_REGISTRY = '0x0000000000000000000000000000000000000123' as Address;
const CALLER = '0x00000000000000000000000000000000000000aa' as Address;
const OWNER = '0x00000000000000000000000000000000000000bb' as Address;
const RECIPIENT = '0x00000000000000000000000000000000000000cc' as Address;

function makeReceipt(hash: Hex, status: ChainReceipt['status'] = 'success'): ChainReceipt {
  return {
    transactionHash: hash,
    blockNumber: 1n,
    status,
    logs: [],
  };
}

function makeRegistrationFile(overrides: Partial<RegistrationFile> = {}): RegistrationFile {
  return {
    name: 'Test Agent',
    description: 'Agent for regression tests',
    endpoints: [],
    trustModels: [TrustModel.REPUTATION],
    owners: [],
    operators: [],
    active: true,
    x402support: false,
    metadata: {},
    updatedAt: 0,
    ...overrides,
  };
}

function makeChainClient(overrides: Record<string, unknown> = {}): any {
  return {
    chainId: 1,
    rpcUrl: 'http://localhost:8545',
    getAddress: jest.fn(async () => CALLER),
    ensureAddress: jest.fn(async () => CALLER),
    readContract: jest.fn(async () => OWNER),
    writeContract: jest.fn(async () => '0x1' as Hex),
    sendTransaction: jest.fn(async () => '0x1' as Hex),
    waitForTransaction: jest.fn(async ({ hash }) => makeReceipt(hash)),
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

function makeSdkStub(args: {
  chainClient: any;
  ipfsClient?: {
    addRegistrationFile: (
      file: RegistrationFile,
      chainId?: number,
      identityRegistry?: string
    ) => Promise<string>;
  };
}): SDK {
  return {
    chainClient: args.chainClient,
    ipfsClient: args.ipfsClient,
    identityRegistryAddress: () => IDENTITY_REGISTRY,
    chainId: async () => 1,
    isReadOnly: false,
  } as unknown as SDK;
}

describe('Agent regressions', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('rejects first-time registerIPFS when the follow-up setAgentURI transaction reverts', async () => {
    const chainClient = makeChainClient({
      writeContract: jest
        .fn()
        .mockImplementationOnce(async () => '0x1000' as Hex)
        .mockImplementationOnce(async () => '0x2000' as Hex),
      waitForTransaction: jest.fn(async ({ hash }) =>
        hash === '0x2000' ? makeReceipt(hash, 'reverted') : makeReceipt(hash, 'success')
      ),
    });
    const sdk = makeSdkStub({
      chainClient,
      ipfsClient: {
        addRegistrationFile: jest.fn(async () => 'bafy-test-cid'),
      },
    });
    const agent = new Agent(sdk, makeRegistrationFile());
    (agent as any)._extractAgentIdFromReceipt = () => 7n;

    const tx = await agent.registerIPFS();

    await expect(tx.waitConfirmed()).rejects.toThrow('Transaction reverted: 0x2000');
    expect(agent.agentId).toBe('1:7');
    expect(agent.agentURI).toBeUndefined();
  });

  it('keeps dirty metadata after a failed metadata sync during IPFS re-registration', async () => {
    const chainClient = makeChainClient({
      writeContract: jest
        .fn()
        .mockImplementationOnce(async () => '0x3000' as Hex)
        .mockImplementationOnce(async () => '0x4000' as Hex),
      waitForTransaction: jest.fn(async ({ hash }) =>
        hash === '0x4000' ? makeReceipt(hash, 'reverted') : makeReceipt(hash, 'success')
      ),
    });
    const sdk = makeSdkStub({
      chainClient,
      ipfsClient: {
        addRegistrationFile: jest.fn(async () => 'bafy-updated'),
      },
    });
    const agent = new Agent(
      sdk,
      makeRegistrationFile({
        agentId: '1:7',
        agentURI: 'ipfs://old',
      })
    );

    agent.setMetadata({ profile: 'updated', title: 'retry-me-later' });

    const tx = await agent.registerIPFS();
    const { result } = await tx.waitConfirmed();

    expect(result.agentURI).toBe('ipfs://bafy-updated');
    expect((agent as any)._dirtyMetadata.has('profile')).toBe(true);
    expect((agent as any)._dirtyMetadata.has('title')).toBe(true);
    expect(
      (chainClient.writeContract as jest.Mock).mock.calls.map((call: any[]) => call[0].functionName)
    ).toEqual(['setAgentURI', 'setMetadata']);
  });

  it('syncs dirty metadata when registerHTTP updates an already-registered agent', async () => {
    const chainClient = makeChainClient({
      writeContract: jest
        .fn()
        .mockImplementationOnce(async () => '0x5000' as Hex)
        .mockImplementationOnce(async () => '0x6000' as Hex),
    });
    const sdk = makeSdkStub({ chainClient });
    const agent = new Agent(
      sdk,
      makeRegistrationFile({
        agentId: '1:7',
        agentURI: 'https://example.com/old.json',
      })
    );

    agent.setMetadata({ profile: 'fresh' });

    const tx = await agent.registerHTTP('https://example.com/new.json');
    const { result } = await tx.waitConfirmed();

    expect(result.agentURI).toBe('https://example.com/new.json');
    expect((agent as any)._dirtyMetadata.size).toBe(0);
    expect(
      (chainClient.writeContract as jest.Mock).mock.calls.map((call: any[]) => call[0].functionName)
    ).toEqual(['setAgentURI', 'setMetadata']);
  });

  it('uses the actual owner as transferFrom source so approved operators can transfer', async () => {
    const chainClient = makeChainClient({
      readContract: jest.fn(async () => OWNER),
      writeContract: jest.fn(async () => '0x7000' as Hex),
    });
    const sdk = makeSdkStub({ chainClient });
    const agent = new Agent(
      sdk,
      makeRegistrationFile({
        agentId: '1:7',
      })
    );

    const tx = await agent.transfer(RECIPIENT);
    const { result } = await tx.waitConfirmed();

    expect(((chainClient.writeContract as jest.Mock).mock.calls[0] as any[])[0].args).toEqual([
      OWNER,
      RECIPIENT,
      7n,
    ]);
    expect(result.from).toBe(OWNER);
    expect(result.to).toBe(RECIPIENT);
  });

  it('rejects unsupported URI schemes during registration and updates', async () => {
    const chainClient = makeChainClient();
    const sdk = makeSdkStub({ chainClient });
    const unregisteredAgent = new Agent(sdk, makeRegistrationFile());
    const registeredAgent = new Agent(
      sdk,
      makeRegistrationFile({
        agentId: '1:7',
      })
    );

    await expect(unregisteredAgent.registerHTTP('data:text/plain,hello')).rejects.toThrow(
      'Unsupported URI scheme'
    );
    await expect(registeredAgent.setAgentURI('ftp://example.com/agent.json')).rejects.toThrow(
      'Unsupported URI scheme'
    );
  });
});
