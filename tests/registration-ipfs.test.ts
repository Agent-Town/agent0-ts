/**
 * Integration test for Agent Registration with IPFS Pin (using Pinata)
 * Creates an agent, registers it with an IPFS-hosted registration file (agentURI),
 * updates it (publishes a new IPFS registration file and updates agentURI on-chain),
 * reloads it, and verifies data integrity.
 */

import { SDK } from '../src/index';
import { CHAIN_ID, RPC_URL, AGENT_PRIVATE_KEY, PINATA_JWT, printConfig } from './config';
import { privateKeyToAccount } from 'viem/accounts';
import { randomBytes } from 'crypto';

const HAS_REQUIRED_ENV = Boolean(
  RPC_URL &&
    RPC_URL.trim() !== '' &&
    AGENT_PRIVATE_KEY &&
    AGENT_PRIVATE_KEY.trim() !== '' &&
    PINATA_JWT &&
    PINATA_JWT.trim() !== ''
);
// Live/integration test (on-chain + IPFS).
// Default: enabled when env vars are present. Set RUN_LIVE_TESTS=0 to disable.
const RUN_LIVE_TESTS = process.env.RUN_LIVE_TESTS !== '0';
const LIVE_TX_TIMEOUT_MS = Number(process.env.LIVE_TX_TIMEOUT_MS || '420000');
const describeMaybe = RUN_LIVE_TESTS && HAS_REQUIRED_ENV ? describe : describe.skip;

function generateRandomData() {
  const randomSuffix = Math.floor(Math.random() * 9000) + 1000;
  const timestamp = Math.floor(Date.now() / 1000);

  return {
    name: `Test Agent ${randomSuffix}`,
    description: `Created at ${timestamp}`,
    image: `https://example.com/image_${randomSuffix}.png`,
    mcpEndpoint: `https://api.example.com/mcp/${randomSuffix}`,
    mcpVersion: `2025-06-${Math.floor(Math.random() * 28) + 1}`,
    a2aEndpoint: `https://api.example.com/a2a/${randomSuffix}.json`,
    a2aVersion: `0.${Math.floor(Math.random() * 6) + 30}`,
    ensName: `test${randomSuffix}.eth`,
    ensVersion: `1.${Math.floor(Math.random() * 10)}`,
    walletAddress: `0x${'a'.repeat(40)}`,
    walletChainId: [1, 11155111, 8453, 137, 42161][Math.floor(Math.random() * 5)],
    active: true,
    x402support: false,
    reputation: Math.random() > 0.5,
    cryptoEconomic: Math.random() > 0.5,
    teeAttestation: Math.random() > 0.5,
  };
}

