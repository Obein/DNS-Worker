import { D1Database } from "@cloudflare/workers-types";
import { BLOOM_CHUNK_SIZE } from "../utils/bloom";

export class ListBloomModel {
  constructor(private db: D1Database) {}

  async upsertListBloom(listId: number, bloomFilter: ArrayBuffer, now: number): Promise<boolean> {
    const uint8Array = new Uint8Array(bloomFilter);
    const statements = [];

    // Delete existing chunks for this list
    statements.push(
      this.db.prepare("DELETE FROM list_blooms WHERE list_id = ?").bind(listId)
    );

    // Insert new chunks (1.5MB per chunk, <= 2MB D1 limit)
    let chunkIndex = 0;
    for (let offset = 0; offset < uint8Array.length; offset += BLOOM_CHUNK_SIZE) {
      const chunkData = uint8Array.slice(offset, offset + BLOOM_CHUNK_SIZE).buffer as ArrayBuffer;
      statements.push(
        this.db.prepare(
          "INSERT INTO list_blooms (list_id, chunk_index, bloom_filter_chunk, updated_at) VALUES (?, ?, ?, ?)"
        ).bind(listId, chunkIndex, chunkData, now)
      );
      chunkIndex++;
    }

    const results = await this.db.batch(statements);
    return results.every(r => r.success);
  }

  /**
   * Whether any bloom chunk is stored for this list.
   *
   * getListBloom concatenates every chunk (~2.4MB for a 1M-domain list), which
   * is far too much work to answer a yes/no question - and doing it for several
   * lists concurrently would blow past the memory ceiling combineAndPromote
   * maintains by loading one list at a time.
   */
  async hasListBloom(listId: number): Promise<boolean> {
    const row = await this.db.prepare(
      "SELECT 1 AS present FROM list_blooms WHERE list_id = ? LIMIT 1"
    ).bind(listId).first<{ present: number }>();
    return !!row;
  }

  async getListBloom(listId: number): Promise<ArrayBuffer | null> {
    const { results } = await this.db.prepare(
      "SELECT bloom_filter_chunk FROM list_blooms WHERE list_id = ? ORDER BY chunk_index ASC"
    )
      .bind(listId)
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

  async deleteListBloom(listId: number): Promise<boolean> {
    const result = await this.db.prepare(
      "DELETE FROM list_blooms WHERE list_id = ?"
    )
      .bind(listId)
      .run();
    return result.success;
  }

  async getActiveListBloomsForProfile(profileId: string): Promise<ArrayBuffer[]> {
    const { results } = await this.db.prepare(`
      SELECT lb.list_id, lb.bloom_filter_chunk
      FROM list_blooms lb
      JOIN lists l ON lb.list_id = l.id
      WHERE l.profile_id = ? AND l.enabled = 1
      ORDER BY lb.list_id ASC, lb.chunk_index ASC
    `)
      .bind(profileId)
      .all<{ list_id: number; bloom_filter_chunk: ArrayBuffer }>();

    if (!results || results.length === 0) return [];

    // Group chunks by list_id
    const groups = new Map<number, ArrayBuffer[]>();
    for (const row of results) {
      if (!groups.has(row.list_id)) {
        groups.set(row.list_id, []);
      }
      groups.get(row.list_id)!.push(row.bloom_filter_chunk);
    }

    // Combine chunks for each list_id
    const blooms: ArrayBuffer[] = [];
    for (const [, chunks] of groups.entries()) {
      const totalLength = chunks.reduce((acc, chunk) => {
        const len = chunk.byteLength ?? (chunk as any).length;
        return acc + len;
      }, 0);
      const combined = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        const chunkArr = new Uint8Array(chunk);
        combined.set(chunkArr, offset);
        offset += chunkArr.length;
      }
      blooms.push(combined.buffer as ArrayBuffer);
    }

    return blooms;
  }
}
