/**
 * Main SDK class for Agent0
 */
import type {
  AgentSummary,
  Feedback,
  SearchFeedbackParams,
  RegistrationFile,
  Endpoint,
  FeedbackFileInput,
  SearchOptions,
  FeedbackSearchFilters,
  FeedbackSearchOptions,
  SearchFilters,
} from '../models/interfaces.js';
import type { AgentId, ChainId, Address, URI } from '../models/types.js';
import { EndpointType, TrustModel } from '../models/enums.js';
import { formatAgentId, parseAgentId } from '../utils/id-format.js';
import { IPFS_GATEWAYS, TIMEOUTS } from '../utils/constants.js';
import { assertLoadableAgentUri, transformRegistrationFile } from '../utils/index.js';
import type { ChainClient, EIP1193Provider as Eip1193Provider } from './chain-client.js';
import { ViemChainClient } from './viem-chain-client.js';
import { IPFSClient, type IPFSClientConfig } from './ipfs-client.js';
import { SubgraphClient } from './subgraph-client.js';
import { FeedbackManager } from './feedback-manager.js';
import { AgentIndexer } from './indexer.js';
import { Agent } from './agent.js';
import type { TransactionHandle } from './transaction-handle.js';
import {
  DEFAULT_REGISTRIES,
  DEFAULT_SUBGRAPH_URLS,
  IDENTITY_REGISTRY_ABI,
  REPUTATION_REGISTRY_ABI,
} from './contracts.js';

export interface SDKConfig {
  chainId: ChainId;
  rpcUrl: string;
  /**
   * Backwards-compatible alias for `privateKey` (accepts a hex private key string).
   */
  signer?: string;
  /**
   * Server-side signing (hex private key string).
   */
  privateKey?: string;
  /**
   * Browser-side signing (EIP-1193 provider, typically selected via ERC-6963).
   */
  walletProvider?: Eip1193Provider;
  registryOverrides?: Record<ChainId, Record<string, Address>>;
  // IPFS configuration
  ipfs?: 'node' | 'pinata';
  ipfsNodeUrl?: string;
  pinataJwt?: string;
  // Subgraph configuration
  subgraphUrl?: string;
  subgraphOverrides?: Record<ChainId, string>;
}

/**
 * Main SDK class for Agent0
 */
export class SDK {
  private readonly _chainClient: ChainClient;
  private _ipfsClient?: IPFSClient;
  private _subgraphClient?: SubgraphClient;
  private readonly _feedbackManager: FeedbackManager;
  private readonly _indexer: AgentIndexer;
  private readonly _registries: Record<string, Address>;
  private readonly _chainId: ChainId;
  private readonly _subgraphUrls: Record<ChainId, string> = {};
  private readonly _hasSignerConfig: boolean;

  constructor(config: SDKConfig) {
    this._chainId = config.chainId;

    // Initialize Chain client (viem-only)
    const privateKey = config.privateKey ?? config.signer;
    this._hasSignerConfig = Boolean(privateKey || config.walletProvider);
    this._chainClient = new ViemChainClient({
      chainId: config.chainId,
      rpcUrl: config.rpcUrl,
      privateKey,
      walletProvider: config.walletProvider,
    });

    // Resolve registry addresses
    const registryOverrides = config.registryOverrides || {};
    const defaultRegistries = DEFAULT_REGISTRIES[config.chainId] || {};
    this._registries = { ...defaultRegistries, ...(registryOverrides[config.chainId] || {}) };

    // Resolve subgraph URL
    if (config.subgraphOverrides) {
      Object.assign(this._subgraphUrls, config.subgraphOverrides);
    }

    let resolvedSubgraphUrl: string | undefined;
    if (config.chainId in this._subgraphUrls) {
      resolvedSubgraphUrl = this._subgraphUrls[config.chainId];
    } else if (config.chainId in DEFAULT_SUBGRAPH_URLS) {
      resolvedSubgraphUrl = DEFAULT_SUBGRAPH_URLS[config.chainId];
    } else if (config.subgraphUrl) {
      resolvedSubgraphUrl = config.subgraphUrl;
    }

    // Initialize subgraph client if URL available
    if (resolvedSubgraphUrl) {
      this._subgraphClient = new SubgraphClient(resolvedSubgraphUrl);
    }

    // Initialize indexer
    this._indexer = new AgentIndexer(this._subgraphClient, this._subgraphUrls, this._chainId);

    // Initialize IPFS client
    if (config.ipfs) {
      this._ipfsClient = this._initializeIpfsClient(config);
    }

    // Initialize feedback manager (will set registries after they're created)
    this._feedbackManager = new FeedbackManager(
      this._chainClient,
      this._ipfsClient,
      undefined, // reputationRegistryAddress - will be set lazily
      undefined, // identityRegistryAddress - will be set lazily
      this._subgraphClient
    );

    // Set subgraph client getter for multi-chain support
    this._feedbackManager.setSubgraphClientGetter(
      (chainId) => this.getSubgraphClient(chainId),
      this._chainId
    );
  }

