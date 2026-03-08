import { TIMEOUTS } from '../utils/constants.js';

export type SemanticSearchResult = {
  chainId: number;
  agentId: string;
  score: number;
};

export interface SemanticSearchOptions {
  minScore?: number;
  topK?: number;
}

/**
 * Thin client for the external semantic-search endpoint.
 *
 * NOTE: Per requirement, we do not use semantic backend filtering; only `query`, `minScore`, `topK`.
 *
 * SDK defaults (applied here so developers don't need to pass them):
 * - minScore: 0.5
 * - topK: 5000
 */
export class SemanticSearchClient {
  constructor(
    private readonly baseUrl: string = 'https://semantic-search.ag0.xyz'
  ) {}

  async search(query: string, opts: SemanticSearchOptions = {}): Promise<SemanticSearchResult[]> {
    if (!query || !query.trim()) return [];

    const minScore = opts.minScore ?? 0.5;
    const limit = opts.topK ?? 5000;

    // API expects "limit" not "topK" (semantic-search.ag0.xyz v1)
    const body: Record<string, unknown> = { query: query.trim(), minScore, limit };
    const request = (timeoutMs: number) =>
      fetch(`${this.baseUrl}/api/v1/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });

    let res: Response;
    try {
      res = await request(TIMEOUTS.SEMANTIC_SEARCH);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const isTimeout =
        (typeof error === 'object' && error !== null && 'name' in error && (error as { name: string }).name === 'TimeoutError') ||
        msg.includes('aborted due to timeout');
      if (!isTimeout) throw error;
      // Retry once with a longer timeout for cold starts/spiky latency.
      res = await request(Math.max(TIMEOUTS.SEMANTIC_SEARCH * 2, 30000));
    }

    if (!res.ok) {
      throw new Error(`Semantic search failed: HTTP ${res.status}`);
    }

    const json: any = await res.json();
    const raw: any[] = Array.isArray(json?.results) ? json.results : Array.isArray(json) ? json : [];
    const results = raw.filter((r) => r != null && typeof r === 'object');

    return results
      .map((r) => ({
        chainId: Number(r.chainId),
        agentId: String(r.agentId),
        score: Number(r.score),
      }))
      .filter((r) => Number.isFinite(r.chainId) && r.agentId.includes(':') && Number.isFinite(r.score));
  }
}
