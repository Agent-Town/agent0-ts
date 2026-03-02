import { AgentIndexer } from '../src/index.js';
import type { AgentSummary } from '../src/models/interfaces.js';

function makeSummary(overrides: Partial<AgentSummary> = {}): AgentSummary {
  return {
    chainId: 11155111,
    agentId: '11155111:1',
    name: 'Agent',
    description: 'Desc',
    owners: [],
    operators: [],
    supportedTrusts: [],
    a2aSkills: [],
    mcpTools: [],
    mcpPrompts: [],
    mcpResources: [],
    oasfSkills: [],
    oasfDomains: [],
    active: true,
    x402support: false,
    extras: {},
    ...overrides,
  };
}

function makeIndexer(items: AgentSummary[]): AgentIndexer {
  const client = {
    searchAgentsV2: jest.fn(async () => items),
    queryAgentMetadata: jest.fn(async () => []),
    queryFeedbacks: jest.fn(async () => []),
  };
  return new AgentIndexer(client as any, {}, 11155111);
}

describe('Entity type search filtering', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('[R25] single-value entityType filter returns matches only', async () => {
    const indexer = makeIndexer([
      makeSummary({ agentId: '11155111:1', entityType: 'tool' }),
      makeSummary({ agentId: '11155111:2', entityType: 'human' }),
    ]);

    const out = await indexer.searchAgents({ chains: [11155111], entityType: 'tool' });
    expect(out.map((a) => a.agentId)).toEqual(['11155111:1']);
  });

  it('[R26] array entityType filter applies ANY semantics', async () => {
    const indexer = makeIndexer([
      makeSummary({ agentId: '11155111:1', entityType: 'tool' }),
      makeSummary({ agentId: '11155111:2', entityType: 'human' }),
      makeSummary({ agentId: '11155111:3', entityType: 'organization' }),
    ]);

    const out = await indexer.searchAgents({
      chains: [11155111],
      entityType: ['tool', 'organization'],
    });
    expect(out.map((a) => a.agentId).sort()).toEqual(['11155111:1', '11155111:3']);
  });

  it('[R27] missing entityType defaults to agent', async () => {
    const indexer = makeIndexer([
      makeSummary({ agentId: '11155111:1', entityType: undefined, agentURI: undefined }),
      makeSummary({ agentId: '11155111:2', entityType: 'tool' }),
    ]);
    const out = await indexer.searchAgents({ chains: [11155111], entityType: 'agent' });
    expect(out.map((a) => a.agentId)).toEqual(['11155111:1']);
  });

  it('[R28] fallback hydrates from registration JSON when entityType is missing', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
        entityType: 'tool',
      }),
    } as any);

    const indexer = makeIndexer([
      makeSummary({ agentId: '11155111:1', entityType: undefined, agentURI: 'https://example.com/a.json' }),
    ]);
    const out = await indexer.searchAgents({ chains: [11155111], entityType: 'tool' });
    expect(fetchSpy).toHaveBeenCalled();
    expect(out).toHaveLength(1);
  });

  it('[R29] throws ENTITY_TYPE_FILTER_TOO_BROAD when fallback candidate set exceeds cap', async () => {
    const items = Array.from({ length: 201 }, (_, i) =>
      makeSummary({
        agentId: `11155111:${i + 1}`,
        entityType: undefined,
        agentURI: `https://example.com/${i + 1}.json`,
      })
    );
    const indexer = makeIndexer(items);

    await expect(
      indexer.searchAgents({ chains: [11155111], entityType: 'tool' })
    ).rejects.toThrow('ENTITY_TYPE_FILTER_TOO_BROAD');
  });

  it('[R28] hydrated entityType is populated on returned AgentSummary', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ entityType: 'tool' }),
    } as any);

    const indexer = makeIndexer([
      makeSummary({ agentId: '11155111:1', entityType: undefined, agentURI: 'https://example.com/a.json' }),
    ]);
    const out = await indexer.searchAgents({ chains: [11155111], entityType: 'tool' });
    expect(out[0].entityType).toBe('tool');
  });
});
