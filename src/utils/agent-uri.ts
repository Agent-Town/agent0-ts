import type { URI } from '../models/types.js';

function supportedAgentUriSchemes(uri: string): boolean {
  return (
    uri.startsWith('ipfs://') ||
    uri.startsWith('http://') ||
    uri.startsWith('https://') ||
    uri.startsWith('data:')
  );
}

export function assertLoadableAgentUri(uri: URI, context: string = 'agent URI'): void {
  if (!uri || uri.trim() === '') {
    return;
  }

  if (!supportedAgentUriSchemes(uri)) {
    throw new Error(`Unsupported URI scheme for ${context}: ${uri}`);
  }
}

export function assertHttpAgentUri(uri: URI, context: string = 'agent URI'): void {
  if (!uri || uri.trim() === '') {
    throw new Error(`Invalid ${context}: expected a non-empty HTTP(S) URI`);
  }

  if (!uri.startsWith('http://') && !uri.startsWith('https://')) {
    throw new Error(`Unsupported URI scheme for ${context}: ${uri}. Expected http:// or https://`);
  }
}
