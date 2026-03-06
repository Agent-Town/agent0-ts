import { afterEach, describe, expect, it, jest } from '@jest/globals';

import { AgentIndexer } from '../src/core/indexer.js';
import { SemanticSearchClient } from '../src/core/semantic-search-client.js';
import type { AgentSummary } from '../src/models/interfaces.js';

const WALLET = '0x9999999999999999999999999999999999999999';

function makeAgent(agentId: string): AgentSummary {
  return {
    chainId: Number(agentId.split(':')[0]),
    agentId,
    name: `agent-${agentId}`,
    description: '',
    owners: [],
    operators: [],
    walletAddress: WALLET,
    supportedTrusts: [],
    a2aSkills: [],
    mcpTools: [],
    mcpPrompts: [],
    mcpResources: [],
    oasfSkills: [],
    oasfDomains: [],
    active: true,
    x402support: false,
    updatedAt: 1,
    extras: {},
  };
}

describe('AgentIndexer regressions', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('respects agentIds on the keyword search path', async () => {
    jest.spyOn(SemanticSearchClient.prototype, 'search').mockResolvedValue([
      { agentId: '1:1', chainId: 1, score: 0.9 },
      { agentId: '1:2', chainId: 1, score: 0.8 },
    ] as any);

    const subgraphClient = {
      searchAgentsV2: jest.fn(async ({ where }: any) => {
        const ids = (where?.id_in || where?.and?.[0]?.id_in || []) as string[];
        return ids.map((id) => makeAgent(id));
      }),
    };

    const indexer = new AgentIndexer(subgraphClient as any, undefined, 1 as any);
    const results = await indexer.searchAgents({ keyword: 'agent', agentIds: ['1:2'] });

    expect(results.map((agent) => agent.agentId)).toEqual(['1:2']);
  });

  it('supports hasNoFeedback with non-candidate filters by deriving a candidate set first', async () => {
    const subgraphClient = {
      searchAgentsV2: jest.fn(async ({ where }: any) => {
        const ids = (where?.id_in || where?.and?.[0]?.id_in) as string[] | undefined;
        if (!ids) {
          return [makeAgent('1:1'), makeAgent('1:2')];
        }
        return ids.includes('1:2') ? [makeAgent('1:2')] : [];
      }),
      queryFeedbacks: jest.fn(async () => [
        {
          agent: { id: '1:1' },
          value: '80',
          responses: [],
        },
      ]),
    };

    const indexer = new AgentIndexer(subgraphClient as any, undefined, 1 as any);
    const results = await indexer.searchAgents({
      walletAddress: WALLET,
      feedback: {
        hasNoFeedback: true,
        tag: 'quality',
      },
    });

    expect(results.map((agent) => agent.agentId)).toEqual(['1:2']);
  });
});
