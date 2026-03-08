/**
 * Integration test for Agent Registration with HTTP URI
 * Creates an agent, registers it with a mock HTTP URI, updates it, and verifies data integrity.
 */

import { SDK } from '../src/index';
import { CHAIN_ID, RPC_URL, AGENT_PRIVATE_KEY, printConfig } from './config';
import { privateKeyToAccount } from 'viem/accounts';
import { randomBytes } from 'crypto';

const HAS_AGENT_KEY = Boolean(AGENT_PRIVATE_KEY && AGENT_PRIVATE_KEY.trim() !== '');
// Live/integration test (on-chain).
// Default: enabled when env vars are present. Set RUN_LIVE_TESTS=0 to disable.
const RUN_LIVE_TESTS = process.env.RUN_LIVE_TESTS !== '0';
const describeMaybe = RUN_LIVE_TESTS && HAS_AGENT_KEY ? describe : describe.skip;

function isSkippableLiveError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  return (
    normalized.includes('timed out') ||
    normalized.includes('timeout') ||
    normalized.includes('insufficient funds') ||
    normalized.includes('gas required exceeds allowance')
  );
}

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

async function liveSignatureDeadline(sdk: SDK): Promise<number> {
  const chainNow = Number(await sdk.chainClient.getBlockTimestamp('latest'));
  return chainNow + 300;
}

