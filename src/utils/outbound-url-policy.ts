export interface OutboundUrlPolicy {
  /**
   * Enables policy enforcement.
   *
   * Defaults to false to preserve backward compatibility.
   */
  enabled?: boolean;
  /**
   * Optional allowlist.
   * Supports exact hosts and wildcard suffix patterns like "*.example.com".
   */
  allowedHosts?: string[];
  /**
   * Optional denylist.
   * Supports exact hosts and wildcard suffix patterns like "*.internal".
   */
  blockedHosts?: string[];
  /**
   * Whether to allow localhost targets.
   * Defaults to false when policy is enabled.
   */
  allowLocalhost?: boolean;
  /**
   * Whether to allow private/link-local IP literals.
   * Defaults to false when policy is enabled.
   */
  allowPrivateNetworks?: boolean;
  /**
   * Whether to reject credentialed URLs (user:pass@host).
   * Defaults to true when policy is enabled.
   */
  disallowCredentials?: boolean;
}

function isIpv4Literal(hostname: string): boolean {
  const parts = hostname.split('.');
  if (parts.length !== 4) return false;
  return parts.every((p) => /^\d+$/.test(p) && Number(p) >= 0 && Number(p) <= 255);
}

function isPrivateIpv4(hostname: string): boolean {
  if (!isIpv4Literal(hostname)) return false;
  const parts = hostname.split('.').map((p) => Number(p));
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 0) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // Carrier-grade NAT
  return false;
}

function isIpv6Literal(hostname: string): boolean {
  return hostname.includes(':');
}

function isPrivateIpv6(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === '::1' || h === '0:0:0:0:0:0:0:1') return true;
  if (h.startsWith('fc') || h.startsWith('fd')) return true; // fc00::/7
  if (h.startsWith('fe8') || h.startsWith('fe9') || h.startsWith('fea') || h.startsWith('feb')) {
    return true; // fe80::/10
  }
  return false;
}

function isLocalhostHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return (
    h === 'localhost' ||
    h.endsWith('.localhost') ||
    h === '127.0.0.1' ||
    h === '::1' ||
    h === '0:0:0:0:0:0:0:1'
  );
}

function hostMatchesPattern(hostname: string, pattern: string): boolean {
  const host = hostname.toLowerCase();
  const p = pattern.trim().toLowerCase();
  if (!p) return false;
  if (p.startsWith('*.')) {
    const suffix = p.slice(1); // ".example.com"
    return host.endsWith(suffix) && host !== suffix.slice(1);
  }
  return host === p;
}

function isPolicyEnabled(policy?: OutboundUrlPolicy): boolean {
  if (!policy) return false;
  if (policy.enabled === true) return true;
  if ((policy.allowedHosts?.length ?? 0) > 0) return true;
  if ((policy.blockedHosts?.length ?? 0) > 0) return true;
  return false;
}

export function enforceOutboundUrlPolicy(
  rawUrl: string,
  policy?: OutboundUrlPolicy,
  source: string = 'outbound fetch'
): void {
  if (!isPolicyEnabled(policy)) return;

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`[${source}] Invalid URL: ${rawUrl}`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`[${source}] Unsupported protocol "${parsed.protocol}" for URL: ${rawUrl}`);
  }

  const disallowCredentials = policy?.disallowCredentials ?? true;
  if (disallowCredentials && (parsed.username || parsed.password)) {
    throw new Error(`[${source}] Credentialed URLs are not allowed: ${rawUrl}`);
  }

  const hostname = parsed.hostname.toLowerCase();

  const blockedHosts = policy?.blockedHosts ?? [];
  if (blockedHosts.some((p) => hostMatchesPattern(hostname, p))) {
    throw new Error(`[${source}] Host blocked by outbound URL policy: ${hostname}`);
  }

  const allowedHosts = policy?.allowedHosts ?? [];
  if (allowedHosts.length > 0 && !allowedHosts.some((p) => hostMatchesPattern(hostname, p))) {
    throw new Error(`[${source}] Host not in outbound URL allowlist: ${hostname}`);
  }

  const allowLocalhost = policy?.allowLocalhost ?? false;
  if (!allowLocalhost && isLocalhostHost(hostname)) {
    throw new Error(`[${source}] Localhost targets are not allowed: ${hostname}`);
  }

  const allowPrivateNetworks = policy?.allowPrivateNetworks ?? false;
  if (!allowPrivateNetworks) {
    if (isPrivateIpv4(hostname) || (isIpv6Literal(hostname) && isPrivateIpv6(hostname))) {
      throw new Error(`[${source}] Private network targets are not allowed: ${hostname}`);
    }
  }
}
