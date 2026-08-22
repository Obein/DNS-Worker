import { createCidrMatcher } from "../cidr";

let activeCfProxyCidrs: readonly string[] = [];
let activeCfMatcher: ((ip: string) => boolean) | null = null;

/**
 * Updates the in-memory Cloudflare CIDR list and recompiles the fast matcher.
 *
 * @param cidrs - Array of CIDR strings.
 */
export function updateActiveCfProxyCidrs(cidrs: readonly string[]): void {
  if (cidrs && cidrs.length > 0) {
    activeCfProxyCidrs = cidrs;
    activeCfMatcher = createCidrMatcher(activeCfProxyCidrs);
  }
}

/**
 * Returns the currently active in-memory Cloudflare CIDR ranges.
 */
export function getActiveCfProxyCidrs(): readonly string[] {
  return activeCfProxyCidrs;
}

/**
 * High-performance compiled CIDR matcher for Cloudflare CDN/Proxy edge IPs.
 *
 * @param ip - The IP address to check.
 * @returns True if the IP belongs to Cloudflare CDN/Proxy edge.
 */
export function isCloudflareIp(ip: string): boolean {
  return activeCfMatcher ? activeCfMatcher(ip) : false;
}
