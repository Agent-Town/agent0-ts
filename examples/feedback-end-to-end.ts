/**
 * Feedback End-to-End Example
 *
 * This example submits multiple feedback transactions with:
 * - decimal values (encoded on-chain as value + valueDecimals)
 * - different tag pairs (tag1/tag2)
 * - distinct endpoints per feedback (used as a stable "run id" marker)
 *
 * Then it:
 * - polls the subgraph until the new feedback is indexed (required for searchFeedback)
 * - uses searchFeedback() to retrieve a subset by tag
 * - uses getReputationSummary() to compute an aggregated average for the same tag-pair subset
 *
 * Requirements (real transactions / real data):
 * - RPC_URL: RPC endpoint for the chain you target (e.g. Sepolia)
 * - PRIVATE_KEY (or AGENT_PRIVATE_KEY): funded key to pay gas for giveFeedback txs
 * - AGENT_ID: an existing agent id on that chain, in `chainId:tokenId` format (e.g. 11155111:123)
 *
 * Optional:
 * - SUBGRAPH_URL: override subgraph URL if you're testing a custom deployment
 * - MAX_POLL_SECONDS: how long to wait for subgraph indexing (default 180)
 * - POLL_INTERVAL_MS: poll interval (default 5000)
 */

import './_env.js';
import { SDK, type Feedback } from '../src/index.js';
import { formatFeedbackId, parseAgentId } from '../src/utils/id-format.js';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === '') throw new Error(`${name} is required for this example`);
  return v;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

type FeedbackPlanItem = {
  value: string; // keep as string to avoid JS float surprises
  tag1: string;
  tag2: string;
};

