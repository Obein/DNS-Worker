/**
 * @file matcher.ts
 * @description In-memory evaluation engine for AdGuard extended rules (exceptions, rewrites, and patterns).
 */

import { AdGuardPayload, RewriteAction } from "./types";
import { extractApexDomain } from "./parser";

interface StoredException {
  domain: string;
  includeSubdomains: boolean;
  raw?: string;
}

interface CompiledPattern {
  re: RegExp;
  raw?: string;
  pattern: string;
}

export class AdGuardProfileEngine {
  private exactExceptions: Map<string, StoredException> = new Map();
  private subdomainExceptions: Map<string, StoredException> = new Map();
  private exactRewrites: Map<string, RewriteAction & { raw?: string }> = new Map();
  private subdomainRewrites: Map<string, RewriteAction & { raw?: string }> = new Map();
  private indexedPatterns: Map<string, CompiledPattern[]> = new Map();
  private globalPatterns: CompiledPattern[] = [];

  constructor(payload?: AdGuardPayload | null) {
    if (!payload) return;

    // 1. Exception rules (@@)
    if (Array.isArray(payload.exceptions)) {
      for (const exc of payload.exceptions) {
        if (!exc.domain) continue;
        const d = exc.domain.toLowerCase().trim();
        const stored: StoredException = {
          domain: d,
          includeSubdomains: Boolean(exc.includeSubdomains),
          raw: exc.raw
        };
        if (exc.includeSubdomains) {
          this.subdomainExceptions.set(d, stored);
        } else {
          this.exactExceptions.set(d, stored);
        }
      }
    }

    // 2. DNS Rewrite rules ($dnsrewrite)
    if (payload.rewrites && typeof payload.rewrites === "object") {
      for (const [domain, action] of Object.entries(payload.rewrites)) {
        const d = domain.toLowerCase().trim();
        if (action.includeSubdomains) {
          this.subdomainRewrites.set(d, action);
        } else {
          this.exactRewrites.set(d, action);
        }
      }
    }

    // 3. Complex pattern rules (/regex/ and wildcards)
    if (Array.isArray(payload.patterns)) {
      for (const pat of payload.patterns) {
        try {
          const re = new RegExp(pat.pattern, "i");
          const compiled: CompiledPattern = {
            re,
            raw: pat.raw,
            pattern: pat.pattern
          };
          if (pat.apexIndex) {
            const list = this.indexedPatterns.get(pat.apexIndex) || [];
            list.push(compiled);
            this.indexedPatterns.set(pat.apexIndex, list);
          } else {
            this.globalPatterns.push(compiled);
          }
        } catch {
          // Silently discard malformed regex
        }
      }
    }
  }

  /**
   * Checks whether the given domain is exempted by any whitelist exception (@@).
   */
  testException(domain: string): boolean {
    const d = domain.toLowerCase().trim();
    if (this.exactExceptions.has(d)) return true;
    if (this.subdomainExceptions.has(d)) return true;

    let dotIdx = d.indexOf(".");
    while (dotIdx !== -1) {
      const parent = d.substring(dotIdx + 1);
      if (this.subdomainExceptions.has(parent)) return true;
      dotIdx = d.indexOf(".", dotIdx + 1);
    }
    return false;
  }

  /**
   * Finds the specific exception rule entry (if any) that matches the domain.
   * Returns the formatted rule pattern (e.g. "@@||microsoft.com^"), or null.
   */
  findException(domain: string): string | null {
    const d = domain.toLowerCase().trim();
    const exact = this.exactExceptions.get(d);
    if (exact) {
      return exact.raw || `@@|${exact.domain}^`;
    }
    const sub = this.subdomainExceptions.get(d);
    if (sub) {
      return sub.raw || `@@||${sub.domain}^`;
    }

    let dotIdx = d.indexOf(".");
    while (dotIdx !== -1) {
      const parent = d.substring(dotIdx + 1);
      const parentSub = this.subdomainExceptions.get(parent);
      if (parentSub) {
        return parentSub.raw || `@@||${parentSub.domain}^`;
      }
      dotIdx = d.indexOf(".", dotIdx + 1);
    }
    return null;
  }

  /**
   * Evaluates if domain matches any DNS rewrite rule ($dnsrewrite).
   */
  matchRewrite(domain: string): RewriteAction | null {
    const d = domain.toLowerCase().trim();
    const exact = this.exactRewrites.get(d);
    if (exact) return exact;

    const sub = this.subdomainRewrites.get(d);
    if (sub) return sub;

    let dotIdx = d.indexOf(".");
    while (dotIdx !== -1) {
      const parent = d.substring(dotIdx + 1);
      const parentSub = this.subdomainRewrites.get(parent);
      if (parentSub) return parentSub;
      dotIdx = d.indexOf(".", dotIdx + 1);
    }
    return null;
  }

  /**
   * Finds the specific rewrite rule entry (if any) that matches the domain.
   */
  findRewrite(domain: string): { action: RewriteAction; raw?: string } | null {
    const d = domain.toLowerCase().trim();
    const exact = this.exactRewrites.get(d);
    if (exact) return { action: exact, raw: exact.raw };

    const sub = this.subdomainRewrites.get(d);
    if (sub) return { action: sub, raw: sub.raw };

    let dotIdx = d.indexOf(".");
    while (dotIdx !== -1) {
      const parent = d.substring(dotIdx + 1);
      const parentSub = this.subdomainRewrites.get(parent);
      if (parentSub) return { action: parentSub, raw: parentSub.raw };
      dotIdx = d.indexOf(".", dotIdx + 1);
    }
    return null;
  }

  /**
   * Tests whether the domain matches any compiled complex wildcard or regex pattern.
   */
  matchPattern(domain: string): boolean {
    const d = domain.toLowerCase().trim();

    // 1. Accelerated search within apex-indexed bucket
    const apex = extractApexDomain(d);
    if (apex) {
      const list = this.indexedPatterns.get(apex);
      if (list && list.length > 0) {
        for (const item of list) {
          if (item.re.test(d)) return true;
        }
      }
    }

    // 2. Global wildcard patterns
    for (const item of this.globalPatterns) {
      if (item.re.test(d)) return true;
    }

    return false;
  }

  /**
   * Finds the specific complex wildcard or regex pattern (if any) that matches the domain.
   */
  findPattern(domain: string): { matched: boolean; raw?: string; pattern?: string } | null {
    const d = domain.toLowerCase().trim();

    // 1. Accelerated search within apex-indexed bucket
    const apex = extractApexDomain(d);
    if (apex) {
      const list = this.indexedPatterns.get(apex);
      if (list && list.length > 0) {
        for (const item of list) {
          if (item.re.test(d)) {
            return { matched: true, raw: item.raw, pattern: item.pattern };
          }
        }
      }
    }

    // 2. Global wildcard patterns
    for (const item of this.globalPatterns) {
      if (item.re.test(d)) {
        return { matched: true, raw: item.raw, pattern: item.pattern };
      }
    }

    return null;
  }
}
