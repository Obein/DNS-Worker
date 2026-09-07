import { D1Database } from "@cloudflare/workers-types";

interface SettingCacheEntry {
  value: string | null;
  expiresAt: number;
}

/** Global in-memory cache for system settings per Worker isolate (5-minute TTL) */
const MEMORY_CACHE = new Map<string, SettingCacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000;

export class SystemSettingsModel {
  constructor(private db: D1Database) {}

  /**
   * Clears the in-memory cache for a specific key, or all keys if none provided.
   *
   * @param key - Optional setting key to clear. If omitted, clears entire cache.
   */
  static clearMemoryCache(key?: string): void {
    if (key) {
      MEMORY_CACHE.delete(key);
    } else {
      MEMORY_CACHE.clear();
    }
  }

  /**
   * Retrieves all system settings from D1 and populates the in-memory cache.
   *
   * @returns Record containing all setting key-value pairs.
   */
  async getAll(): Promise<Record<string, string>> {
    const { results } = await this.db.prepare("SELECT key, value FROM system_settings").all<{ key: string; value: string }>();
    const settings: Record<string, string> = {};
    const expiresAt = Date.now() + CACHE_TTL_MS;
    for (const row of results) {
      settings[row.key] = row.value;
      MEMORY_CACHE.set(row.key, { value: row.value, expiresAt });
    }
    return settings;
  }

  /**
   * Retrieves a single system setting by key, using the in-memory cache when fresh.
   *
   * @param key - The setting key to look up.
   * @returns Setting value string, or null if not found.
   */
  async get(key: string): Promise<string | null> {
    const cached = MEMORY_CACHE.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    const res = await this.db.prepare("SELECT value FROM system_settings WHERE key = ?").bind(key).first<{ value: string }>();
    const val = res ? res.value : null;
    MEMORY_CACHE.set(key, { value: val, expiresAt: Date.now() + CACHE_TTL_MS });
    return val;
  }

  /**
   * Updates or inserts a single system setting in D1 and refreshes the in-memory cache.
   *
   * @param key - Setting key.
   * @param value - Setting value string.
   * @returns Boolean indicating whether the operation succeeded.
   */
  async set(key: string, value: string): Promise<boolean> {
    const now = Math.floor(Date.now() / 1000);
    const result = await this.db.prepare(
      "INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at"
    ).bind(key, value, now).run();

    if (result.success) {
      MEMORY_CACHE.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    }
    return result.success;
  }

  /**
   * Batch updates or inserts multiple system settings and refreshes the in-memory cache.
   *
   * @param settings - Key-value map of settings to persist.
   * @returns Boolean indicating whether the operation succeeded.
   */
  async setMany(settings: Record<string, string>): Promise<boolean> {
    const now = Math.floor(Date.now() / 1000);
    const stmts = Object.entries(settings).map(([key, value]) =>
      this.db.prepare("INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at").bind(key, String(value), now)
    );
    if (stmts.length > 0) {
      await this.db.batch(stmts);
    }
    const expiresAt = Date.now() + CACHE_TTL_MS;
    for (const [key, value] of Object.entries(settings)) {
      MEMORY_CACHE.set(key, { value: String(value), expiresAt });
    }
    return true;
  }
}
