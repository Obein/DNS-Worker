/**
 * @file types.ts
 * @description Data types and interfaces for AdGuard format rule parsing, compilation, and evaluation.
 */

export enum AdGuardRuleKind {
  /** Standard domain block rule suitable for Bloom filter (e.g. ||example.com^ or bare example.com) */
  BLOOM_DOMAIN = 0,
  /** Whitelist exception rule (e.g. @@||example.com^ or @@|example.com^) */
  EXCEPTION = 1,
  /** DNS rewrite rule (e.g. ||example.com^$dnsrewrite=1.2.3.4 or ||example.com^$dnsrewrite=NXDOMAIN) */
  DNS_REWRITE = 2,
  /** Regular expression or complex wildcard pattern (e.g. /ad[0-9]+\.example\.com/ or ||*-ad.com^) */
  COMPLEX_PATTERN = 3,
  /** Informational comment or metadata line (e.g. ! or #) */
  COMMENT = 4,
  /** Non-DNS rule (e.g. cosmetic / element hiding ## or $$), ignored safely in DNS engine */
  UNSUPPORTED = 5
}

/** Action and payload for DNS rewrites ($dnsrewrite) */
export interface RewriteAction {
  type: 'A' | 'AAAA' | 'CNAME' | 'NXDOMAIN' | 'REFUSED';
  value?: string;
}

/** Result of parsing a single line of an AdGuard format rule */
export interface ParsedAdGuardRule {
  kind: AdGuardRuleKind;
  raw: string;
  domain?: string;
  includeSubdomains?: boolean;
  rewrite?: RewriteAction;
  patternRegex?: string;
  apexIndex?: string;
}

/** Serialized compact AdGuard rules payload for a profile or list */
export interface AdGuardPayload {
  /** Whitelist exceptions */
  exceptions: Array<{
    domain: string;
    includeSubdomains: boolean;
    raw?: string;
  }>;
  /** DNS rewrite rules mapped by domain */
  rewrites: Record<string, RewriteAction & { includeSubdomains: boolean; raw?: string }>;
  /** Compiled regex and wildcard patterns */
  patterns: Array<{
    pattern: string;
    apexIndex?: string;
    raw?: string;
  }>;
}