  /**
   * Initialize IPFS client based on configuration
   */
  private _initializeIpfsClient(config: SDKConfig): IPFSClient {
    if (!config.ipfs) {
      throw new Error('IPFS provider not specified');
    }

    const ipfsConfig: IPFSClientConfig = {};
    const requestedIpfsBackend = config.ipfs as string;

    if (requestedIpfsBackend === 'filecoinPin') {
      throw new Error(
        "ipfs='filecoinPin' is not yet supported in the TypeScript SDK. Use 'pinata' or 'node'."
      );
    } else if (config.ipfs === 'node') {
      if (!config.ipfsNodeUrl) {
        throw new Error("ipfsNodeUrl is required when ipfs='node'");
      }
      ipfsConfig.url = config.ipfsNodeUrl;
    } else if (config.ipfs === 'pinata') {
      if (!config.pinataJwt) {
        throw new Error("pinataJwt is required when ipfs='pinata'");
      }
      ipfsConfig.pinataEnabled = true;
      ipfsConfig.pinataJwt = config.pinataJwt;
    } else {
      throw new Error(`Invalid ipfs value: ${config.ipfs}. Must be 'node' or 'pinata'`);
    }

    return new IPFSClient(ipfsConfig);
  }

  /**
   * Get current chain ID
   */
  async chainId(): Promise<ChainId> {
    return this._chainId;
  }

  /**
   * Get resolved registry addresses for current chain
   */
  registries(): Record<string, Address> {
    return { ...this._registries };
  }

  /**
   * Get subgraph client for a specific chain
   */
  getSubgraphClient(chainId?: ChainId): SubgraphClient | undefined {
    const targetChain = chainId !== undefined ? chainId : this._chainId;

    // Check if we already have a client for this chain
    if (targetChain === this._chainId && this._subgraphClient) {
      return this._subgraphClient;
    }

    // Resolve URL for target chain
    let url: string | undefined;
    if (targetChain in this._subgraphUrls) {
      url = this._subgraphUrls[targetChain];
    } else if (targetChain in DEFAULT_SUBGRAPH_URLS) {
      url = DEFAULT_SUBGRAPH_URLS[targetChain];
    }

    if (url) {
      return new SubgraphClient(url);
    }
    return undefined;
  }

  identityRegistryAddress(): Address {
    const address = this._registries.IDENTITY;
    if (!address) throw new Error(`No identity registry address for chain ${this._chainId}`);
    // Ensure feedback manager has it for off-chain file composition.
    this._feedbackManager.setIdentityRegistryAddress(address);
    return address;
  }

  reputationRegistryAddress(): Address {
    const address = this._registries.REPUTATION;
    if (!address) throw new Error(`No reputation registry address for chain ${this._chainId}`);
    this._feedbackManager.setReputationRegistryAddress(address);
    return address;
  }

  validationRegistryAddress(): Address {
    const address = this._registries.VALIDATION;
    if (!address) throw new Error(`No validation registry address for chain ${this._chainId}`);
    return address;
  }

