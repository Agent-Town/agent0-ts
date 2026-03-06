/**
 * Utility functions for parsing and formatting Agent IDs and Feedback IDs
 */

import { normalizeAddress } from './validation.js';

function parseStrictInteger(value: string, label: string): number {
  if (!/^\d+$/.test(value)) {
    throw new Error(`Invalid ${label}: ${value}. Expected a base-10 integer`);
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`Invalid ${label}: ${value}. Expected a safe integer`);
  }

  return parsed;
}

/**
 * Parse an AgentId string into chainId and tokenId
 * Format: "chainId:tokenId" or just "tokenId" (when chain is implicit)
 */
export function parseAgentId(agentId: string | null | undefined): { chainId: number; tokenId: number } {
  if (!agentId || typeof agentId !== 'string') {
    throw new Error(`Invalid AgentId: ${agentId}. Expected a non-empty string in format "chainId:tokenId"`);
  }

  if (agentId.includes(':')) {
    const parts = agentId.split(':');
    if (parts.length !== 2) {
      throw new Error(`Invalid AgentId format: ${agentId}. Expected "chainId:tokenId"`);
    }

    const [chainId, tokenId] = parts;
    return {
      chainId: parseStrictInteger(chainId, 'chainId'),
      tokenId: parseStrictInteger(tokenId, 'tokenId'),
    };
  }
  throw new Error(`Invalid AgentId format: ${agentId}. Expected "chainId:tokenId"`);
}

/**
 * Format chainId and tokenId into AgentId string
 */
export function formatAgentId(chainId: number, tokenId: number): string {
  return `${chainId}:${tokenId}`;
}

/**
 * Parse a FeedbackId string into its components
 * Format: "agentId:clientAddress:feedbackIndex"
 * Note: agentId may contain colons (e.g., "11155111:123"), so we split from the right
 */
export function parseFeedbackId(feedbackId: string): {
  agentId: string;
  clientAddress: string;
  feedbackIndex: number;
} {
  const lastColonIndex = feedbackId.lastIndexOf(':');
  const secondLastColonIndex = feedbackId.lastIndexOf(':', lastColonIndex - 1);

  if (lastColonIndex === -1 || secondLastColonIndex === -1) {
    throw new Error(`Invalid feedback ID format: ${feedbackId}`);
  }

  const agentId = feedbackId.slice(0, secondLastColonIndex);
  const clientAddress = feedbackId.slice(secondLastColonIndex + 1, lastColonIndex);
  const feedbackIndexStr = feedbackId.slice(lastColonIndex + 1);

  parseAgentId(agentId);
  const feedbackIndex = parseStrictInteger(feedbackIndexStr, 'feedback index');

  // Normalize address to lowercase for consistency
  const normalizedAddress = normalizeAddress(clientAddress);

  return {
    agentId,
    clientAddress: normalizedAddress,
    feedbackIndex,
  };
}

/**
 * Format feedback ID components into FeedbackId string
 */
export function formatFeedbackId(
  agentId: string,
  clientAddress: string,
  feedbackIndex: number
): string {
  // Normalize address to lowercase
  const normalizedAddress = normalizeAddress(clientAddress);

  return `${agentId}:${normalizedAddress}:${feedbackIndex}`;
}
