import { D1Database } from "@cloudflare/workers-types";

export class SystemSettingsModel {
  constructor(private db: D1Database) {}

  async getAll(): Promise<Record<string, string>> {
    const { results } = await this.db.prepare("SELECT key, value FROM system_settings").all<{key: string, value: string}>();
    const settings: Record<string, string> = {};
    for (const row of results) {
      settings[row.key] = row.value;
    }
    return settings;
  }

  async get(key: string): Promise<string | null> {
    const res = await this.db.prepare("SELECT value FROM system_settings WHERE key = ?").bind(key).first<{value: string}>();
    return res ? res.value : null;
  }

  async set(key: string, value: string): Promise<boolean> {
    const now = Math.floor(Date.now() / 1000);
    const result = await this.db.prepare(
      "INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at"
    ).bind(key, value, now).run();
    return result.success;
  }

  async setMany(settings: Record<string, string>): Promise<boolean> {
    const now = Math.floor(Date.now() / 1000);
    const stmts = Object.entries(settings).map(([key, value]) =>
      this.db.prepare("INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at").bind(key, String(value), now)
    );
    if (stmts.length > 0) {
      await this.db.batch(stmts);
    }
    return true;
  }
}
