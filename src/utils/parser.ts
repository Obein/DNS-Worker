/**
 * @file parser.ts
 * @description Backward-compatible wrapper around modern AdGuard rule parser.
 */

import { parseAdGuardLine, AdGuardRuleKind } from "../lib/adguard";

/**
 * Parses a single line from a blocklist and extracts a domain for basic consumers.
 *
 * @param line - Raw line.
 * @returns Domain string or null.
 */
export function parseLine(line: string): string | null {
  const parsed = parseAdGuardLine(line);
  if (!parsed) return null;
  if (parsed.kind === AdGuardRuleKind.BLOOM_DOMAIN) {
    return parsed.domain || null;
  }
  return null;
}

/**
 * Parses full content and returns a set of unique domain strings.
 */
export function parseList(content: string): string[] {
  const domains = new Set<string>();
  const lines = content.split('\n');
  for (const line of lines) {
    const domain = parseLine(line);
    if (domain) {
      domains.add(domain);
    }
  }
  return Array.from(domains);
}
