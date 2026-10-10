/**
 * @file dbSize.ts
 * @description Database storage calculation and estimation utility for both Serverfull (Node.js/Bun SQLite)
 * and Serverless (Cloudflare Workers + D1) environments.
 */

import { Env } from "../types";

export interface DatabaseSizeResult {
  size_bytes: number;
  formatted: string;
  mode: "serverfull" | "serverless";
}

/**
 * Formats a byte count into a human-readable string (B, KB, MB, GB, TB).
 *
 * @param bytes - Numeric byte size.
 * @returns Formatted human-readable string (e.g., '4.25 MB').
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const val = bytes / Math.pow(1024, i);
  const formattedVal = val < 10 ? val.toFixed(2) : val < 100 ? val.toFixed(1) : val.toFixed(0);
  return `${formattedVal} ${units[i]}`;
}

/**
 * Calculates or estimates the database storage size.
 *
 * In Serverfull mode (Node.js / Bun):
 * Reads the actual physical disk size of the main SQLite database file,
 * WAL (-wal) file, and shared memory (-shm) file, falling back to
 * logical allocated page count.
 *
 * In Serverless mode (Cloudflare D1):
 * Because D1 restricts PRAGMA statements with SQLITE_AUTH, data size is computed
 * by querying existing tables (sum of bloom filter chunks, row counts multiplied by
 * average SQLite row and index overhead, plus base SQLite page header overhead).
 *
 * @param env - Worker environment containing DB and config.
 * @returns Database size in bytes, formatted string, and runtime mode.
 */
export async function getDatabaseStorageSize(env: Env): Promise<DatabaseSizeResult> {
  // 1. Serverfull mode (NodeD1Database provides getDatabaseSize)
  const dbAny = env.DB as unknown as { getDatabaseSize?: () => number };
  if (typeof dbAny?.getDatabaseSize === "function") {
    try {
      const bytes = dbAny.getDatabaseSize();
      return {
        size_bytes: bytes,
        formatted: formatBytes(bytes),
        mode: "serverfull"
      };
    } catch (err: unknown) {
      console.warn("[dbSize] Serverfull size calculation warning:", err);
    }
  }

  // 2. Serverless mode (Cloudflare D1)
  try {
    const tableQuery = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table';"
    ).all<{ name: string }>();

    const tableNames = new Set((tableQuery.results || []).map((r) => r.name));
    const tableClauses: string[] = [];

    // Binary bloom filter chunk sizes (dominant storage contributors)
    if (tableNames.has("profile_blooms")) {
      tableClauses.push("(SELECT coalesce(sum(length(bloom_filter_chunk)), 0) FROM profile_blooms)");
    }
    if (tableNames.has("list_blooms")) {
      tableClauses.push("(SELECT coalesce(sum(length(bloom_filter_chunk)), 0) FROM list_blooms)");
    }
    if (tableNames.has("profile_blooms_staging")) {
      tableClauses.push("(SELECT coalesce(sum(length(bloom_filter_chunk)), 0) FROM profile_blooms_staging)");
    }

    // High-volume tables with indexed storage overhead
    if (tableNames.has("logs")) {
      tableClauses.push("(SELECT count(*) * 512 FROM logs)");
    }
    if (tableNames.has("user_activity_log")) {
      tableClauses.push("(SELECT count(*) * 256 FROM user_activity_log)");
    }
    if (tableNames.has("domain_hourly_rollups")) {
      tableClauses.push("(SELECT count(*) * 128 FROM domain_hourly_rollups)");
    }

    // Configuration and security tables
    if (tableNames.has("rules")) {
      tableClauses.push("(SELECT count(*) * 256 FROM rules)");
    }
    if (tableNames.has("lists")) {
      tableClauses.push("(SELECT count(*) * 512 FROM lists)");
    }
    if (tableNames.has("users")) {
      tableClauses.push("(SELECT count(*) * 1024 FROM users)");
    }
    if (tableNames.has("profiles")) {
      tableClauses.push("(SELECT count(*) * 512 FROM profiles)");
    }
    if (tableNames.has("access_points")) {
      tableClauses.push("(SELECT count(*) * 256 FROM access_points)");
    }
    if (tableNames.has("sessions")) {
      tableClauses.push("(SELECT count(*) * 256 FROM sessions)");
    }
    if (tableNames.has("passkeys")) {
      tableClauses.push("(SELECT count(*) * 512 FROM passkeys)");
    }
    if (tableNames.has("kem_keys")) {
      tableClauses.push("(SELECT count(*) * 1024 FROM kem_keys)");
    }

    let totalBytes = 65536; // 64 KB base SQLite schema & page header overhead
    if (tableClauses.length > 0) {
      const sql = `SELECT (${tableClauses.join(" + ")} + 65536) AS size_bytes;`;
      const res = await env.DB.prepare(sql).first<{ size_bytes: number }>();
      if (res?.size_bytes !== undefined && res.size_bytes !== null) {
        totalBytes = Math.max(65536, Number(res.size_bytes));
      }
    }

    return {
      size_bytes: totalBytes,
      formatted: formatBytes(totalBytes),
      mode: "serverless"
    };
  } catch (err: unknown) {
    console.warn("[dbSize] Serverless D1 size calculation warning:", err);
    return {
      size_bytes: 65536,
      formatted: formatBytes(65536),
      mode: "serverless"
    };
  }
}