  /**
   * Check if SDK is in read-only mode (no signer)
   */
  get isReadOnly(): boolean {
    return !this._hasSignerConfig;
  }

  // Agent lifecycle methods

  /**
   * Create a new agent (off-chain object in memory)
   */
  createAgent(name: string, description: string, image?: URI): Agent {
    const registrationFile: RegistrationFile = {
      name,
      description,
      image,
      endpoints: [],
      // Default trust model: reputation (if caller doesn't set one explicitly).
      trustModels: [TrustModel.REPUTATION],
      owners: [],
      operators: [],
      active: false,
      x402support: false,
      metadata: {},
      updatedAt: Math.floor(Date.now() / 1000),
    };
    return new Agent(this, registrationFile);
  }

  /**
   * Load an existing agent (hydrates from registration file if registered)
   */
  async loadAgent(agentId: AgentId): Promise<Agent> {
    // Parse agent ID
    const { chainId, tokenId } = parseAgentId(agentId);

    const currentChainId = await this.chainId();
    if (chainId !== currentChainId) {
      throw new Error(`Agent ${agentId} is not on current chain ${currentChainId}`);
    }

    // Get agent URI from contract
    let agentURI: string;
    try {
      agentURI = await this._chainClient.readContract<string>({
        address: this.identityRegistryAddress(),
        abi: IDENTITY_REGISTRY_ABI,
        functionName: 'tokenURI',
        args: [BigInt(tokenId)],
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to load agent ${agentId}: ${errorMessage}`);
    }

    // Load registration file - handle empty URI (agent registered without URI yet)
    let registrationFile: RegistrationFile;
    if (!agentURI || agentURI === '') {
      // Agent registered but no URI set yet - create empty registration file
      registrationFile = this._createEmptyRegistrationFile();
    } else {
      registrationFile = await this._loadRegistrationFile(agentURI);
    }

    registrationFile.agentId = agentId;
    registrationFile.agentURI = agentURI || undefined;

    return new Agent(this, registrationFile);
  }

  /**
   * Get agent summary from subgraph (read-only)
   * Supports both default chain and explicit chain specification via chainId:tokenId format
   */
  async getAgent(agentId: AgentId): Promise<AgentSummary | null> {
    // Parse agentId to extract chainId if present
    // If no colon, assume it's just tokenId on default chain
    let parsedChainId: number;
    let formattedAgentId: string;

    if (agentId.includes(':')) {
      const parsed = parseAgentId(agentId);
      parsedChainId = parsed.chainId;
      formattedAgentId = agentId; // Already in correct format
    } else {
      // No colon - use default chain
      parsedChainId = this._chainId;
      formattedAgentId = formatAgentId(
        this._chainId,
        parseAgentId(`${this._chainId}:${agentId}`).tokenId
      );
    }

    // Determine which chain to query
    const targetChainId = parsedChainId !== this._chainId ? parsedChainId : undefined;

    // Get subgraph client for the target chain (or use default)
    const subgraphClient = targetChainId
      ? this.getSubgraphClient(targetChainId)
      : this._subgraphClient;

    if (!subgraphClient) {
      throw new Error(
        `Subgraph client required for getAgent on chain ${targetChainId || this._chainId}`
      );
    }

    return subgraphClient.getAgentById(formattedAgentId);
  }

  /**
   * Search agents with filters
   * Supports multi-chain search when chains parameter is provided
   */
  async searchAgents(
    filters: SearchFilters = {},
    options: SearchOptions = {}
  ): Promise<AgentSummary[]> {
    return this._indexer.searchAgents(filters, options);
  }

  /**
   * Transfer agent ownership
   */
  async transferAgent(
    agentId: AgentId,
    newOwner: Address
  ): Promise<TransactionHandle<{ txHash: string; from: Address; to: Address; agentId: AgentId }>> {
    const agent = await this.loadAgent(agentId);
    return agent.transfer(newOwner);
  }

  /**
   * Check if address is agent owner
   */
  async isAgentOwner(agentId: AgentId, address: Address): Promise<boolean> {
    const { chainId, tokenId } = parseAgentId(agentId);
    if (chainId !== this._chainId) {
      throw new Error(`Agent ${agentId} is not on current chain ${this._chainId}`);
    }
    const owner = await this._chainClient.readContract<string>({
      address: this.identityRegistryAddress(),
      abi: IDENTITY_REGISTRY_ABI,
      functionName: 'ownerOf',
      args: [BigInt(tokenId)],
    });
    return owner.toLowerCase() === address.toLowerCase();
  }

  /**
   * Get agent owner
   */
  async getAgentOwner(agentId: AgentId): Promise<Address> {
    const { chainId, tokenId } = parseAgentId(agentId);
    if (chainId !== this._chainId) {
      throw new Error(`Agent ${agentId} is not on current chain ${this._chainId}`);
    }
    return await this._chainClient.readContract<Address>({
      address: this.identityRegistryAddress(),
      abi: IDENTITY_REGISTRY_ABI,
      functionName: 'ownerOf',
      args: [BigInt(tokenId)],
    });
  }

  // Feedback methods

  /**
   * Prepare an off-chain feedback file.
   *
   * This does NOT include on-chain fields like score/tag1/tag2/endpoint.
   */
  prepareFeedbackFile(
    input: FeedbackFileInput,
    extra?: Record<string, unknown>
  ): FeedbackFileInput {
    return this._feedbackManager.prepareFeedbackFile(input, extra);
  }

  /**
   * Give feedback
   */
  async giveFeedback(
    agentId: AgentId,
    value: number | string,
    tag1?: string,
    tag2?: string,
    endpoint?: string,
    feedbackFile?: FeedbackFileInput
  ): Promise<TransactionHandle<Feedback>> {
    // Update feedback manager with registries
    this._feedbackManager.setReputationRegistryAddress(this.reputationRegistryAddress());
    this._feedbackManager.setIdentityRegistryAddress(this.identityRegistryAddress());

    return this._feedbackManager.giveFeedback(agentId, value, tag1, tag2, endpoint, feedbackFile);
  }

  /**
   * Read feedback
   */
  async getFeedback(
    agentId: AgentId,
    clientAddress: Address,
    feedbackIndex: number
  ): Promise<Feedback> {
    return this._feedbackManager.getFeedback(agentId, clientAddress, feedbackIndex);
  }

  /**
   * Search feedback
   */
  async searchFeedback(
    filters: FeedbackSearchFilters,
    options: FeedbackSearchOptions = {}
  ): Promise<Feedback[]> {
    const mergedAgents = [...(filters.agents ?? []), ...(filters.agentId ? [filters.agentId] : [])];
    const agents = mergedAgents.length > 0 ? Array.from(new Set(mergedAgents)) : undefined;

    const hasAnyFilter =
      (agents?.length ?? 0) > 0 ||
      (filters.reviewers?.length ?? 0) > 0 ||
      (filters.tags?.length ?? 0) > 0 ||
      (filters.capabilities?.length ?? 0) > 0 ||
      (filters.skills?.length ?? 0) > 0 ||
      (filters.tasks?.length ?? 0) > 0 ||
      (filters.names?.length ?? 0) > 0 ||
      options.minValue !== undefined ||
      options.maxValue !== undefined;

    // Previously, `agentId` was required so a fully-empty search wasn't possible.
    // Keep behavior safe by rejecting empty searches that would otherwise return arbitrary global results.
    if (!hasAnyFilter) {
      throw new Error(
        'searchFeedback requires at least one filter (agentId/agents/reviewers/tags/capabilities/skills/tasks/names/minValue/maxValue).'
      );
    }

    const params: SearchFeedbackParams = {
      agents,
      tags: filters.tags,
      reviewers: filters.reviewers,
      capabilities: filters.capabilities,
      skills: filters.skills,
      tasks: filters.tasks,
      names: filters.names,
      includeRevoked: filters.includeRevoked,
      minValue: options.minValue,
      maxValue: options.maxValue,
    };
    return this._feedbackManager.searchFeedback(params);
  }

  /**
   * Append response to feedback
   */
  async appendResponse(
    agentId: AgentId,
    clientAddress: Address,
    feedbackIndex: number,
    response: { uri: URI; hash: string }
  ): Promise<TransactionHandle<Feedback>> {
    // Update feedback manager with registries
    this._feedbackManager.setReputationRegistryAddress(this.reputationRegistryAddress());

    return this._feedbackManager.appendResponse(
      agentId,
      clientAddress,
      feedbackIndex,
      response.uri,
      response.hash
    );
  }

  /**
   * Revoke feedback
   */
  async revokeFeedback(
    agentId: AgentId,
    feedbackIndex: number
  ): Promise<TransactionHandle<Feedback>> {
    // Update feedback manager with registries
    this._feedbackManager.setReputationRegistryAddress(this.reputationRegistryAddress());

    return this._feedbackManager.revokeFeedback(agentId, feedbackIndex);
  }

  /**
   * Get reputation summary
   */
  async getReputationSummary(
    agentId: AgentId,
    tag1?: string,
    tag2?: string
  ): Promise<{ count: number; averageValue: number }> {
    // Update feedback manager with registries
    this._feedbackManager.setReputationRegistryAddress(this.reputationRegistryAddress());

    return this._feedbackManager.getReputationSummary(agentId, tag1, tag2);
  }

  /**
   * Create an empty registration file structure
   */
  private _createEmptyRegistrationFile(): RegistrationFile {
    return {
      name: '',
      description: '',
      endpoints: [],
      trustModels: [],
      owners: [],
      operators: [],
      active: false,
      x402support: false,
      metadata: {},
      updatedAt: Math.floor(Date.now() / 1000),
    };
  }

  /**
   * Private helper methods
   */
  private async _loadRegistrationFile(tokenUri: string): Promise<RegistrationFile> {
    try {
      // Fetch from IPFS or HTTP
      let rawData: unknown;
      if (!tokenUri || tokenUri.trim() === '') {
        return this._createEmptyRegistrationFile();
      }

      assertLoadableAgentUri(tokenUri, 'agent registration URI');

      if (tokenUri.startsWith('ipfs://')) {
        const cid = tokenUri.slice(7);
        if (this._ipfsClient) {
          // Use IPFS client if available
          rawData = await this._ipfsClient.getJson(cid);
        } else {
          // Fallback to HTTP gateways if no IPFS client configured
          const gateways = IPFS_GATEWAYS.map((gateway) => `${gateway}${cid}`);

          let fetched = false;
          for (const gateway of gateways) {
            try {
              const response = await fetch(gateway, {
                signal: AbortSignal.timeout(TIMEOUTS.IPFS_GATEWAY),
              });
              if (response.ok) {
                rawData = await response.json();
                fetched = true;
                break;
              }
            } catch {
              continue;
            }
          }

          if (!fetched) {
            throw new Error('Failed to retrieve data from all IPFS gateways');
          }
        }
      } else if (tokenUri.startsWith('http://') || tokenUri.startsWith('https://')) {
        const response = await fetch(tokenUri);
        if (!response.ok) {
          throw new Error(`Failed to fetch registration file: HTTP ${response.status}`);
        }
        rawData = await response.json();
      } else {
        throw new Error(`Unsupported URI scheme for agent registration URI: ${tokenUri}`);
      }

      // Validate rawData is an object before transformation
      if (typeof rawData !== 'object' || rawData === null || Array.isArray(rawData)) {
        throw new Error('Invalid registration file format: expected an object');
      }

      return transformRegistrationFile(rawData as Record<string, unknown>);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to load registration file: ${errorMessage}`);
    }
  }

  // Expose clients for advanced usage
  get chainClient(): ChainClient {
    return this._chainClient;
  }

  get ipfsClient(): IPFSClient | undefined {
    return this._ipfsClient;
  }

  get subgraphClient(): SubgraphClient | undefined {
    return this._subgraphClient;
  }
}
