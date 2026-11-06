/**
 * @file parser.ts
 * @description High-performance streaming parser and classifier for AdGuard and hosts format DNS filtering rules.
 */

import { AdGuardRuleKind, ParsedAdGuardRule, RewriteAction } from "./types";

/**
 * Checks if a string looks like an IPv4 or IPv6 address.
 */
function isIpAddress(str: string): boolean {
  if (str.includes(":")) return true; // IPv6
  let dotCount = 0;
  const len = str.length;
  if (len < 7 || len > 15) return false;
  for (let i = 0; i < len; i++) {
    const code = str.charCodeAt(i);
    if (code === 46) {
      dotCount++;
    } else if (code < 48 || code > 57) {
      return false;
    }
  }
  return dotCount === 3;
}

/**
 * Extracts candidate apex / eTLD+1 domain for pattern indexing.
 * E.g. "*-ad.example.com" -> "example.com"
 * If the apex contains wildcards (e.g. "example.*"), returns undefined.
 */
export function extractApexDomain(pattern: string): string | undefined {
  const parts = pattern.toLowerCase().split(".").filter(Boolean);
  if (parts.length < 2) return undefined;

  const last = parts[parts.length - 1];
  const secondLast = parts[parts.length - 2];
  if (last.includes("*") || secondLast.includes("*")) return undefined;

  // Multi-part TLD heuristic (e.g. .co.uk, .com.cn, .edu.au)
  const commonSecondLevels = new Set(["co", "com", "net", "org", "edu", "gov", "ac"]);
  if (parts.length >= 3 && commonSecondLevels.has(secondLast) && last.length === 2) {
    const thirdLast = parts[parts.length - 3];
    if (thirdLast.includes("*")) return undefined;
    return `${thirdLast}.${secondLast}.${last}`;
  }

  return `${secondLast}.${last}`;
}

/**
 * Converts a wildcard domain pattern (e.g. "||*-ads.example.com^") into a safe RegExp source string.
 */
