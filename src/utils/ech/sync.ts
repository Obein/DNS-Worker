import { D1Database } from "@cloudflare/workers-types";
import { parseCidr } from "../cidr";
import { SystemSettingsModel } from "../../models/systemSettings";
import { updateActiveCfProxyCidrs, getActiveCfProxyCidrs } from "./cloudflareIp";

let cachedActiveCfEchConfig: string | null = null;
let loadPromise: Promise<void> | null = null;

/**
 * Updates in-memory active Cloudflare ECH config template.
 *
 * @param echBase64 - Live Base64 ECHConfigList from Cloudflare.
 */
export function setActiveCfEchConfig(echBase64: string): void {
  if (echBase64 && echBase64 !== cachedActiveCfEchConfig) {
    cachedActiveCfEchConfig = echBase64;
  }
}

/**
 * Returns the currently active cached Cloudflare ECH configuration string.
 */
export function getActiveCfEchConfig(): string | null {
  return cachedActiveCfEchConfig;
}

/**
 * Persists live Cloudflare active ECH config to the system_settings table and in-memory cache.
 *
 * @param db - D1Database instance.
 * @param echBase64 - Live Base64 ECHConfigList from Cloudflare.
 */
export async function saveActiveCfEchConfig(db: D1Database, echBase64: string): Promise<void> {
  if (!echBase64) return;
  setActiveCfEchConfig(echBase64);
  try {
    const settingsModel = new SystemSettingsModel(db);
    await settingsModel.set("cf_active_ech_config", echBase64);
  } catch (e) {
    console.warn("[ECH] Could not persist active ECH config to DB:", e);
  }
}

/**
 * Ensures Cloudflare IP ranges and active ECH config are loaded into memory from the database.
 * If database does not have them yet, triggers an initial sync.
 *
 * @param db - D1Database instance.
 */
export async function ensureCloudflareIpRangesLoaded(db: D1Database): Promise<void> {
  const currentCidrs = getActiveCfProxyCidrs();
  if (currentCidrs.length > 0) {
    return;
  }
  if (!loadPromise && db) {
    loadPromise = (async () => {
      try {
        const settingsModel = new SystemSettingsModel(db);
        const [cachedCidrs, cachedEch] = await Promise.all([
          settingsModel.get("cf_proxy_cidrs"),
          settingsModel.get("cf_active_ech_config")
        ]);

        if (cachedEch) {
          cachedActiveCfEchConfig = cachedEch;
        }

        if (cachedCidrs) {
          const parsed = JSON.parse(cachedCidrs);
          if (Array.isArray(parsed) && parsed.length > 0) {
            updateActiveCfProxyCidrs(parsed);
            return;
          }
        }
        // If not in DB, sync from official endpoints
        await syncCloudflareIpRanges(db, true);
      } catch (e) {
        console.warn("[ECH] Could not load Cloudflare IP ranges from DB:", e);
      } finally {
        loadPromise = null;
      }
    })();
  }
  if (loadPromise) {
    await loadPromise;
  }
}

/**
 * Initializes active Cloudflare IP ranges from D1 system_settings on startup if available.
 *
 * @param db - D1Database instance.
 */
export async function initCloudflareIpRanges(db: D1Database): Promise<void> {
  try {
    const settingsModel = new SystemSettingsModel(db);
    const cachedJson = await settingsModel.get("cf_proxy_cidrs");
    if (cachedJson) {
      const parsed = JSON.parse(cachedJson);
      if (Array.isArray(parsed) && parsed.length >= 10) {
        updateActiveCfProxyCidrs(parsed);
      }
    }
  } catch (e) {
    console.warn("[ECH] Could not load cached Cloudflare IP ranges from DB:", e);
  }
}

/**
 * Syncs official Cloudflare IP ranges and active ECH configuration from Cloudflare.
 * Automatically persists to the system_settings table and updates active in-memory state.
 *
 * @param db - D1Database instance.
 * @param force - Force sync regardless of last update timestamp.
 * @returns Object indicating sync status and count.
 */
export async function syncCloudflareIpRanges(
  db: D1Database,
  force: boolean = false
): Promise<{ success: boolean; updated: boolean; count: number }> {
  const settingsModel = new SystemSettingsModel(db);
  const now = Math.floor(Date.now() / 1000);

  if (!force) {
    const lastUpdatedStr = await settingsModel.get("cf_proxy_cidrs_updated_at");
    if (lastUpdatedStr) {
      const lastUpdated = parseInt(lastUpdatedStr, 10);
      if (!isNaN(lastUpdated) && now - lastUpdated < 86400) {
        return { success: true, updated: false, count: getActiveCfProxyCidrs().length };
      }
    }
  }

  try {
    const [v4Res, v6Res, echRes] = await Promise.all([
      fetch("https://www.cloudflare.com/ips-v4", {
        headers: { "User-Agent": "Obex-DNS/1.0" },
        signal: AbortSignal.timeout(5000)
      }),
      fetch("https://www.cloudflare.com/ips-v6", {
        headers: { "User-Agent": "Obex-DNS/1.0" },
        signal: AbortSignal.timeout(5000)
      }),
      fetch("https://cloudflare-dns.com/dns-query?name=cloudflare-ech.com&type=HTTPS", {
        headers: { "Accept": "application/dns-json" },
        signal: AbortSignal.timeout(5000)
      }).catch(() => null)
    ]);

    if (!v4Res.ok || !v6Res.ok) {
      throw new Error(`Failed to fetch Cloudflare IPs: v4 HTTP ${v4Res.status}, v6 HTTP ${v6Res.status}`);
    }

    const v4Text = await v4Res.text();
    const v6Text = await v6Res.text();

    const rawList = [...v4Text.split("\n"), ...v6Text.split("\n")]
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"));

    const validCidrs = rawList.filter((cidr) => parseCidr(cidr) !== null);

    let fetchedEch: string | null = null;
    if (echRes && echRes.ok) {
      try {
        const echJson: any = await echRes.json();
        if (echJson.Answer) {
          for (const ans of echJson.Answer) {
            const match = String(ans.data).match(/ech=([A-Za-z0-9+/=]+)/);
            if (match) {
              fetchedEch = match[1];
              break;
            }
          }
        }
      } catch (e) {
        console.warn("[ECH] Failed to parse live Cloudflare ECH config:", e);
      }
    }

    if (validCidrs.length >= 10) {
      const updates: Record<string, string> = {
        cf_proxy_cidrs: JSON.stringify(validCidrs),
        cf_proxy_cidrs_updated_at: String(now)
      };

      if (fetchedEch) {
        updates.cf_active_ech_config = fetchedEch;
        cachedActiveCfEchConfig = fetchedEch;
      }

      await settingsModel.setMany(updates);
      updateActiveCfProxyCidrs(validCidrs);
      console.log(`[ECH] Synced ${validCidrs.length} Cloudflare IP ranges and active ECH config.`);
      return { success: true, updated: true, count: validCidrs.length };
    } else {
      throw new Error(`Received insufficient valid CIDRs: ${validCidrs.length}`);
    }
  } catch (e: any) {
    console.warn("[ECH] Cloudflare IP/ECH sync failed:", e.message || e);
    return { success: false, updated: false, count: getActiveCfProxyCidrs().length };
  }
}
