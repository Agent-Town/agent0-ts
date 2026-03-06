import { afterEach, describe, expect, it, jest } from '@jest/globals';

import { EndpointCrawler } from '../src/core/endpoint-crawler.js';

describe('EndpointCrawler regressions', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('normalizes trailing slashes before fetching MCP fallback agent cards', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (input: any, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return {
          ok: false,
          headers: { get: () => 'application/json' },
          text: async () => '',
        } as unknown as Response;
      }

      return {
        ok: true,
        json: async () => ({ tools: ['search'] }),
      } as unknown as Response;
    });

    const crawler = new EndpointCrawler(50);
    const capabilities = await crawler.fetchMcpCapabilities('https://example.com/');

    expect(capabilities?.mcpTools).toEqual(['search']);
    const requestedUrls = fetchSpy.mock.calls.map(([url]) => String(url));
    expect(requestedUrls).toContain('https://example.com/agentcard.json');
    expect(requestedUrls).not.toContain('https://example.com//agentcard.json');
  });
});