export function wildcardToRegex(pattern: string, includeSubdomains: boolean): string {
  let cleaned = pattern;
  if (cleaned.startsWith("||")) cleaned = cleaned.substring(2);
  if (cleaned.startsWith("|")) cleaned = cleaned.substring(1);
  const caretIdx = cleaned.indexOf("^");
  if (caretIdx !== -1) cleaned = cleaned.substring(0, caretIdx);
  const dollarIdx = cleaned.indexOf("$");
  if (dollarIdx !== -1) cleaned = cleaned.substring(0, dollarIdx);

  cleaned = cleaned.trim().toLowerCase();

  // Escape special regex characters except '*'
  const escaped = cleaned.replace(/[-[\]{}()+?.,\\^$|#\s]/g, "\\$&").replace(/\*/g, ".*");

  if (includeSubdomains) {
    return `^(?:.*\\.)?${escaped}$`;
  }
  return `^${escaped}$`;
}

/**
 * Parses a single line from an AdGuard, hosts, or plain-domain blocklist.
 *
 * @param line - Raw line from subscription list or rule configuration.
 * @returns ParsedAdGuardRule object or null if line is empty / invalid.
 */
export function parseAdGuardLine(line: string): ParsedAdGuardRule | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  // Fast Path: High-frequency standard AdGuard domain rule (e.g. ||ad.example.com^)
  // Bypasses cosmetic, comment, regex, and modifier checks for >80% of blocklist rules.
  if (trimmed.charCodeAt(0) === 124 && trimmed.charCodeAt(1) === 124) { // '||'
    if (!trimmed.includes("$") && !trimmed.includes("*") && !trimmed.includes("#")) {
      let target = trimmed.substring(2);
      const caretIdx = target.indexOf("^");
      if (caretIdx !== -1) target = target.substring(0, caretIdx);
      target = target.trim().toLowerCase();
      if (target) {
        return {
          kind: AdGuardRuleKind.BLOOM_DOMAIN,
          raw: trimmed,
          domain: target,
          includeSubdomains: true
        };
      }
    }
  }

  // 1. Cosmetic / Element-hiding rules (not applicable to DNS)
  if (trimmed.includes("##") || trimmed.includes("#@#") || trimmed.includes("#?#") || trimmed.startsWith("$$")) {
    return { kind: AdGuardRuleKind.UNSUPPORTED, raw: trimmed };
  }

  // 2. Comments and metadata (lines starting with '!' or standalone '#')
  const firstChar = trimmed.charCodeAt(0);
  if (firstChar === 33 || firstChar === 35) { // '!' or '#'
    return { kind: AdGuardRuleKind.COMMENT, raw: trimmed };
  }

  // 3. Regular Expression rules: /regex/ or /regex/$modifier
  if (trimmed.startsWith("/") && trimmed.length > 2) {
    const endSlash = trimmed.lastIndexOf("/");
    if (endSlash > 0) {
      const regexBody = trimmed.substring(1, endSlash);
      // Validate length to prevent ReDoS / excessive resource consumption
      if (regexBody.length > 256) {
        return { kind: AdGuardRuleKind.UNSUPPORTED, raw: trimmed };
      }
      try {
        new RegExp(regexBody, "i"); // Validation check
        const apex = extractApexDomain(regexBody.replace(/[\\^$]/g, ""));
        return {
          kind: AdGuardRuleKind.COMPLEX_PATTERN,
          raw: trimmed,
          patternRegex: regexBody,
          apexIndex: apex
        };
      } catch {
        return { kind: AdGuardRuleKind.UNSUPPORTED, raw: trimmed };
      }
    }
  }

  // 4. Whitelist / Exception rules (starts with @@)
  if (trimmed.startsWith("@@")) {
    const withoutAt = trimmed.substring(2);
    let includeSubdomains = false;
    let target = withoutAt;

    if (target.startsWith("||")) {
      includeSubdomains = true;
      target = target.substring(2);
    } else if (target.startsWith("|")) {
      includeSubdomains = false;
      target = target.substring(1);
    }

    const caretIdx = target.indexOf("^");
    if (caretIdx !== -1) target = target.substring(0, caretIdx);
    const dollarIdx = target.indexOf("$");
    if (dollarIdx !== -1) target = target.substring(0, dollarIdx);

    target = target.trim().toLowerCase();
    if (!target) return null;

    if (target.includes("*")) {
      return {
        kind: AdGuardRuleKind.COMPLEX_PATTERN,
        raw: trimmed,
        patternRegex: wildcardToRegex(target, includeSubdomains),
        apexIndex: extractApexDomain(target)
      };
    }

    return {
      kind: AdGuardRuleKind.EXCEPTION,
      raw: trimmed,
      domain: target,
      includeSubdomains
    };
  }

  // 5. DNS Rewrite rules ($dnsrewrite=...)
  const dnsRewriteIdx = trimmed.indexOf("$dnsrewrite=");
  if (dnsRewriteIdx !== -1) {
    const domainPart = trimmed.substring(0, dnsRewriteIdx);
    const rewriteValue = trimmed.substring(dnsRewriteIdx + "$dnsrewrite=".length).trim();

    let includeSubdomains = false;
    let targetDomain = domainPart;
    if (targetDomain.startsWith("||")) {
      includeSubdomains = true;
      targetDomain = targetDomain.substring(2);
    } else if (targetDomain.startsWith("|")) {
      includeSubdomains = false;
      targetDomain = targetDomain.substring(1);
    }

    const caretIdx = targetDomain.indexOf("^");
    if (caretIdx !== -1) targetDomain = targetDomain.substring(0, caretIdx);
    targetDomain = targetDomain.trim().toLowerCase();
    if (!targetDomain) return null;

    let rewrite: RewriteAction;
    const upperVal = rewriteValue.toUpperCase();
    if (upperVal === "NXDOMAIN" || upperVal === "REFUSED") {
      rewrite = { type: upperVal };
    } else if (isIpAddress(rewriteValue)) {
      rewrite = {
        type: rewriteValue.includes(":") ? "AAAA" : "A",
        value: rewriteValue
      };
    } else {
      rewrite = {
        type: "CNAME",
        value: rewriteValue.toLowerCase()
      };
    }

    return {
      kind: AdGuardRuleKind.DNS_REWRITE,
      raw: trimmed,
      domain: targetDomain,
      includeSubdomains,
      rewrite
    };
  }

  // 6. Hosts-file format (e.g. 127.0.0.1 example.com or 0.0.0.0 example.com)
  const parts = trimmed.split(/\s+/);
  if (parts.length >= 2 && isIpAddress(parts[0])) {
    const domain = parts[1].toLowerCase().trim();
    if (domain && domain !== "localhost" && domain !== "0.0.0.0" && domain !== "127.0.0.1") {
      return {
        kind: AdGuardRuleKind.BLOOM_DOMAIN,
        raw: trimmed,
        domain,
        includeSubdomains: false // Hosts format is strictly exact match
      };
    }
    return null;
  }

  // 7. AdGuard / Domain rules with wildcards (e.g. ||*-ads.example.com^)
  let domainTarget = trimmed;
  let includeSubdomains = false;

  if (domainTarget.startsWith("||")) {
    includeSubdomains = true;
    domainTarget = domainTarget.substring(2);
  } else if (domainTarget.startsWith("|")) {
    includeSubdomains = false;
    domainTarget = domainTarget.substring(1);
  }

  // Strip trailing ^ and modifiers like $all, $popup, $important
  const caretIdx = domainTarget.indexOf("^");
  if (caretIdx !== -1) domainTarget = domainTarget.substring(0, caretIdx);
  const dollarIdx = domainTarget.indexOf("$");
  if (dollarIdx !== -1) domainTarget = domainTarget.substring(0, dollarIdx);

  domainTarget = domainTarget.trim().toLowerCase();
  if (!domainTarget) return null;

  if (domainTarget.includes("*")) {
    return {
      kind: AdGuardRuleKind.COMPLEX_PATTERN,
      raw: trimmed,
      patternRegex: wildcardToRegex(domainTarget, includeSubdomains),
      apexIndex: extractApexDomain(domainTarget)
    };
  }

  // 8. Standard Bloom Filter domain
  return {
    kind: AdGuardRuleKind.BLOOM_DOMAIN,
    raw: trimmed,
    domain: domainTarget,
    includeSubdomains
  };
}
