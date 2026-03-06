import { afterEach, describe, expect, it, jest } from '@jest/globals';

import { SubgraphClient } from '../src/core/subgraph-client.js';

describe('SubgraphClient regressions', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('keeps min/max bounds inside tag-filtered feedback searches and uses GraphQL variables for string input', async () => {
    const client = new SubgraphClient('https://subgraph.example');
    const request = jest.fn(async () => ({ feedbacks: [] }));
    (client as any).client = { request };

    await client.searchFeedback(
      {
        tags: ['tag-with-"quotes"'],
        minValue: 10,
        maxValue: 20,
      },
      25,
      0,
      'createdAt',
      'desc'
    );

    const firstCall = request.mock.calls[0] as any[];
    const query = firstCall[0] as string;
    const variables = firstCall[1] as any;
    expect(query).toContain('$where');
    expect(query).not.toContain('tag-with-"quotes"');
    expect(variables.where.or).toEqual([
      { isRevoked: false, value_gte: 10, value_lte: 20, tag1: 'tag-with-"quotes"' },
      { isRevoked: false, value_gte: 10, value_lte: 20, tag2: 'tag-with-"quotes"' },
    ]);
  });

  it('applies capability and related feedback-file filters via the off-chain fallback loader', async () => {
    const client = new SubgraphClient('https://subgraph.example');
    const request = jest.fn(async () => ({
      feedbacks: [
        {
          id: '1:7:0x00000000000000000000000000000000000000aa:1',
          clientAddress: '0x00000000000000000000000000000000000000aa',
          value: '80',
          tag1: '',
          tag2: '',
          feedbackURI: 'https://files.example/matching.json',
          isRevoked: false,
          createdAt: '1',
          feedbackFile: {},
          responses: [],
        },
        {
          id: '1:7:0x00000000000000000000000000000000000000aa:2',
          clientAddress: '0x00000000000000000000000000000000000000aa',
          value: '75',
          tag1: '',
          tag2: '',
          feedbackURI: 'https://files.example/non-matching.json',
          isRevoked: false,
          createdAt: '2',
          feedbackFile: {},
          responses: [],
        },
      ],
    }));
    (client as any).client = { request };

    const fetchMock = jest.spyOn(global, 'fetch' as any).mockImplementation(async (input: any) => {
      const url = String(input);
      if (url.endsWith('/matching.json')) {
        return {
          ok: true,
          json: async () => ({
            capability: 'tools',
            skill: 'python',
            task: 'summarize',
            name: 'tool-a',
          }),
        } as unknown as Response;
      }

      return {
        ok: true,
        json: async () => ({
          capability: 'resources',
          skill: 'rust',
          task: 'classify',
          name: 'tool-b',
        }),
      } as unknown as Response;
    });

    const results = await client.searchFeedback({
      capabilities: ['tools'],
      skills: ['python'],
      tasks: ['summarize'],
      names: ['tool-a'],
    });

    expect(results).toHaveLength(1);
    expect(results[0].feedbackFile).toMatchObject({
      capability: 'tools',
      skill: 'python',
      task: 'summarize',
      name: 'tool-a',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('pushes walletAddress filtering into the legacy searchAgents query path', async () => {
    const client = new SubgraphClient('https://subgraph.example');
    const request = jest.fn(async () => ({ agents: [] }));
    (client as any).client = { request };

    await client.searchAgents({
      walletAddress: '0x00000000000000000000000000000000000000AA',
    } as any);

    const firstCall = request.mock.calls[0] as any[];
    const query = firstCall[0] as string;
    expect(query).toContain('agentWallet: "0x00000000000000000000000000000000000000aa"');
  });
});