async function main() {
  const rpcUrl = requireEnv('RPC_URL');
  const privateKey = process.env.PRIVATE_KEY ?? process.env.AGENT_PRIVATE_KEY;
  if (!privateKey || privateKey.trim() === '') {
    throw new Error('PRIVATE_KEY (or AGENT_PRIVATE_KEY) is required for this example (giving feedback is a tx)');
  }

  const agentId = requireEnv('AGENT_ID');
  const { chainId } = parseAgentId(agentId);
  const subgraphUrl = process.env.SUBGRAPH_URL;

  const sdk = new SDK({
    chainId,
    rpcUrl,
    privateKey,
    ...(subgraphUrl ? { subgraphUrl } : {}),
  });

  // Unique marker for this run. We'll embed this into the on-chain `endpoint` field.
  const runId = `e2e-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const endpointBase = `https://example.com/agent0/feedback?run=${encodeURIComponent(runId)}`;

  // We’ll submit many feedback entries. We’ll later retrieve a subset where tag2 === 'latency'
  // and compare getReputationSummary(agentId, 'quality', 'latency') with our expected average.
  const planned: FeedbackPlanItem[] = [
    { value: '91.5', tag1: 'quality', tag2: 'latency' },
    { value: '88.125', tag1: 'quality', tag2: 'latency' },
    { value: '76.3333', tag1: 'quality', tag2: 'latency' },
    { value: '99.99', tag1: 'quality', tag2: 'accuracy' },
    { value: '84.25', tag1: 'quality', tag2: 'helpfulness' },
    { value: '73.75', tag1: 'quality', tag2: 'documentation' },
    { value: '67.5', tag1: 'quality', tag2: 'ux' },
    { value: '92.01', tag1: 'quality', tag2: 'reliability' },
    { value: '80.8', tag1: 'quality', tag2: 'latency' },
    { value: '55.05', tag1: 'quality', tag2: 'latency' },
  ];

  console.log(`Submitting ${planned.length} feedback txs to agent ${agentId} on chain ${chainId}...`);
  console.log(`Run marker: ${runId}`);

  const submittedEndpoints: string[] = [];
  const reviewerAddresses = new Set<string>();

  for (let i = 0; i < planned.length; i++) {
    const item = planned[i];
    const endpoint = `${endpointBase}&i=${i}&t=${encodeURIComponent(item.tag2)}`;
    submittedEndpoints.push(endpoint);

    const tx = await sdk.giveFeedback(agentId, item.value, item.tag1, item.tag2, endpoint);
    const { result: feedback } = await tx.waitConfirmed();
    reviewerAddresses.add(feedback.reviewer.toLowerCase());

    console.log(
      `- submitted ${i + 1}/${planned.length}: id=${formatFeedbackId(feedback.id[0], feedback.id[1], feedback.id[2])}` +
        ` value=${feedback.value} tags=${feedback.tags.join(',')} endpoint=${feedback.endpoint ?? ''}` +
        ` txHash=${feedback.txHash ?? tx.hash ?? ''}`
    );
  }

  if (reviewerAddresses.size !== 1) {
    throw new Error(`Expected a single reviewer address, got ${Array.from(reviewerAddresses).join(', ')}`);
  }
  const reviewer = Array.from(reviewerAddresses)[0];

  // --- Poll subgraph until the new feedback appears (searchFeedback is subgraph-only) ---
  const maxPollSeconds = process.env.MAX_POLL_SECONDS ? parseInt(process.env.MAX_POLL_SECONDS, 10) : 180;
  const pollIntervalMs = process.env.POLL_INTERVAL_MS ? parseInt(process.env.POLL_INTERVAL_MS, 10) : 5000;
  const maxAttempts = Math.max(1, Math.ceil((maxPollSeconds * 1000) / pollIntervalMs));

  console.log(`\nWaiting for subgraph indexing (up to ${maxPollSeconds}s, every ${pollIntervalMs}ms)...`);
  let indexed: Feedback[] = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    indexed = await sdk.searchFeedback({ agentId, reviewers: [reviewer] });
    const foundEndpoints = new Set(indexed.map((f) => f.endpoint).filter(Boolean));
    const foundCount = submittedEndpoints.filter((ep) => foundEndpoints.has(ep)).length;
    console.log(`- poll ${attempt}/${maxAttempts}: found ${foundCount}/${submittedEndpoints.length} endpoints`);
    if (foundCount >= submittedEndpoints.length) break;
    await sleep(pollIntervalMs);
  }

  const indexedEndpoints = new Set(indexed.map((f) => f.endpoint).filter(Boolean));
  const missing = submittedEndpoints.filter((ep) => !indexedEndpoints.has(ep));
  if (missing.length > 0) {
    throw new Error(
      `Subgraph did not index all submitted feedback within timeout. Missing ${missing.length} endpoints.\n` +
        `Try increasing MAX_POLL_SECONDS or check your subgraph deployment.\n` +
        `First missing: ${missing[0]}`
    );
  }

  // --- Use searchFeedback to pick a subset by tag (latency) and value range ---
  console.log('\nSearching for subset: tag="latency" for this reviewer + agent...');
  const latencyResults = await sdk.searchFeedback(
    { agentId, reviewers: [reviewer], tags: ['latency'] },
    { minValue: 0, maxValue: 100 }
  );
  const latencyFromThisRun = latencyResults.filter((f) => f.endpoint && indexedEndpoints.has(f.endpoint));
  console.log(`Found ${latencyFromThisRun.length} feedback entries (this run) with tag "latency"`);
  for (const fb of latencyFromThisRun) {
    console.log(
      `- id=${formatFeedbackId(fb.id[0], fb.id[1], fb.id[2])} value=${fb.value} tags=${fb.tags.join(',')} endpoint=${
        fb.endpoint ?? ''
      }`
    );
  }

  // --- Use getReputationSummary to aggregate for the same tag pair ---
  console.log('\nGetting reputation summary for tag pair ("quality","latency")...');
  const summary = await sdk.getReputationSummary(agentId, 'quality', 'latency');
  console.log(`Summary: count=${summary.count} averageValue=${summary.averageValue}`);

  // Compute expected average for this run (quality+latency subset only)
  const expectedLatencyValues = planned
    .filter((p) => p.tag1 === 'quality' && p.tag2 === 'latency')
    .map((p) => Number(p.value));
  const expectedAvg =
    expectedLatencyValues.reduce((sum, v) => sum + v, 0) / Math.max(1, expectedLatencyValues.length);
  const expectedAvgRounded = Math.round(expectedAvg * 100) / 100;
  console.log(
    `Expected (this run): count=${expectedLatencyValues.length} averageValue≈${expectedAvgRounded} ` +
      `(unrounded=${expectedAvg})`
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

