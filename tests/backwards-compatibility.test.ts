import fs from 'fs';
import path from 'path';
import { IPFSClient, SDK } from '../src/index.js';

describe('Backwards compatibility checks', () => {
  it('[R30] SDK.giveFeedback call shape remains unchanged', () => {
    expect(typeof SDK.prototype.giveFeedback).toBe('function');
    expect(SDK.prototype.giveFeedback.length).toBe(6);
  });

  it('[R31] registration JSON retains required ERC-8004 fields', () => {
    const sdk = new SDK({ chainId: 1, rpcUrl: 'http://localhost:8545' });
    const agent = sdk.createAgent('Agent', 'Desc');
    const client = new IPFSClient({ pinataEnabled: true, pinataJwt: 'jwt' });
    const data = client.buildRegistrationJson(agent.getRegistrationFile());

    expect(typeof data.type).toBe('string');
    expect(typeof data.name).toBe('string');
    expect(typeof data.description).toBe('string');
    expect(Array.isArray(data.services)).toBe(true);
    expect(typeof data.active).toBe('boolean');
    expect(typeof data.x402Support).toBe('boolean');
  });

  it('[R34] existing feedback integration suite remains present', () => {
    const feedbackTest = path.join(process.cwd(), 'tests', 'feedback.test.ts');
    expect(fs.existsSync(feedbackTest)).toBe(true);
  });
});
