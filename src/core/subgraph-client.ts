/**
 * Subgraph client for querying The Graph network
 */

import { GraphQLClient } from 'graphql-request';
import type { AgentSummary, SearchFilters } from '../models/interfaces.js';
import { IPFS_GATEWAYS, TIMEOUTS } from '../utils/constants.js';
import { firstSuccessful } from '../utils/index.js';
import { normalizeAddress } from '../utils/validation.js';

export interface SubgraphQueryOptions {
  where?: Record<string, unknown>;
  first?: number;
  skip?: number;
  orderBy?: string;
  orderDirection?: 'asc' | 'desc';
  includeRegistrationFile?: boolean;
}

export interface SearchAgentsV2Options {
  where?: Record<string, unknown> | null;
  first: number;
  skip: number;
  orderBy: string;
  orderDirection: 'asc' | 'desc';
}

export type QueryAgentMetadata = {
  id: string;
  key: string;
  value: string;
  updatedAt: bigint;
  agent: { id: string };
};

export type QueryFeedback = {
  id: string;
  agent: { id: string };
  clientAddress: string;
  value: string; // BigDecimal serialized
  tag1?: string | null;
  tag2?: string | null;
  endpoint?: string | null;
  isRevoked: boolean;
  createdAt: bigint;
  responses?: Array<{ id: string }> | null;
};

export type QueryFeedbackResponse = {
  id: string;
  feedback: { id: string };
  createdAt: bigint;
};

export type QueryAgent = {
  id: string;
  chainId: bigint;
  agentId: bigint;
  owner?: string | null;
  operators?: string[] | null;
  agentURI?: string | null;
  agentURIType?: string | null;
  createdAt?: bigint | null;
  updatedAt?: bigint | null;
  agentWallet?: string | null;
  totalFeedback?: bigint | null;
  lastActivity?: bigint | null;
  registrationFile?: AgentRegistrationFile | null;
};

export type AgentRegistrationFile = {
  id: string;
  agentId?: string | null;
  name?: string | null;
  description?: string | null;
  image?: string | null;
  active?: boolean | null;
  // Subgraph schema (Jan 2026+) exposes `x402Support`; older deployments used `x402support`.
  x402Support?: boolean | null;
  x402support?: boolean | null;
  supportedTrusts?: string[] | null;
  mcpEndpoint?: string | null;
  mcpVersion?: string | null;
  a2aEndpoint?: string | null;
  a2aVersion?: string | null;
  webEndpoint?: string | null;
  emailEndpoint?: string | null;
  hasOASF?: boolean | null;
  oasfSkills?: string[] | null;
  oasfDomains?: string[] | null;
  ens?: string | null;
  did?: string | null;
  mcpTools?: string[] | null;
  mcpPrompts?: string[] | null;
  mcpResources?: string[] | null;
  a2aSkills?: string[] | null;
};

/**
 * Client for querying the subgraph GraphQL API
 */
export class SubgraphClient {
  private client: GraphQLClient;
  private readonly feedbackFileCache = new Map<string, Promise<Record<string, unknown> | null>>();

