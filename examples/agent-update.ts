/**
 * Agent Update Example
 * 
 * This example demonstrates how to:
 * 1. Create and register a new agent (so the signer is the owner)
 * 2. Load that agent back from chain/IPFS
 * 3. Update agent information
 * 4. Update the registration file on-chain (re-register)
 */

import './_env.js';
import { SDK } from '../src/index.js';

async function main() {
  const rpcUrl = process.env.RPC_URL;
  const privateKey = process.env.PRIVATE_KEY ?? process.env.AGENT_PRIVATE_KEY;
  const pinataJwt = process.env.PINATA_JWT;

  if (!rpcUrl || rpcUrl.trim() === '') {
    throw new Error('RPC_URL is required for this example');
  }
  if (!privateKey || privateKey.trim() === '') {
    throw new Error('PRIVATE_KEY (or AGENT_PRIVATE_KEY) is required for this example');
  }
  if (!pinataJwt || pinataJwt.trim() === '') {
    throw new Error('PINATA_JWT is required for this example (registerIPFS uses pinata)');
  }

  // Initialize SDK
  const sdk = new SDK({
    chainId: 11155111, // Ethereum Sepolia
    rpcUrl,
    privateKey, // Required for updates
    ipfs: 'pinata',
    pinataJwt,
  });

  // 1) Create + register a fresh agent (self-contained)
  const agent = sdk.createAgent(
    'Update Example Agent',
    'An agent created by the update example script.',
    'https://example.com/agent-image.png'
  );
  await agent.setMCP('https://api.example.com/mcp', '2025-06-18');
  agent.setActive(true);

  console.log('Registering a new agent (setup for this example)...');
  const registrationTx = await agent.registerIPFS();
  const { result: registration } = await registrationTx.waitConfirmed();
  if (!registration.agentId) {
    throw new Error('Registration failed: missing agentId');
  }

  const agentId = registration.agentId;
  console.log(`Registration tx hash: ${registrationTx.hash}`);
  console.log(`Registered agentId: ${agentId}`);

  // 2) Load it back
  const loaded = await sdk.loadAgent(agentId);

  console.log(`Loaded agent: ${loaded.name}`);
  console.log(`Current description: ${loaded.description}`);

  // 3) Update agent information
  loaded.updateInfo(
    'Updated AI Assistant',
    'Updated description with new skills and pricing'
  );

  // Update metadata
  loaded.setMetadata({
    version: '1.1.0',
    tags: ['data_analyst', 'finance', 'coding'],
    pricing: '0.015', // Updated pricing
  });

  // Update endpoints if needed
  await loaded.setMCP('https://api.example.com/mcp-updated', '2025-06-18');

  // Optional: setWallet is on-chain only and signature-gated in ERC-8004 Jan 2026.
  // Leaving it out here keeps the example focused on "update + re-register".
  // If you want to try it (one-wallet flow), uncomment:
  //
  // const newWalletAddress = (await sdk.chainClient.getAddress())!;
  // console.log('Setting agent wallet on-chain...');
  // const walletTxHash = await loaded.setWallet(newWalletAddress);
  // console.log(`Agent wallet updated. Transaction: ${walletTxHash || '(skipped - already set)'}`);

  // 4) Re-register with updated information
  console.log('Updating agent registration...');
  const updatedRegistrationTx = await loaded.registerIPFS();
  const { result: updatedRegistrationFile } = await updatedRegistrationTx.waitConfirmed();
  console.log(`Update tx hash: ${updatedRegistrationTx.hash}`);
  console.log(`Agent updated. New URI: ${updatedRegistrationFile.agentURI}`);
}

main().catch(console.error);
