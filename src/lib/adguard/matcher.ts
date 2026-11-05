/**
 * @file matcher.ts
 * @description In-memory evaluation engine for AdGuard extended rules (exceptions, rewrites, and patterns).
 */

import { AdGuardPayload, RewriteAction } from "./types";
import { extractApexDomain } from "./parser";

export class AdGuardProfileEngine {
  private exactExceptions: Set<string> = new Set();
  private subdomainExceptions: Set<string> = new Set();
  private exactRewrites: Map<string, RewriteAction> = new Map();
  private subdomainRewrites: Map<string, RewriteAction> = new Map();
  private indexedPatterns: Map<string, RegExp[]> = new Map();
  private globalPatterns: RegExp[] = [];

  constructor(payload?: AdGuardPayload | null) {
    if (!payload) return;

    // 1. Exception rules (@@)
    if (Array.isArray(payload.exceptions)) {
      for (const exc of payload.exceptions) {
        if (!exc.domain) continue;
        const d = exc.domain.toLowerCase().trim();
        if (exc.includeSubdomains) {
          this.subdomainExceptions.add(d);
        } else {
          this.exactExceptions.add(d);
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
          if (pat.apexIndex) {
            const list = this.indexedPatterns.get(pat.apexIndex) || [];
            list.push(re);
            this.indexedPatterns.set(pat.apexIndex, list);
          } else {
            this.globalPatterns.push(re);
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
   * Tests whether the domain matches any compiled complex wildcard or regex pattern.
   */
  matchPattern(domain: string): boolean {
    const d = domain.toLowerCase().trim();

    // 1. Accelerated search within apex-indexed bucket
    const apex = extractApexDomain(d);
    if (apex) {
      const list = this.indexedPatterns.get(apex);
      if (list && list.length > 0) {
        for (const re of list) {
          if (re.test(d)) return true;
        }
      }
    }

    // 2. Global wildcard patterns
    for (const re of this.globalPatterns) {
      if (re.test(d)) return true;
    }

    return false;
  }
}