describeMaybe('Agent Registration with IPFS Pin', () => {
  let sdk: SDK;
  let testData: ReturnType<typeof generateRandomData>;
  let agentId: string;
  let agent: any; // reuse the same agent instance to avoid relying on on-chain URI updates

  beforeAll(() => {
    printConfig();
  });

  it('should register new agent with IPFS', async () => {
    // SDK Configuration with Pinata IPFS
    const sdkConfig = {
      chainId: CHAIN_ID,
      rpcUrl: RPC_URL,
      privateKey: AGENT_PRIVATE_KEY,
      ipfs: 'pinata' as const,
      pinataJwt: PINATA_JWT,
    };

    sdk = new SDK(sdkConfig);
    testData = generateRandomData();

    agent = sdk.createAgent(testData.name, testData.description, testData.image);

    await agent.setMCP(testData.mcpEndpoint, testData.mcpVersion, false); // Disable endpoint crawling (2B)
    await agent.setA2A(testData.a2aEndpoint, testData.a2aVersion, false); // Disable endpoint crawling (2B)
    agent.setENS(testData.ensName, testData.ensVersion);
    agent.setActive(testData.active);
    agent.setX402Support(testData.x402support);
    agent.setTrust(testData.reputation, testData.cryptoEconomic, testData.teeAttestation);

    const regTx = await agent.registerIPFS();
    const { result: registrationFile } = await regTx.waitConfirmed({ timeoutMs: LIVE_TX_TIMEOUT_MS });
    agentId = registrationFile.agentId!;

    expect(agentId).toBeTruthy();
    expect(registrationFile.agentURI).toBeTruthy();
    expect(registrationFile.agentURI!.startsWith('ipfs://')).toBe(true);
  });

  it('should set agent wallet on-chain', async () => {
    if (!agent) {
      throw new Error('Agent not initialized from previous test');
    }
    const ephemeralKey = `0x${randomBytes(32).toString('hex')}` as `0x${string}`;
    const secondWalletAddress = privateKeyToAccount(ephemeralKey).address;
    // 1.4.0 behavior: zero address is treated as "unset". Some deployments may set a non-zero default wallet.
    // We only assert that after setWallet (or no-op) the readback equals the intended wallet.
    const walletTx = await agent.setWallet(secondWalletAddress, { newWalletPrivateKey: ephemeralKey });
    // If already set, SDK returns undefined (no-op).
    if (walletTx) {
      await walletTx.waitConfirmed({ timeoutMs: LIVE_TX_TIMEOUT_MS });
    }
    const after = await agent.getWallet();
    expect(after).toBe(secondWalletAddress);
  });

  it(
    'should update agent registration',
    async () => {
      // Reuse the existing agent object instead of loadAgent(), since some deployments
      // may not support on-chain URI updates (setAgentURI), which loadAgent depends on.
      if (!agent) {
        throw new Error('Agent not initialized from previous test');
      }

    const randomSuffix = Math.floor(Math.random() * 90000) + 10000;

    agent.updateInfo(
      testData.name + ' UPDATED',
      testData.description + ' - UPDATED',
      `https://example.com/image_${Math.floor(Math.random() * 9000) + 1000}_updated.png`
    );
      await agent.setMCP(
        `https://api.example.com/mcp/${randomSuffix}`,
        `2025-06-${Math.floor(Math.random() * 28) + 1}`,
        false
      ); // Disable endpoint crawling (2B)
    await agent.setA2A(
      `https://api.example.com/a2a/${randomSuffix}.json`,
      `0.${Math.floor(Math.random() * 6) + 30}`,
      false // Disable endpoint crawling (2B)
    );

      // agentWallet flow is tested separately.
    agent.setENS(`${testData.ensName}.updated`, `1.${Math.floor(Math.random() * 10)}`);
    agent.setActive(false);
    agent.setX402Support(true);
    agent.setTrust(Math.random() > 0.5, Math.random() > 0.5, Math.random() > 0.5);
    agent.setMetadata({
      testKey: 'testValue',
      timestamp: Math.floor(Date.now() / 1000),
      customField: 'customValue',
      anotherField: 'anotherValue',
      numericField: Math.floor(Math.random() * 9000) + 1000,
    });

    const updateTx = await agent.registerIPFS();
    const { result: updatedRegistrationFile } = await updateTx.waitConfirmed({ timeoutMs: LIVE_TX_TIMEOUT_MS });
    expect(updatedRegistrationFile.agentURI).toBeTruthy();
    },
    LIVE_TX_TIMEOUT_MS + 60000
  );

  it('should reload and verify updated agent', async () => {
    // Wait for blockchain transaction to be mined
    await new Promise((resolve) => setTimeout(resolve, 15000)); // 15 seconds

    const reloadedAgent = await sdk.loadAgent(agentId);
    expect(reloadedAgent.name).toBe(testData.name + ' UPDATED');
    expect(reloadedAgent.description).toContain('UPDATED');
    expect(reloadedAgent.getRegistrationFile().active).toBe(false);
    expect(reloadedAgent.getRegistrationFile().x402support).toBe(true);
  });
});