describeMaybe('Agent Registration with HTTP URI', () => {
  let sdk: SDK;
  let testData: ReturnType<typeof generateRandomData>;
  let agentId: string;
  let mockUri: string;
  let agent: any; // Keep agent object from first test to reuse (Option 1A)

  beforeAll(() => {
    printConfig();
  });

  it('should register agent on-chain with mock HTTP URI', async () => {
    // SDK Configuration - no IPFS
    const sdkConfig = {
      chainId: CHAIN_ID,
      rpcUrl: RPC_URL,
      privateKey: AGENT_PRIVATE_KEY,
    };

    sdk = new SDK(sdkConfig);
    testData = generateRandomData();

    agent = sdk.createAgent(testData.name, testData.description, testData.image);

    // Register with mock URI to get agentId
    mockUri = 'https://example.com/agents/registration.json';
    try {
      const regTx = await agent.registerHTTP(mockUri);
      const { result: registrationFile } = await regTx.waitConfirmed({ timeoutMs: 300_000 });
      agentId = registrationFile.agentId!;
    } catch (error) {
      if (isSkippableLiveError(error)) {
        console.warn(`[live-test] Skipping HTTP registration due to chain/RPC issue: ${String(error)}`);
        return;
      }
      throw error;
    }

    expect(agentId).toBeTruthy();
    expect(agent.agentURI).toBe(mockUri);
  });

  it('should configure agent details and generate registration file', async () => {
    if (!agentId) {
      console.warn('[live-test] Skipping HTTP registration file assertions because registration did not complete.');
      return;
    }

    // Option 1A: Reuse agent object from first test instead of calling loadAgent
    // (which would try to fetch from mock URL and fail with 404)
    // This matches the Python test flow exactly

    await agent.setMCP(testData.mcpEndpoint, testData.mcpVersion, false);
    await agent.setA2A(testData.a2aEndpoint, testData.a2aVersion, false);
    agent.setENS(testData.ensName, testData.ensVersion);
    agent.setActive(testData.active);
    agent.setX402Support(testData.x402support);
    agent.setTrust(testData.reputation, testData.cryptoEconomic, testData.teeAttestation);

    // Verify the registration file is serializable.
    const registrationFile = agent.getRegistrationFile();
    const registrationJson = JSON.stringify(registrationFile, null, 2);
    const parsedRegistration = JSON.parse(registrationJson);

    expect(registrationFile.name).toBe(testData.name);
    expect(registrationFile.description).toBe(testData.description);
    expect(parsedRegistration.name).toBe(testData.name);
  });

  it(
    'should update agent and re-register',
    async () => {
      if (!agentId) {
        console.warn('[live-test] Skipping HTTP re-registration because registration did not complete.');
        return;
      }

      // Option 1A: Continue using the same agent object (don't call loadAgent which would fail with 404)
      // This matches the Python test flow exactly

      agent.updateInfo(
        testData.name + ' UPDATED',
        testData.description + ' - UPDATED',
        `https://example.com/image_${Math.floor(Math.random() * 9000) + 1000}_updated.png`
      );

      const randomSuffix = Math.floor(Math.random() * 90000) + 10000;
      await agent.setMCP(
        `https://api.example.com/mcp/${randomSuffix}`,
        `2025-06-${Math.floor(Math.random() * 28) + 1}`,
        false
      );
      await agent.setA2A(
        `https://api.example.com/a2a/${randomSuffix}.json`,
        `0.${Math.floor(Math.random() * 6) + 30}`,
        false
      );
      // Wallet-signing flow is tested separately below with an ephemeral signer.
      agent.setENS(`${testData.ensName}.updated`, `1.${Math.floor(Math.random() * 10)}`);
      agent.setActive(false);
      agent.setX402Support(true);
      agent.setTrust(Math.random() > 0.5, Math.random() > 0.5, Math.random() > 0.5);
      agent.setMetadata({
        testKey: `testValue-${randomSuffix}`,
      });

      // Update registration file and re-register
      const registrationFileUpdated = agent.getRegistrationFile();
      const registrationJsonUpdated = JSON.stringify(registrationFileUpdated, null, 2);

      const parsedRegistrationUpdated = JSON.parse(registrationJsonUpdated);

      const updateTx = await agent.registerHTTP(mockUri);
      try {
        await updateTx.waitConfirmed({ timeoutMs: 300_000 });
      } catch (error) {
        if (isSkippableLiveError(error)) {
          console.warn(`[live-test] Skipping HTTP re-registration confirmation due to chain/RPC issue: ${String(error)}`);
          return;
        }
        throw error;
      }

      expect(agent.name).toBe(testData.name + ' UPDATED');
      expect(parsedRegistrationUpdated.name).toBe(testData.name + ' UPDATED');
    },
    420_000
  );

  it('should reload and verify updated agent', async () => {
    if (!agentId) {
      console.warn('[live-test] Skipping post-update HTTP assertions because registration did not complete.');
      return;
    }

    // Wait for blockchain transaction to be mined
    await new Promise((resolve) => setTimeout(resolve, 15000)); // 15 seconds

    // Option 1A: Since we're using a mock URL that doesn't exist, we can't call loadAgent
    // Instead, verify the agent object state directly (it was already updated in previous test)
    // Note: In production with a real hosted URL, you would call loadAgent here
    // This matches Python test behavior where loadAgent is called but would fail with mock URL
    
    expect(agent.name).toBe(testData.name + ' UPDATED');
    expect(agent.description).toContain('UPDATED');
    expect(agent.getRegistrationFile().active).toBe(false);
    expect(agent.getRegistrationFile().x402support).toBe(true);
    
    // Verify the agent ID matches what was registered
    expect(agent.agentId).toBe(agentId);
  });

  it('should set agent wallet on-chain with an ephemeral signer', async () => {
    if (!agent?.agentId) {
      console.warn('[live-test] Skipping setWallet because the agent was not registered.');
      return;
    }
    const ephemeralKey = `0x${randomBytes(32).toString('hex')}` as `0x${string}`;
    const secondWalletAddress = privateKeyToAccount(ephemeralKey).address;
    // 1.4.0 behavior: zero address is treated as "unset". Some deployments may set a non-zero default wallet.
    // We only assert that after setWallet (or no-op) the readback equals the intended wallet.
    let walletTx: any;
    try {
      walletTx = await agent.setWallet(secondWalletAddress, {
        newWalletPrivateKey: ephemeralKey,
        deadline: await liveSignatureDeadline(sdk),
      });
    } catch (error) {
      if (isSkippableLiveError(error)) {
        console.warn(`[live-test] Skipping setWallet due to chain/RPC issue: ${String(error)}`);
        return;
      }
      throw error;
    }
    if (walletTx) {
      try {
        await walletTx.waitConfirmed({ timeoutMs: 300_000 });
      } catch (error) {
        if (isSkippableLiveError(error)) {
          console.warn(`[live-test] Skipping setWallet confirmation due to chain/RPC issue: ${String(error)}`);
          return;
        }
        throw error;
      }
    }
    const after = await agent.getWallet();
    expect(after).toBe(secondWalletAddress);
  }, 420_000);
});
