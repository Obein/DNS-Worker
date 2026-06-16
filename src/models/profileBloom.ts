import { D1Database } from "@cloudflare/workers-types";

export class ProfileBloomModel {
  constructor(private db: D1Database) {}

  async clearProfileBlooms(profileId: string): Promise<boolean> {
    const result = await this.db.prepare("DELETE FROM profile_blooms WHERE profile_id = ?").bind(profileId).run();
    return result.success;
  }

  async upsertProfileBloom(profileId: string, bloomFilter: ArrayBuffer, now: number): Promise<boolean> {
    const CHUNK_SIZE = 512 * 1024; // 512KB per chunk
    const uint8Array = new Uint8Array(bloomFilter);
    const statements = [];
    
    // Delete existing chunks to replace them entirely
    statements.push(
      this.db.prepare("DELETE FROM profile_blooms WHERE profile_id = ?").bind(profileId)
    );

    // Insert new chunks
    let chunkIndex = 0;
    for (let offset = 0; offset < uint8Array.length; offset += CHUNK_SIZE) {
      // Use slice() to create a copy of the chunk, ensuring a clean ArrayBuffer of the exact size
      const chunkData = uint8Array.slice(offset, offset + CHUNK_SIZE).buffer as ArrayBuffer;
      statements.push(
        this.db.prepare(
          "INSERT INTO profile_blooms (profile_id, chunk_index, bloom_filter_chunk, updated_at) VALUES (?, ?, ?, ?)"
        ).bind(profileId, chunkIndex, chunkData, now)
      );
      chunkIndex++;
    }

    const results = await this.db.batch(statements);
    return results.every(r => r.success);
  }

  async getProfileBloom(profileId: string): Promise<ArrayBuffer | null> {
    const { results } = await this.db.prepare(
      "SELECT bloom_filter_chunk FROM profile_blooms WHERE profile_id = ? ORDER BY chunk_index ASC"
    ).bind(profileId).all<{ bloom_filter_chunk: ArrayBuffer }>();

    if (!results || results.length === 0) return null;

    // Calculate total length
    const totalLength = results.reduce((acc, row) => {
      const len = row.bloom_filter_chunk.byteLength ?? (row.bloom_filter_chunk as any).length;
      return acc + len;
    }, 0);
    const combined = new Uint8Array(totalLength);

    // Reconstruct the array buffer
    let offset = 0;
    for (const row of results) {
      // new Uint8Array accepts both ArrayBuffer and Array<number>
      const chunk = new Uint8Array(row.bloom_filter_chunk);
      combined.set(chunk, offset);
      offset += chunk.length;
    }

    return combined.buffer as ArrayBuffer;
  }
}
