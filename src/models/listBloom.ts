import { D1Database } from "@cloudflare/workers-types";
import { BLOOM_CHUNK_SIZE } from "../utils/bloom";

/**
 * Model for managing global compiled Bloom filter chunks stored in `global_list_blooms`.
 *
 * Single Responsibility: Storage and retrieval of compiled Bloom filter binary chunks
 * keyed globally by canonical list URL rather than per-profile subscription ID.
 * Supports dual-type resolution (URL string or legacy list_id number) for seamless compatibility.
 */
export class ListBloomModel {
  constructor(private db: D1Database) {}

  /**
   * Normalizes a blocklist URL for canonical global indexing.
   */
  static normalizeUrl(url: string): string {
    return url.trim().replace(/\/+$/, "");
  }

  /**
   * Resolves a URL string or legacy list ID to a canonical URL.
   */
  private async resolveUrl(urlOrId: string | number): Promise<string | null> {
    if (typeof urlOrId === "string") {
      return ListBloomModel.normalizeUrl(urlOrId);
    }
    const row = await this.db
      .prepare("SELECT url FROM lists WHERE id = ?")
      .bind(urlOrId)
      .first<{ url: string }>();
    return row?.url ? ListBloomModel.normalizeUrl(row.url) : null;
  }

  /**
   * Upserts the compiled Bloom filter binary chunks for a given list URL or list ID.
   *
   * @param urlOrId The canonical blocklist URL string or legacy list ID number.
   * @param bloomFilter Full serialized binary ArrayBuffer of the Bloom filter.
   * @param now Current unix timestamp in seconds.
   */
  async upsertListBloom(urlOrId: string | number, bloomFilter: ArrayBuffer, now: number): Promise<boolean> {
    const canonicalUrl = await this.resolveUrl(urlOrId);
    if (!canonicalUrl) return false;

    const uint8Array = new Uint8Array(bloomFilter);
    const statements = [];

    // Ensure parent metadata row exists for foreign key integrity
    statements.push(
      this.db.prepare(
        "INSERT OR IGNORE INTO global_list_metadata (url, created_at) VALUES (?, ?)"
      ).bind(canonicalUrl, now)
    );

    // Delete existing chunks for this global list
    statements.push(
      this.db.prepare("DELETE FROM global_list_blooms WHERE url = ?").bind(canonicalUrl)
    );

    // Insert new chunks (1.5MB per chunk, well within the 2MB D1 statement boundary)
    let chunkIndex = 0;
    for (let offset = 0; offset < uint8Array.length; offset += BLOOM_CHUNK_SIZE) {
      const chunkData = uint8Array.slice(offset, offset + BLOOM_CHUNK_SIZE).buffer as ArrayBuffer;
      statements.push(
        this.db.prepare(
          "INSERT INTO global_list_blooms (url, chunk_index, bloom_filter_chunk, updated_at) VALUES (?, ?, ?, ?)"
        ).bind(canonicalUrl, chunkIndex, chunkData, now)
      );
      chunkIndex++;
    }

    const results = await this.db.batch(statements);
    return results.every(r => r.success);
  }

  /**
   * Probes whether any bloom chunk is stored for the specified list URL or list ID.
   *
   * Uses LIMIT 1 existence probe to avoid loading full binary chunks into memory.
   */
  async hasListBloom(urlOrId: string | number): Promise<boolean> {
    const canonicalUrl = await this.resolveUrl(urlOrId);
    if (!canonicalUrl) return false;

    const row = await this.db.prepare(
      "SELECT 1 AS present FROM global_list_blooms WHERE url = ? LIMIT 1"
    ).bind(canonicalUrl).first<{ present: number }>();
    return !!row;
  }

  /**
   * Retrieves and concatenates all binary chunks for a list URL or list ID into a single ArrayBuffer.
   *
   * @param urlOrId The canonical blocklist URL string or legacy list ID number.
   * @returns Concatenated ArrayBuffer or null if not found.
   */
  async getListBloom(urlOrId: string | number): Promise<ArrayBuffer | null> {
    const canonicalUrl = await this.resolveUrl(urlOrId);
    if (!canonicalUrl) return null;

    const { results } = await this.db.prepare(
      "SELECT bloom_filter_chunk FROM global_list_blooms WHERE url = ? ORDER BY chunk_index ASC"
    )
      .bind(canonicalUrl)
      .all<{ bloom_filter_chunk: ArrayBuffer }>();

    if (!results || results.length === 0) return null;

    const totalLength = results.reduce((acc, row) => {
      const len = row.bloom_filter_chunk.byteLength ?? (row.bloom_filter_chunk as any).length;
      return acc + len;
    }, 0);
    const combined = new Uint8Array(totalLength);

    let offset = 0;
    for (const row of results) {
      const chunk = new Uint8Array(row.bloom_filter_chunk);
      combined.set(chunk, offset);
      offset += chunk.length;
    }

    return combined.buffer as ArrayBuffer;
  }

  /**
   * Deletes all compiled Bloom filter chunks for the specified list URL or list ID.
   */
  async deleteListBloom(urlOrId: string | number): Promise<boolean> {
    const canonicalUrl = await this.resolveUrl(urlOrId);
    if (!canonicalUrl) return false;

    const result = await this.db.prepare(
      "DELETE FROM global_list_blooms WHERE url = ?"
    )
      .bind(canonicalUrl)
      .run();
    return result.success;
  }
}
