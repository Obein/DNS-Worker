/**
 * @file analyticsMerge.ts
 * @description Pure functions for validating unencrypted analytics records and merging
 * authoritative server analytics with local decrypted SQLite aggregations.
 */

import type { AnalyticsData } from "../types";

export interface AnalyticsValidationFlags {
  serverHasValidClients: boolean;
  serverHasValidTopAllowed: boolean;
  serverHasValidTopBlocked: boolean;
  serverHasDestinations: boolean;
}

/**
 * Checks whether client records contain readable, unencrypted IP addresses.
 *
 * @param clients - Array of client records.
 * @returns True if at least one client IP is unencrypted.
 */
export function hasValidClients(clients?: AnalyticsData["clients"]): boolean {
  if (!clients || clients.length === 0) return false;
  return clients.some(
    (c) =>
      Boolean(c.client_ip) &&
      c.client_ip !== "[Encrypted]" &&
      c.client_ip !== "[Decryption Failed]"
  );
}

/**
 * Checks whether domain ranking records contain readable, unencrypted domain names.
 *
 * @param domains - Array of top allowed or top blocked domain records.
 * @returns True if at least one domain is unencrypted.
 */
export function hasValidDomains(domains?: { domain: string; count: number }[]): boolean {
  if (!domains || domains.length === 0) return false;
  return domains.some(
    (d) =>
      Boolean(d.domain) &&
      d.domain !== "[Encrypted]" &&
      d.domain !== "[Decryption Failed]"
  );
}

/**
 * Inspects server analytics data to identify which fields contain plaintext records.
 *
 * @param serverAnalytics - Server analytics response object.
 * @returns Flag object detailing validity of sensitive fields.
 */
export function inspectServerAnalytics(serverAnalytics: AnalyticsData): AnalyticsValidationFlags {
  return {
    serverHasValidClients: hasValidClients(serverAnalytics.clients),
    serverHasValidTopAllowed: hasValidDomains(serverAnalytics.top_allowed),
    serverHasValidTopBlocked: hasValidDomains(serverAnalytics.top_blocked),
    serverHasDestinations: (serverAnalytics.destinations || []).length > 0
  };
}

/**
 * Merges fresh server analytics into state, falling back to previous state for any
 * fields that the server could not provide unencrypted due to zero-knowledge E2EE.
 *
 * @param serverAnalytics - Fresh analytics returned from the server API.
 * @param prev - Previous analytics state.
 * @param flags - Validation flags for server fields.
 * @returns Merged AnalyticsData object.
 */
export function mergeServerAnalytics(
  serverAnalytics: AnalyticsData,
  prev: AnalyticsData | null,
  flags: AnalyticsValidationFlags
): AnalyticsData {
  return {
    ...serverAnalytics,
    trend: serverAnalytics.trend || [],
    summary: serverAnalytics.summary || [],
    top_allowed: flags.serverHasValidTopAllowed
      ? serverAnalytics.top_allowed
      : (prev?.top_allowed?.length ? prev.top_allowed : serverAnalytics.top_allowed || []),
    top_blocked: flags.serverHasValidTopBlocked
      ? serverAnalytics.top_blocked
      : (prev?.top_blocked?.length ? prev.top_blocked : serverAnalytics.top_blocked || []),
    clients: flags.serverHasValidClients
      ? serverAnalytics.clients
      : (prev?.clients?.length ? prev.clients : serverAnalytics.clients || []),
    destinations: flags.serverHasDestinations
      ? serverAnalytics.destinations
      : (prev?.destinations && prev.destinations.length > 0 ? prev.destinations : [])
  };
}

/**
 * Injects decrypted local SQLite analytics into current state for fields where
 * the server only has encrypted blobs. Preserves authoritative server summary and trend.
 *
 * @param current - Current active analytics state.
 * @param freshLocal - Freshly computed local SQLite analytics aggregation.
 * @param flags - Validation flags representing server plaintext availability.
 * @returns Updated AnalyticsData object with decrypted local values.
 */
export function mergeLocalDecryptedAnalytics(
  current: AnalyticsData | null,
  freshLocal: AnalyticsData,
  flags: AnalyticsValidationFlags
): AnalyticsData {
  if (!current) {
    return freshLocal;
  }

  return {
    ...current,
    destinations: flags.serverHasDestinations
      ? current.destinations
      : (freshLocal.destinations.length > 0 ? freshLocal.destinations : current.destinations),
    top_allowed: flags.serverHasValidTopAllowed
      ? current.top_allowed
      : (freshLocal.top_allowed.length > 0 ? freshLocal.top_allowed : current.top_allowed),
    top_blocked: flags.serverHasValidTopBlocked
      ? current.top_blocked
      : (freshLocal.top_blocked.length > 0 ? freshLocal.top_blocked : current.top_blocked),
    clients: flags.serverHasValidClients
      ? current.clients
      : (freshLocal.clients.length > 0 ? freshLocal.clients : current.clients)
  };
}
