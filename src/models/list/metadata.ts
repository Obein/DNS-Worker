import { D1Database } from "@cloudflare/workers-types";
import { GlobalListMetadataRecord } from "./types";
import { normalizeListUrl, parseUnixTimestamp } from "./utils";

/**
 * ListMetadataModel manages centralized metadata for filter lists in `global_list_metadata`,
 * providing cache validation parameters (ETag, Last-Modified) and cross-profile
 * subscription indexing for edge compilation.
 */
export class ListMetadataModel {
  constructor(private readonly db: D1Database) {}

  /**
   * Retrieves global metadata for a given canonical blocklist URL.
   * Ensures last_modified is returned as an integer Unix timestamp in seconds.
   *
   * @param url - Blocklist URL.
   * @returns GlobalListMetadataRecord or null.
   */
  async getGlobalListMetadata(url: string): Promise<GlobalListMetadataRecord | null> {
    const canonicalUrl = normalizeListUrl(url);
    const row = await this.db
      .prepare("SELECT * FROM global_list_metadata WHERE url = ?")
      .bind(canonicalUrl)
      .first<{
        url: string;
        etag: string | null;
        last_modified: number | string | null;
        last_synced_at: number | null;
        sync_error: string | null;
      }>();
    if (!row) return null;

    return {
      url: row.url,
      etag: row.etag,
      last_modified: parseUnixTimestamp(row.last_modified),
      last_synced_at: row.last_synced_at,
      sync_error: row.sync_error,
    };
  }

  /**
   * Upserts global metadata for a given canonical blocklist URL.
   * Strictly normalizes lastModified to an integer Unix timestamp in seconds.
   *
   * @param url - Blocklist URL.
   * @param now - Sync timestamp in seconds.
   * @param etag - Optional ETag header.
   * @param lastModified - Optional Last-Modified header.
   * @param syncError - Optional sync error text.
   * @returns Boolean indicating success.
   */
  async updateGlobalListMetadata(
    url: string,
    now: number,
    etag?: string | null,
    lastModified?: number | string | null,
    syncError: string | null = null
  ): Promise<boolean> {
    const canonicalUrl = normalizeListUrl(url);
    const normalizedLastModified = parseUnixTimestamp(lastModified);

    const result = await this.db
      .prepare(
        `INSERT INTO global_list_metadata (url, etag, last_modified, last_synced_at, sync_error, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(url) DO UPDATE SET
           etag = COALESCE(excluded.etag, global_list_metadata.etag),
           last_modified = COALESCE(excluded.last_modified, global_list_metadata.last_modified),
           last_synced_at = excluded.last_synced_at,
           sync_error = excluded.sync_error`
      )
      .bind(
        canonicalUrl,
        etag || null,
        normalizedLastModified,
        now,
        syncError || null,
        now
      )
      .run();
    return result.success;
  }

  /**
   * Returns distinct active URLs across all profiles and users that need synchronization.
   *
   * @param cutoffTime - Optional timestamp threshold; lists synced before this are returned.
   * @param limit - Maximum number of URLs to return (default: 10).
   * @returns Array of unique canonical URLs.
   */
  async getDistinctActiveUrls(cutoffTime?: number, limit = 10): Promise<string[]> {
    let query = `
      SELECT DISTINCT active_urls.url
      FROM (
        SELECT url FROM lists WHERE enabled = 1
        UNION
        SELECT url FROM user_lists WHERE enabled = 1
      ) active_urls
      LEFT JOIN global_list_metadata gm ON active_urls.url = gm.url
    `;
    const params: (number | null)[] = [];
    if (cutoffTime !== undefined) {
      query += ` WHERE (gm.last_synced_at IS NULL OR gm.last_synced_at < ?)`;
      params.push(cutoffTime);
    }
    query += ` ORDER BY COALESCE(gm.last_synced_at, 0) ASC LIMIT ?`;
    params.push(limit);

    const { results } = await this.db.prepare(query).bind(...params).all<{ url: string }>();
    return (results || []).map((r) => r.url);
  }

  /**
   * Retrieves all profile IDs that subscribe to a given list URL and have it enabled
   * (both directly via lists and inherited via user_lists).
   *
   * @param url - Filter list URL.
   * @returns Array of unique profile IDs.
   */
  async getProfilesSubscribingToUrl(url: string): Promise<string[]> {
    const canonicalUrl = normalizeListUrl(url);

    // 1. Direct profile lists
    const { results: r1 } = await this.db
      .prepare("SELECT DISTINCT profile_id FROM lists WHERE url = ? AND enabled = 1")
      .bind(canonicalUrl)
      .all<{ profile_id: string }>();

    // 2. User lists effective for profiles
    const { results: r2 } = await this.db
      .prepare(
        `SELECT DISTINCT p.id AS profile_id
        FROM profiles p
        JOIN user_lists ul ON ul.user_id = p.owner_id
        LEFT JOIN profile_user_list_overrides pulo 
          ON pulo.user_list_id = ul.id AND pulo.profile_id = p.id
        WHERE ul.url = ? 
          AND COALESCE(pulo.enabled, ul.enabled) = 1`
      )
      .bind(canonicalUrl)
      .all<{ profile_id: string }>();

    const set = new Set<string>();
    for (const row of r1 || []) set.add(row.profile_id);
    for (const row of r2 || []) set.add(row.profile_id);
    return Array.from(set);
  }
}
