import { D1Database } from "@cloudflare/workers-types";
import { BloomFilter, BLOOM_CHUNK_SIZE } from "../utils/bloom";

export class ProfileBloomModel {
  constructor(private db: D1Database) {}

  // ─── Active Bloom (profile_blooms) ───────────────────────────────────────
  // This table holds the last fully-completed Bloom Filter for each profile.
  // It is the authoritative source for DNS query lookups and is never in a
  // partial state — it is only updated atomically when a sync cycle completes.

  async clearProfileBlooms(profileId: string): Promise<boolean> {
    const result = await this.db.prepare("DELETE FROM profile_blooms WHERE profile_id = ?").bind(profileId).run();
    return result.success;
  }

  async upsertProfileBloom(profileId: string, bloomFilter: ArrayBuffer, now: number): Promise<boolean> {
    const uint8Array = new Uint8Array(bloomFilter);
    const statements = [];

    // Delete existing chunks to replace them entirely
    statements.push(
      this.db.prepare("DELETE FROM profile_blooms WHERE profile_id = ?").bind(profileId)
    );

    // Insert new chunks (1.5MB per chunk, <= 2MB D1 limit)
    let chunkIndex = 0;
    for (let offset = 0; offset < uint8Array.length; offset += BLOOM_CHUNK_SIZE) {
      const chunkData = uint8Array.slice(offset, offset + BLOOM_CHUNK_SIZE).buffer as ArrayBuffer;
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

  // ─── Staging Bloom (profile_blooms_staging) ───────────────────────────────
  // Used exclusively during an active sync cycle. Receives incremental domain
  // additions one list at a time. DNS queries never touch this table.
  // On cycle completion, staging is atomically promoted to the active table.

  /**
   * 初始化 staging 区域中的空白预分配 Bloom Filter，标志新同步周期开始。
   * 按 maxDomains 预分配内存（全零 bitArray），确保后续增量 add 可直接读写，
   * 不需要每次重新计算 m 和 k。
   *
   * @param profileId - Profile ID
   * @param maxDomains - 预期的总域名数量上限（用于确定 m 和 k）
   * @param falsePositiveRate - Bloom Filter 假阳性率
   * @param now - 当前 Unix 时间戳（秒）
   */
  async initializeStagingBloom(
    profileId: string,
    maxDomains: number,
    falsePositiveRate: number,
    now: number
  ): Promise<boolean> {
    const emptyBloom = BloomFilter.create(maxDomains, falsePositiveRate);
    const binary = emptyBloom.toUint8Array();
    return this.upsertStagingBloom(profileId, binary.buffer as ArrayBuffer, now);
  }

  async clearStagingBloom(profileId: string): Promise<boolean> {
    const result = await this.db.prepare("DELETE FROM profile_blooms_staging WHERE profile_id = ?").bind(profileId).run();
    return result.success;
  }

  async upsertStagingBloom(profileId: string, bloomFilter: ArrayBuffer, now: number): Promise<boolean> {
    const uint8Array = new Uint8Array(bloomFilter);
    const statements = [];

    statements.push(
      this.db.prepare("DELETE FROM profile_blooms_staging WHERE profile_id = ?").bind(profileId)
    );

    // Insert new chunks (1.5MB per chunk, <= 2MB D1 limit)
    let chunkIndex = 0;
    for (let offset = 0; offset < uint8Array.length; offset += BLOOM_CHUNK_SIZE) {
      const chunkData = uint8Array.slice(offset, offset + BLOOM_CHUNK_SIZE).buffer as ArrayBuffer;
      statements.push(
        this.db.prepare(
          "INSERT INTO profile_blooms_staging (profile_id, chunk_index, bloom_filter_chunk, updated_at) VALUES (?, ?, ?, ?)"
        ).bind(profileId, chunkIndex, chunkData, now)
      );
      chunkIndex++;
    }

    const results = await this.db.batch(statements);
    return results.every(r => r.success);
  }

  async getStagingBloom(profileId: string): Promise<ArrayBuffer | null> {
    const { results } = await this.db.prepare(
      "SELECT bloom_filter_chunk FROM profile_blooms_staging WHERE profile_id = ? ORDER BY chunk_index ASC"
    ).bind(profileId).all<{ bloom_filter_chunk: ArrayBuffer }>();

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
   * 原子性地将 staging Bloom 升级为 active Bloom（A/B 替换）。
   *
   * 操作步骤（通过 db.batch 保证原子性）：
   *   1. 删除现有 active bloom（profile_blooms）
   *   2. 从 staging 读取所有 chunk 并重新插入到 active 表
   *   3. 清空 staging 表
   *
   * 升级完成后，DNS 查询路径立即读取到完整的新 bloom，
   * 不会出现中间状态（partial bloom）。
   *
   * @param profileId - Profile ID
   * @param now - 当前 Unix 时间戳（秒）
   */
  async promoteStagingToActive(profileId: string, now: number): Promise<boolean> {
    // 1. 读取 staging 所有 chunk
    const { results: stagingChunks } = await this.db.prepare(
      "SELECT chunk_index, bloom_filter_chunk FROM profile_blooms_staging WHERE profile_id = ? ORDER BY chunk_index ASC"
    ).bind(profileId).all<{ chunk_index: number; bloom_filter_chunk: ArrayBuffer }>();

    if (!stagingChunks || stagingChunks.length === 0) {
      // staging 为空（如列表全部为空），直接清空 active
      await this.clearProfileBlooms(profileId);
      return true;
    }

    // 2. 构建批量写入语句：先删除 active，再逐 chunk 写入
    const statements = [
      this.db.prepare("DELETE FROM profile_blooms WHERE profile_id = ?").bind(profileId),
      ...stagingChunks.map(row =>
        this.db.prepare(
          "INSERT INTO profile_blooms (profile_id, chunk_index, bloom_filter_chunk, updated_at) VALUES (?, ?, ?, ?)"
        ).bind(profileId, row.chunk_index, row.bloom_filter_chunk, now)
      ),
      this.db.prepare("DELETE FROM profile_blooms_staging WHERE profile_id = ?").bind(profileId),
    ];

    const batchResults = await this.db.batch(statements);
    return batchResults.every(r => r.success);
  }
}