  constructor(subgraphUrl: string) {
    this.client = new GraphQLClient(subgraphUrl, {
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Execute a GraphQL query against the subgraph
   */
  async query<T = unknown>(query: string, variables?: Record<string, unknown>): Promise<T> {
    try {
      const data = await this.client.request<T>(query, variables || {});
      return data;
    } catch (error) {
      // Backwards/forwards compatibility for hosted subgraphs:
      // Some deployments still expose `x402support` instead of `x402Support`.
      const msg = error instanceof Error ? error.message : String(error);
      // Some deployments do not yet expose `hasOASF` on AgentRegistrationFile.
      if (
        (msg.includes('Cannot query field "hasOASF"') || msg.includes('has no field `hasOASF`')) &&
        query.includes('hasOASF')
      ) {
        const q2 = query.split('hasOASF').join('oasfEndpoint');
        const data2 = await this.client.request<T>(q2, variables || {});
        return data2;
      }
      if (
        (msg.includes('Cannot query field "x402Support"') || msg.includes('has no field `x402Support`')) &&
        query.includes('x402Support')
      ) {
        // Avoid String.prototype.replaceAll for older TS lib targets.
        const q2 = query.split('x402Support').join('x402support');
        const data2 = await this.client.request<T>(q2, variables || {});
        return data2;
      }
      throw new Error(`Failed to query subgraph: ${error}`);
    }
  }

  /**
   * Query agents from the subgraph
   */
  async getAgents(options: SubgraphQueryOptions = {}): Promise<AgentSummary[]> {
    const {
      where = {},
      first = 100,
      skip = 0,
      orderBy = 'createdAt',
      orderDirection = 'desc',
      includeRegistrationFile = true,
    } = options;

    // Support Agent-level filters and nested registrationFile filters
    const supportedWhere: Record<string, unknown> = {};
    if (where.agentId) supportedWhere.agentId = where.agentId;
    if (where.owner) supportedWhere.owner = where.owner;
    if (where.owner_in) supportedWhere.owner_in = where.owner_in;
    if (where.operators_contains) supportedWhere.operators_contains = where.operators_contains;
    if (where.agentURI) supportedWhere.agentURI = where.agentURI;
    if (where.agentWallet) supportedWhere.agentWallet = where.agentWallet;
    if (where.registrationFile_not !== undefined) supportedWhere.registrationFile_not = where.registrationFile_not;

    // Support nested registrationFile filters (pushed to subgraph level)
    // Note: Python SDK uses "registrationFile_" (with underscore) for nested filters
    if (where.registrationFile) {
      supportedWhere.registrationFile_ = where.registrationFile;
    }
    if (where.registrationFile_) {
      supportedWhere.registrationFile_ = where.registrationFile_;
    }

    // Build WHERE clause with support for nested filters
    let whereClause = '';
    if (Object.keys(supportedWhere).length > 0) {
      const conditions: string[] = [];
      for (const [key, value] of Object.entries(supportedWhere)) {
        if ((key === 'registrationFile' || key === 'registrationFile_') && typeof value === 'object') {
          // Handle nested registrationFile filters
          // Python SDK uses "registrationFile_" (with underscore) for nested filters in GraphQL
          const nestedConditions: string[] = [];
          for (const [nestedKey, nestedValue] of Object.entries(value as Record<string, unknown>)) {
            if (typeof nestedValue === 'boolean') {
              nestedConditions.push(`${nestedKey}: ${nestedValue.toString().toLowerCase()}`);
            } else if (typeof nestedValue === 'string') {
              nestedConditions.push(`${nestedKey}: "${nestedValue}"`);
            } else if (nestedValue === null) {
              if (nestedKey.endsWith('_not')) {
                nestedConditions.push(`${nestedKey}: null`);
              } else {
                nestedConditions.push(`${nestedKey}_not: null`);
              }
            }
          }
          if (nestedConditions.length > 0) {
            conditions.push(`registrationFile_: { ${nestedConditions.join(', ')} }`);
          }
        } else if (typeof value === 'boolean') {
          conditions.push(`${key}: ${value.toString().toLowerCase()}`);
        } else if (typeof value === 'string') {
          conditions.push(`${key}: "${value}"`);
        } else if (typeof value === 'number') {
          conditions.push(`${key}: ${value}`);
        } else if (Array.isArray(value)) {
          conditions.push(`${key}: ${JSON.stringify(value)}`);
        } else if (value === null) {
          // Don't add _not if the key already ends with _not (e.g., registrationFile_not)
          const filterKey = key.endsWith('_not') ? key : `${key}_not`;
          conditions.push(`${filterKey}: null`);
        }
      }
      if (conditions.length > 0) {
        whereClause = `where: { ${conditions.join(', ')} }`;
      }
    }

    // Build registration file fragment
    const regFileFragment = includeRegistrationFile
      ? `
          registrationFile {
            id
            agentId
            name
            description
            image
            active
            x402Support
            supportedTrusts
            mcpEndpoint
            mcpVersion
            a2aEndpoint
            a2aVersion
            webEndpoint
            emailEndpoint
            hasOASF
            oasfSkills
            oasfDomains
            ens
            did
            mcpTools
            mcpPrompts
            mcpResources
            a2aSkills
          }
    `
      : '';

    const query = `
      query GetAgents($first: Int!, $skip: Int!, $orderBy: Agent_orderBy!, $orderDirection: OrderDirection!) {
        agents(
          ${whereClause}
          first: $first
          skip: $skip
          orderBy: $orderBy
          orderDirection: $orderDirection
        ) {
          id
          chainId
          agentId
          owner
          operators
          agentURI
          agentURIType
          agentWallet
          createdAt
          updatedAt
          totalFeedback
          lastActivity
          ${regFileFragment}
        }
      }
    `;

    // GraphQL enum expects lowercase
    const variables = {
      first,
      skip,
      orderBy,
      orderDirection: orderDirection.toLowerCase() as 'asc' | 'desc',
    };

    try {
      const data = await this.query<{ agents: QueryAgent[] }>(query, variables);
      return (data.agents || []).map((agent) => this._transformAgent(agent)) as AgentSummary[];
    } catch (error) {
      throw new Error(`Failed to get agents from subgraph: ${error}`);
    }
  }

  /**
   * V2 agent query: pass a GraphQL `where` object via variables (no ad-hoc string building).
   */
  async searchAgentsV2(opts: SearchAgentsV2Options): Promise<AgentSummary[]> {
    const query = `
      query SearchAgentsV2(
        $where: Agent_filter
        $first: Int!
        $skip: Int!
        $orderBy: Agent_orderBy!
        $orderDirection: OrderDirection!
      ) {
        agents(where: $where, first: $first, skip: $skip, orderBy: $orderBy, orderDirection: $orderDirection) {
          id
          chainId
          agentId
          owner
          operators
          agentURI
          agentURIType
          agentWallet
          createdAt
          updatedAt
          totalFeedback
          lastActivity
          registrationFile {
            id
            agentId
            name
            description
            image
            active
            x402Support
            supportedTrusts
            mcpEndpoint
            mcpVersion
            a2aEndpoint
            a2aVersion
            webEndpoint
            emailEndpoint
            hasOASF
            oasfSkills
            oasfDomains
            ens
            did
            mcpTools
            mcpPrompts
            mcpResources
            a2aSkills
          }
        }
      }
    `;

    const variables = {
      where: opts.where ?? null,
      first: opts.first,
      skip: opts.skip,
      orderBy: opts.orderBy,
      orderDirection: opts.orderDirection,
    };

    try {
      const data = await this.query<{ agents: QueryAgent[] }>(query, variables);
      return (data.agents || []).map((a) => this._transformAgent(a)) as AgentSummary[];
    } catch (e) {
      // Compatibility: some deployments do not support AgentRegistrationFile.hasOASF in the *filter input*.
      // When that happens, retry by translating registrationFile_.hasOASF => oasfEndpoint existence checks.
      const msg = e instanceof Error ? e.message : String(e);
      const mentionsHasOASF =
        msg.includes('hasOASF') &&
        (msg.includes('AgentRegistrationFile') || msg.includes('AgentRegistrationFile_filter') || msg.includes('AgentRegistrationFileFilter'));
      if (mentionsHasOASF && variables.where) {
        const rewrite = (node: any): any => {
          if (Array.isArray(node)) return node.map(rewrite);
          if (!node || typeof node !== 'object') return node;
          const out: any = {};
          for (const [k, v] of Object.entries(node)) {
            if (k === 'registrationFile_' && v && typeof v === 'object') {
              const rf: any = { ...(v as any) };
              if (Object.prototype.hasOwnProperty.call(rf, 'hasOASF')) {
                const want = Boolean((rf as any).hasOASF);
                delete rf.hasOASF;
                // Best-effort fallback: older subgraphs commonly have `oasfEndpoint`.
                if (want) rf.oasfEndpoint_not = null;
                else rf.oasfEndpoint = null;
              }
              out[k] = rewrite(rf);
            } else {
              out[k] = rewrite(v);
            }
          }
          return out;
        };

        const variables2 = { ...variables, where: rewrite(variables.where) };
        const data2 = await this.query<{ agents: QueryAgent[] }>(query, variables2);
        return (data2.agents || []).map((a) => this._transformAgent(a)) as AgentSummary[];
      }
      throw e;
    }
  }

  async queryAgentMetadata(where: Record<string, unknown>, first: number, skip: number): Promise<QueryAgentMetadata[]> {
    const query = `
      query AgentMetadatas($where: AgentMetadata_filter, $first: Int!, $skip: Int!) {
        agentMetadatas(where: $where, first: $first, skip: $skip) {
          id
          key
          value
          updatedAt
          agent { id }
        }
      }
    `;
    try {
      const data = await this.query<{ agentMetadatas: QueryAgentMetadata[] }>(query, { where, first, skip });
      return data.agentMetadatas || [];
    } catch (e) {
      // Hosted subgraph compatibility: some deployments expose AgentMetadata list as `agentMetadata_collection`
      // instead of `agentMetadatas`.
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('no field `agentMetadatas`') || msg.includes('Cannot query field "agentMetadatas"')) {
        const q2 = `
          query AgentMetadataCollection($where: AgentMetadata_filter, $first: Int!, $skip: Int!) {
            agentMetadata_collection(where: $where, first: $first, skip: $skip) {
              id
              key
              value
              updatedAt
              agent { id }
            }
          }
        `;
        const data2 = await this.query<{ agentMetadata_collection: QueryAgentMetadata[] }>(q2, { where, first, skip });
        return data2.agentMetadata_collection || [];
      }
      throw e;
    }
  }

  async queryFeedbacks(
    where: Record<string, unknown>,
    first: number,
    skip: number,
    orderBy: string = 'createdAt',
    orderDirection: 'asc' | 'desc' = 'desc'
  ): Promise<QueryFeedback[]> {
    const query = `
      query Feedbacks($where: Feedback_filter, $first: Int!, $skip: Int!, $orderBy: Feedback_orderBy!, $orderDirection: OrderDirection!) {
        feedbacks(where: $where, first: $first, skip: $skip, orderBy: $orderBy, orderDirection: $orderDirection) {
          id
          agent { id }
          clientAddress
          value
          tag1
          tag2
          endpoint
          isRevoked
          createdAt
          responses(first: 1) { id }
        }
      }
    `;
    const data = await this.query<{ feedbacks: QueryFeedback[] }>(query, {
      where,
      first,
      skip,
      orderBy,
      orderDirection,
    });
    return data.feedbacks || [];
  }

  async queryFeedbackResponses(where: Record<string, unknown>, first: number, skip: number): Promise<QueryFeedbackResponse[]> {
    const query = `
      query FeedbackResponses($where: FeedbackResponse_filter, $first: Int!, $skip: Int!) {
        feedbackResponses(where: $where, first: $first, skip: $skip) {
          id
          feedback { id }
          createdAt
        }
      }
    `;
    const data = await this.query<{ feedbackResponses: QueryFeedbackResponse[] }>(query, { where, first, skip });
    return data.feedbackResponses || [];
  }

  /**
   * Get a single agent by ID
   */
  async getAgentById(agentId: string): Promise<AgentSummary | null> {
    const query = `
      query GetAgent($agentId: String!) {
        agent(id: $agentId) {
          id
          chainId
          agentId
          owner
          operators
          agentURI
          agentURIType
          agentWallet
          createdAt
          updatedAt
          totalFeedback
          lastActivity
          registrationFile {
            id
            agentId
            name
            description
            image
            active
            x402Support
            supportedTrusts
            mcpEndpoint
            mcpVersion
            a2aEndpoint
            a2aVersion
            webEndpoint
            emailEndpoint
            oasfSkills
            oasfDomains
            hasOASF
            ens
            did
            mcpTools
            mcpPrompts
            mcpResources
            a2aSkills
          }
        }
      }
    `;

    try {
      const data = await this.query<{ agent: QueryAgent | null }>(query, { agentId });
      if (!data.agent) {
        return null;
      }
      return this._transformAgent(data.agent) as AgentSummary;
    } catch (error) {
      throw new Error(`Failed to get agent from subgraph: ${error}`);
    }
  }

  /**
   * Transform raw subgraph agent data to AgentSummary
   */
  private _transformAgent(agent: QueryAgent): Partial<AgentSummary> {
    // Fields from Agent entity
    const chainId = parseInt(agent.chainId?.toString() || '0', 10);
    const agentIdStr = agent.id || `${chainId}:${agent.agentId?.toString() || '0'}`;
    
    // Fields from AgentRegistrationFile (registrationFile)
    const regFile = agent.registrationFile;
    
    // Transform operators from Bytes array to Address array
    const operators = (agent.operators || []).map((op: string) => 
      typeof op === 'string' ? normalizeAddress(op) : op
    );
    
    return {
      chainId,
      agentId: agentIdStr,
      // Per ERC-8004 registration schema, name SHOULD be present. If missing in subgraph data,
      // fall back to agentId string to avoid returning an unusable empty name.
      name: regFile?.name || agentIdStr,
      image: regFile?.image || undefined,
      description: regFile?.description || '',
      owners: agent.owner ? [normalizeAddress(agent.owner)] : [],
      operators,
      mcp: regFile?.mcpEndpoint || undefined,
      a2a: regFile?.a2aEndpoint || undefined,
      web: regFile?.webEndpoint || undefined,
      email: regFile?.emailEndpoint || undefined,
      ens: regFile?.ens || undefined,
      did: regFile?.did || undefined,
      walletAddress: agent.agentWallet ? normalizeAddress(agent.agentWallet) : undefined,
      supportedTrusts: regFile?.supportedTrusts || [],
      a2aSkills: regFile?.a2aSkills || [],
      mcpTools: regFile?.mcpTools || [],
      mcpPrompts: regFile?.mcpPrompts || [],
      mcpResources: regFile?.mcpResources || [],
      oasfSkills: regFile?.oasfSkills || [],
      oasfDomains: regFile?.oasfDomains || [],
      active: regFile?.active ?? false,
      x402support: regFile?.x402Support ?? regFile?.x402support ?? false,
      createdAt: agent.createdAt ? Number(agent.createdAt) : undefined,
      updatedAt: agent.updatedAt ? Number(agent.updatedAt) : undefined,
      lastActivity: agent.lastActivity ? Number(agent.lastActivity) : undefined,
      agentURI: agent.agentURI ?? undefined,
      agentURIType: agent.agentURIType ?? undefined,
      feedbackCount: agent.totalFeedback ? Number(agent.totalFeedback) : undefined,
      extras: {},
    };
  }

  /**
   * Search agents with filters (delegates to getAgents with WHERE clause)
   * @param params Search parameters
   * @param first Maximum number of results to return (default: 100)
   * @param skip Number of results to skip for pagination (default: 0)
   */
  async searchAgents(
    params: SearchFilters,
    first: number = 100,
    skip: number = 0
  ): Promise<AgentSummary[]> {
    const where: Record<string, unknown> = {
      registrationFile_not: null  // Only get agents with registration files
    };

    // Note: Most search fields are in registrationFile, so we need to filter after fetching
    // For now, we'll do basic filtering on Agent fields and then filter on registrationFile fields
    // NOTE: This legacy method is retained temporarily; the new unified search uses a v2 query builder.
    if (params.active !== undefined || params.hasMCP !== undefined || params.hasA2A !== undefined ||
        params.x402support !== undefined || params.ensContains || params.walletAddress ||
        params.supportedTrust || params.a2aSkills || params.mcpTools || params.name ||
        params.owners || params.operators) {
      // Push basic filters to subgraph using nested registrationFile filters
      const registrationFileFilters: Record<string, unknown> = {};
      if (params.active !== undefined) registrationFileFilters.active = params.active;
      if (params.x402support !== undefined) registrationFileFilters.x402Support = params.x402support;
      if (params.ensContains) registrationFileFilters.ens_contains_nocase = params.ensContains;
      if (params.hasMCP !== undefined) {
        registrationFileFilters[params.hasMCP ? 'mcpEndpoint_not' : 'mcpEndpoint'] = null;
      }
      if (params.hasA2A !== undefined) {
        registrationFileFilters[params.hasA2A ? 'a2aEndpoint_not' : 'a2aEndpoint'] = null;
      }

      const whereWithFilters: Record<string, unknown> = {};
      if (Object.keys(registrationFileFilters).length > 0) {
        // Python SDK uses "registrationFile_" (with underscore) for nested filters
        whereWithFilters.registrationFile_ = registrationFileFilters;
      }
      if (params.walletAddress) {
        whereWithFilters.agentWallet = normalizeAddress(params.walletAddress);
      }

      // Owner filtering (at Agent level, not registrationFile)
      if (params.owners && params.owners.length > 0) {
        // Normalize addresses to lowercase for case-insensitive matching
        const normalizedOwners = params.owners.map(owner => owner.toLowerCase());
        if (normalizedOwners.length === 1) {
          whereWithFilters.owner = normalizedOwners[0];
        } else {
          whereWithFilters.owner_in = normalizedOwners;
        }
      }

      // Operator filtering (at Agent level, not registrationFile)
      if (params.operators && params.operators.length > 0) {
        // Normalize addresses to lowercase for case-insensitive matching
        const normalizedOperators = params.operators.map(op => op.toLowerCase());
        // For operators (array field), use contains to check if any operator matches
        whereWithFilters.operators_contains = normalizedOperators;
      }

      // Fetch records with filters and pagination applied at subgraph level
      const allAgents = await this.getAgents({ where: whereWithFilters, first, skip });

      // Only filter client-side for fields that can't be filtered at subgraph level
      // Fields already filtered at subgraph level: active, x402Support, mcp, a2a, ens, walletAddress, owners, operators
      return allAgents.filter((agent) => {
        // Name filtering (substring search - not supported at subgraph level)
        if (params.name && !agent.name.toLowerCase().includes(params.name.toLowerCase())) {
          return false;
        }
        // Array contains filtering (supportedTrust, a2aSkills, mcpTools) - these require array contains logic
        if (params.supportedTrust && params.supportedTrust.length > 0) {
          const hasAllTrusts = params.supportedTrust.every(trust =>
            agent.supportedTrusts.includes(trust)
          );
          if (!hasAllTrusts) return false;
        }
        if (params.a2aSkills && params.a2aSkills.length > 0) {
          const hasAllSkills = params.a2aSkills.every(skill =>
            agent.a2aSkills.includes(skill)
          );
          if (!hasAllSkills) return false;
        }
        if (params.mcpTools && params.mcpTools.length > 0) {
          const hasAllTools = params.mcpTools.every(tool =>
            agent.mcpTools.includes(tool)
          );
          if (!hasAllTools) return false;
        }
        return true;
      });
    }

    return this.getAgents({ where, first, skip });
  }

  /**
   * Search feedback with filters
   */
  async searchFeedback(
    params: {
      agents?: string[];
      reviewers?: string[];
      tags?: string[];
      capabilities?: string[];
      skills?: string[];
      tasks?: string[];
      names?: string[];
      minValue?: number;
      maxValue?: number;
      includeRevoked?: boolean;
    },
    first: number = 100,
    skip: number = 0,
    orderBy: string = 'createdAt',
    orderDirection: 'asc' | 'desc' = 'desc'
  ): Promise<any[]> {
    const baseWhere: Record<string, unknown> = {};
    if (params.agents && params.agents.length > 0) {
      baseWhere.agent_in = params.agents;
    }
    if (params.reviewers && params.reviewers.length > 0) {
      baseWhere.clientAddress_in = params.reviewers.map((reviewer) => reviewer.toLowerCase());
    }
    if (!params.includeRevoked) {
      baseWhere.isRevoked = false;
    }
    if (params.minValue !== undefined) {
      baseWhere.value_gte = params.minValue;
    }
    if (params.maxValue !== undefined) {
      baseWhere.value_lte = params.maxValue;
    }

    const where =
      params.tags && params.tags.length > 0
        ? {
            or: params.tags.flatMap((tag) => [
              { ...baseWhere, tag1: tag },
              { ...baseWhere, tag2: tag },
            ]),
          }
        : (Object.keys(baseWhere).length > 0 ? baseWhere : null);

    const queryWithEndpoint = `
      query SearchFeedback(
        $where: Feedback_filter
        $first: Int!
        $skip: Int!
        $orderBy: Feedback_orderBy!
        $orderDirection: OrderDirection!
      ) {
        feedbacks(where: $where, first: $first, skip: $skip, orderBy: $orderBy, orderDirection: $orderDirection) {
          id
          agent { id agentId chainId }
          clientAddress
          value
          tag1
          tag2
          endpoint
          feedbackURI
          feedbackURIType
          feedbackHash
          isRevoked
          createdAt
          revokedAt
          feedbackFile {
            id
            feedbackId
            text
            proofOfPaymentFromAddress
            proofOfPaymentToAddress
            proofOfPaymentChainId
            proofOfPaymentTxHash
            tag1
            tag2
            createdAt
          }
          responses {
            id
            responder
            responseUri
            responseHash
            createdAt
          }
        }
      }
    `;

    const variables = {
      where,
      first,
      skip,
      orderBy,
      orderDirection,
    };

    const finalize = async (feedbacks: any[]): Promise<any[]> => {
      return await this._applyFeedbackFileFilters(feedbacks || [], params);
    };

    try {
      const result = await this.query<{ feedbacks: any[] }>(queryWithEndpoint, variables);
      return await finalize(result.feedbacks || []);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (!msg.includes('Cannot query field') || !msg.includes('endpoint')) {
        throw error;
      }

      const queryWithoutEndpoint = `
        query SearchFeedbackWithoutEndpoint(
          $where: Feedback_filter
          $first: Int!
          $skip: Int!
          $orderBy: Feedback_orderBy!
          $orderDirection: OrderDirection!
        ) {
          feedbacks(where: $where, first: $first, skip: $skip, orderBy: $orderBy, orderDirection: $orderDirection) {
            id
            agent { id agentId chainId }
            clientAddress
            value
            tag1
            tag2
            feedbackURI
            feedbackURIType
            feedbackHash
            isRevoked
            createdAt
            revokedAt
            feedbackFile {
              id
              feedbackId
              text
              proofOfPaymentFromAddress
              proofOfPaymentToAddress
              proofOfPaymentChainId
              proofOfPaymentTxHash
              tag1
              tag2
              createdAt
            }
            responses {
              id
              responder
              responseUri
              responseHash
              createdAt
            }
          }
        }
      `;

      const result = await this.query<{ feedbacks: any[] }>(queryWithoutEndpoint, variables);
      return await finalize(result.feedbacks || []);
    }
  }

  private async _applyFeedbackFileFilters(
    feedbacks: any[],
    params: {
      capabilities?: string[];
      skills?: string[];
      tasks?: string[];
      names?: string[];
    }
  ): Promise<any[]> {
    const needsFeedbackFileFiltering =
      (params.capabilities?.length ?? 0) > 0 ||
      (params.skills?.length ?? 0) > 0 ||
      (params.tasks?.length ?? 0) > 0 ||
      (params.names?.length ?? 0) > 0;

    if (!needsFeedbackFileFiltering) {
      return feedbacks;
    }

    const filtered: any[] = [];
    for (const feedback of feedbacks) {
      const feedbackFile = await this._getFeedbackFileForFiltering(feedback);
      const capability = typeof feedbackFile?.capability === 'string' ? feedbackFile.capability : undefined;
      const skill = typeof feedbackFile?.skill === 'string' ? feedbackFile.skill : undefined;
      const task = typeof feedbackFile?.task === 'string' ? feedbackFile.task : undefined;
      const name = typeof feedbackFile?.name === 'string' ? feedbackFile.name : undefined;

      if (params.capabilities && !params.capabilities.includes(capability || '')) {
        continue;
      }
      if (params.skills && !params.skills.includes(skill || '')) {
        continue;
      }
      if (params.tasks && !params.tasks.includes(task || '')) {
        continue;
      }
      if (params.names && !params.names.includes(name || '')) {
        continue;
      }

      if (feedbackFile && (!feedback.feedbackFile || typeof feedback.feedbackFile !== 'object')) {
        feedback.feedbackFile = feedbackFile;
      } else if (feedbackFile && typeof feedback.feedbackFile === 'object') {
        feedback.feedbackFile = { ...feedbackFile, ...feedback.feedbackFile };
      }

      filtered.push(feedback);
    }

    return filtered;
  }

  private async _getFeedbackFileForFiltering(feedback: any): Promise<Record<string, unknown> | null> {
    const inlineFeedbackFile =
      feedback.feedbackFile && typeof feedback.feedbackFile === 'object' && !Array.isArray(feedback.feedbackFile)
        ? (feedback.feedbackFile as Record<string, unknown>)
        : null;

    if (
      inlineFeedbackFile &&
      (typeof inlineFeedbackFile.capability === 'string' ||
        typeof inlineFeedbackFile.skill === 'string' ||
        typeof inlineFeedbackFile.task === 'string' ||
        typeof inlineFeedbackFile.name === 'string')
    ) {
      return inlineFeedbackFile;
    }

    const feedbackUri =
      typeof feedback.feedbackURI === 'string'
        ? feedback.feedbackURI
        : (typeof feedback.feedbackUri === 'string' ? feedback.feedbackUri : undefined);
    if (!feedbackUri) {
      return inlineFeedbackFile;
    }

    const loadedFeedbackFile = await this._loadFeedbackFile(feedbackUri);
    if (!loadedFeedbackFile) {
      return inlineFeedbackFile;
    }

    return inlineFeedbackFile ? { ...loadedFeedbackFile, ...inlineFeedbackFile } : loadedFeedbackFile;
  }

  private async _loadFeedbackFile(feedbackUri: string): Promise<Record<string, unknown> | null> {
    const existing = this.feedbackFileCache.get(feedbackUri);
    if (existing) {
      return await existing;
    }

    const promise = (async () => {
      try {
        if (feedbackUri.startsWith('ipfs://')) {
          const cid = feedbackUri.slice(7);
          const gateways = IPFS_GATEWAYS.map((gateway) => `${gateway}${cid}`);
          const response = await firstSuccessful(
            gateways.map(async (gateway) => {
              const gatewayResponse = await fetch(gateway, {
                signal: AbortSignal.timeout(TIMEOUTS.IPFS_GATEWAY),
              });
              if (!gatewayResponse.ok) {
                throw new Error(`HTTP ${gatewayResponse.status}`);
              }
              return gatewayResponse;
            }),
            'Failed to retrieve feedback file from IPFS gateways'
          );
          return (await response.json()) as Record<string, unknown>;
        }

        if (feedbackUri.startsWith('http://') || feedbackUri.startsWith('https://')) {
          const response = await fetch(feedbackUri, {
            signal: AbortSignal.timeout(TIMEOUTS.IPFS_GATEWAY),
          });
          if (!response.ok) {
            return null;
          }
          return (await response.json()) as Record<string, unknown>;
        }
      } catch {
        return null;
      }

      return null;
    })();

    this.feedbackFileCache.set(feedbackUri, promise);
    return await promise;
  }

  /**
   * (Removed) searchAgentsByReputation
   *
   * Unified search lives in `SDK.searchAgents()` with `filters.feedback` and related filter surfaces.
   */
}
