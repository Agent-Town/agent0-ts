/**
 * Feedback End-to-End (Endpoint Variants)
 *
 * Submits exactly two feedback txs with the same tag pair:
 * - one WITHOUT endpoint (omitted)
 * - one WITH a short endpoint domain (e.g. "nytimes.com")
 *
 * Then it polls the subgraph until both are indexed (searchFeedback is subgraph-only)
 * and prints the retrieved feedback entries so you can verify endpoint behavior.
 *
 * Requirements:
 * - RPC_URL
 * - PRIVATE_KEY (or AGENT_PRIVATE_KEY)
 * - AGENT_ID (chainId:tokenId)
 *
 * Optional:
 * - SUBGRAPH_URL
 * - MAX_POLL_SECONDS (default 120)
 * - POLL_INTERVAL_MS (default 5000)
 */

import './_env.js';
import { SDK, type Feedback } from '../src/index.js';
import { formatFeedbackId, parseAgentId } from '../src/utils/id-format.js';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === '') throw new Error(`${name} is required for this example`);
  return v.trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

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

  // Use values/tags taken directly from feedback-end-to-end.ts
  const tag1 = 'quality';
  const tag2 = 'latency';
  const valueNoEndpoint = '91.5';
  const valueWithEndpoint = '88.125';

  console.log(`Submitting 2 feedback txs to agent ${agentId} on chain ${chainId}...`);

  // 1) No endpoint (omit the parameter)
  const tx1 = await sdk.giveFeedback(agentId, valueNoEndpoint, tag1, tag2);
  const { result: fb1 } = await tx1.waitConfirmed();
  console.log(
    `- no-endpoint: id=${formatFeedbackId(fb1.id[0], fb1.id[1], fb1.id[2])}` +
      ` value=${fb1.value} tags=${fb1.tags.join(',')} endpoint=${fb1.endpoint ?? ''}` +
      ` txHash=${fb1.txHash ?? tx1.hash ?? ''}`
  );

  // 2) Very short endpoint domain
  const shortEndpoint = 'nytimes.com';
  const tx2 = await sdk.giveFeedback(agentId, valueWithEndpoint, tag1, tag2, shortEndpoint);
  const { result: fb2 } = await tx2.waitConfirmed();
  console.log(
    `- short-endpoint: id=${formatFeedbackId(fb2.id[0], fb2.id[1], fb2.id[2])}` +
      ` value=${fb2.value} tags=${fb2.tags.join(',')} endpoint=${fb2.endpoint ?? ''}` +
      ` txHash=${fb2.txHash ?? tx2.hash ?? ''}`
  );

  const reviewer = fb1.reviewer.toLowerCase();
  if (fb2.reviewer.toLowerCase() !== reviewer) {
    throw new Error(`Expected same reviewer for both txs, got ${reviewer} vs ${fb2.reviewer}`);
  }

  // --- Poll subgraph until both feedback entries appear ---
  const maxPollSeconds = process.env.MAX_POLL_SECONDS ? parseInt(process.env.MAX_POLL_SECONDS, 10) : 120;
  const pollIntervalMs = process.env.POLL_INTERVAL_MS ? parseInt(process.env.POLL_INTERVAL_MS, 10) : 5000;
  const maxAttempts = Math.max(1, Math.ceil((maxPollSeconds * 1000) / pollIntervalMs));

  console.log(`\nWaiting for subgraph indexing (up to ${maxPollSeconds}s, every ${pollIntervalMs}ms)...`);
  let results: Feedback[] = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    results = await sdk.searchFeedback({ agentId, reviewers: [reviewer], tags: [tag2] });

    const foundNoEndpoint = results.find(
      (f) => Number(f.value) === Number(valueNoEndpoint) && Array.isArray(f.tags) && f.tags.includes(tag2)
    );
    const foundShortEndpoint = results.find(
      (f) =>
        Number(f.value) === Number(valueWithEndpoint) &&
        Array.isArray(f.tags) &&
        f.tags.includes(tag2) &&
        typeof f.endpoint === 'string' &&
        f.endpoint === shortEndpoint
    );

    console.log(
      `- poll ${attempt}/${maxAttempts}: found no-endpoint=${Boolean(foundNoEndpoint)} short-endpoint=${Boolean(
        foundShortEndpoint
      )}`
    );

    if (foundNoEndpoint && foundShortEndpoint) break;
    await sleep(pollIntervalMs);
  }

  // Re-fetch for printing (latest view)
  results = await sdk.searchFeedback({ agentId, reviewers: [reviewer], tags: [tag2] });

  const picked = results
    .filter((f) => Number(f.value) === Number(valueNoEndpoint) || Number(f.value) === Number(valueWithEndpoint))
    .sort((a, b) => Number(a.id?.[2] ?? 0) - Number(b.id?.[2] ?? 0));

  console.log('\nRetrieved via searchFeedback (filtered by value):');
  for (const fb of picked) {
    console.log(
      `- id=${formatFeedbackId(fb.id[0], fb.id[1], fb.id[2])} value=${fb.value} tags=${fb.tags.join(',')} endpoint=${
        fb.endpoint ?? ''
      }`
    );
  }

  const hasNoEndpoint = picked.some((f) => Number(f.value) === Number(valueNoEndpoint) && !f.endpoint);
  const hasShortEndpoint = picked.some((f) => Number(f.value) === Number(valueWithEndpoint) && f.endpoint === shortEndpoint);
  if (!hasNoEndpoint || !hasShortEndpoint) {
    throw new Error(
      `Did not observe expected endpoint behavior from searchFeedback. ` +
        `hasNoEndpoint=${hasNoEndpoint} hasShortEndpoint=${hasShortEndpoint}`
    );
  }

  console.log('\nOK: endpoint variants observed as expected.');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

