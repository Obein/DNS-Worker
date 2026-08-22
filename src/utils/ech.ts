import { D1Database } from "@cloudflare/workers-types";
import { createCidrMatcher, parseCidr } from "./cidr";
import { SystemSettingsModel } from "../models/systemSettings";

let activeCfProxyCidrs: readonly string[] = [];
let activeCfMatcher: ((ip: string) => boolean) | null = null;
let loadPromise: Promise<void> | null = null;

/**
 * Updates the in-memory Cloudflare CIDR list and recompiles the fast matcher.
 *
 * @param cidrs - Array of CIDR strings.
 */
export function updateActiveCfProxyCidrs(cidrs: readonly string[]): void {
  if (cidrs && cidrs.length > 0) {
    activeCfProxyCidrs = cidrs;
    activeCfMatcher = createCidrMatcher(activeCfProxyCidrs);
  }
}

/**
 * High-performance compiled CIDR matcher for Cloudflare CDN/Proxy edge IPs.
 *
 * @param ip - The IP address to check.
 * @returns True if the IP belongs to Cloudflare CDN/Proxy edge.
 */
export function isCloudflareIp(ip: string): boolean {
  return activeCfMatcher ? activeCfMatcher(ip) : false;
}

/**
 * Ensures Cloudflare IP ranges are loaded into memory from the database.
 * If database does not have them yet, triggers an initial sync.
 *
 * @param db - D1Database instance.
 */
export async function ensureCloudflareIpRangesLoaded(db: D1Database): Promise<void> {
  if (activeCfMatcher !== null && activeCfProxyCidrs.length > 0) {
    return;
  }
  if (!loadPromise && db) {
    loadPromise = (async () => {
      try {
        const settingsModel = new SystemSettingsModel(db);
        const cachedJson = await settingsModel.get("cf_proxy_cidrs");
        if (cachedJson) {
          const parsed = JSON.parse(cachedJson);
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
 * Syncs official Cloudflare IP ranges from https://www.cloudflare.com/ips-v4 and https://www.cloudflare.com/ips-v6.
 * Automatically persists to the system_settings table and updates the active in-memory matcher.
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
      // Skip network fetch if already updated within the last 24 hours (86,400 seconds)
      if (!isNaN(lastUpdated) && now - lastUpdated < 86400) {
        return { success: true, updated: false, count: activeCfProxyCidrs.length };
      }
    }
  }

  try {
    const [v4Res, v6Res] = await Promise.all([
      fetch("https://www.cloudflare.com/ips-v4", {
        headers: { "User-Agent": "Obex-DNS/1.0" },
        signal: AbortSignal.timeout(5000)
      }),
      fetch("https://www.cloudflare.com/ips-v6", {
        headers: { "User-Agent": "Obex-DNS/1.0" },
        signal: AbortSignal.timeout(5000)
      })
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

    // Sanity check: Ensure we received a meaningful number of CIDRs (at least 10)
    if (validCidrs.length >= 10) {
      await settingsModel.setMany({
        cf_proxy_cidrs: JSON.stringify(validCidrs),
        cf_proxy_cidrs_updated_at: String(now)
      });

      updateActiveCfProxyCidrs(validCidrs);
      console.log(`[ECH] Synced ${validCidrs.length} Cloudflare IP ranges successfully.`);
      return { success: true, updated: true, count: validCidrs.length };
    } else {
      throw new Error(`Received insufficient valid CIDRs: ${validCidrs.length}`);
    }
  } catch (e: any) {
    console.warn("[ECH] Cloudflare IP sync failed, using fallback/cached ranges:", e.message || e);
    return { success: false, updated: false, count: activeCfProxyCidrs.length };
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
 * Supported preset ECH Fronting (outer SNI) domains.
 */
export const PRESET_ECH_FRONTING_DOMAINS: readonly string[] = [
  "crypto.cloudflare.com",
  "cloudflare-ech.com",
  "one.one.one.one",
  "www.cloudflare.com",
  "encryptedsni.com",
  "cdnjs.com"
];

/**
 * Default preferred ECH fronting domain.
 */
export const DEFAULT_ECH_FRONTING_DOMAIN = "crypto.cloudflare.com";

/**
 * Cloudflare's standard public key for ECH (DHKEM X25519).
 * 32 bytes: 357a21c84e6842f798f1ef1e01bf0df802ee79411e6ca1fec16c0c3de3578050
 */
const CLOUDFLARE_ECH_PUBLIC_KEY: readonly number[] = [
  0x35, 0x7a, 0x21, 0xc8, 0x4e, 0x68, 0x42, 0xf7,
  0x98, 0xf1, 0xef, 0x1e, 0x01, 0xbf, 0x0d, 0xf8,
  0x02, 0xee, 0x79, 0x41, 0x1e, 0x6c, 0xa1, 0xfe,
  0xc1, 0x6c, 0x0c, 0x3d, 0xe3, 0x57, 0x80, 0x50
];

/**
 * Generates an RFC draft-13 ECHConfigList base64 string for Cloudflare's edge,
 * embedding the custom or preset public_name (outer SNI / ECH Fronting domain).
 *
 * @param publicName - The fronting outer domain name (defaults to "crypto.cloudflare.com").
 * @returns A base64-encoded ECHConfigList string.
 */
export function buildCloudflareEchConfig(publicName: string = DEFAULT_ECH_FRONTING_DOMAIN): string {
  const cleanName = (publicName || DEFAULT_ECH_FRONTING_DOMAIN).trim().toLowerCase();
  const nameBytes: number[] = [];
  for (let i = 0; i < cleanName.length; i++) {
    nameBytes.push(cleanName.charCodeAt(i));
  }

  // ECHConfigContents structure:
  // - config_id (uint8): 0x24
  // - kem_id (uint16): 0x0020 (DHKEM X25519)
  // - public_key (uint16 len + 32 bytes)
  // - cipher_suites (uint16 len + 4 bytes: HKDF-SHA256 0x0001, AES-128-GCM 0x0001)
  // - maximum_name_length (uint8): 0
  // - public_name (uint8 len + nameBytes)
  // - extensions (uint16 len: 0)
  const contents: number[] = [
    0x24, // config_id
    0x00, 0x20, // kem_id
    0x00, 0x20, // public_key len (32)
    ...CLOUDFLARE_ECH_PUBLIC_KEY,
    0x00, 0x04, // cipher_suites len (4)
    0x00, 0x01, 0x00, 0x01, // HKDF-SHA256 (0x0001), AES-128-GCM (0x0001)
    0x00, // maximum_name_length = 0
    nameBytes.length, // public_name len
    ...nameBytes,
    0x00, 0x00 // extensions len = 0
  ];

  // ECHConfig structure:
  // - version (uint16): 0xfe0d
  // - length (uint16): contents.length
  // - contents
  const config: number[] = [
    0xfe, 0x0d,
    (contents.length >> 8) & 0xff,
    contents.length & 0xff,
    ...contents
  ];

  // ECHConfigList structure:
  // - length (uint16): config.length
  // - config
  const list: number[] = [
    (config.length >> 8) & 0xff,
    config.length & 0xff,
    ...config
  ];

  // Encode binary list to Base64
  let binary = "";
  for (let i = 0; i < list.length; i++) {
    binary += String.fromCharCode(list[i]);
  }
  return btoa(binary);
}

/**
 * Parses an IPv6 address string into an array of 16 bytes.
 */
export function parseIPv6Bytes(ip: string): number[] {
  const bytes = new Uint8Array(16);
  if (ip.includes("::")) {
    const [left, right] = ip.split("::");
    const leftParts = left ? left.split(":").filter(Boolean) : [];
    const rightParts = right ? right.split(":").filter(Boolean) : [];

    let i = 0;
    for (const part of leftParts) {
      const v = parseInt(part, 16);
      bytes[i++] = (v >> 8) & 0xff;
      bytes[i++] = v & 0xff;
    }

    i = 16 - rightParts.length * 2;
    for (const part of rightParts) {
      const v = parseInt(part, 16);
      bytes[i++] = (v >> 8) & 0xff;
      bytes[i++] = v & 0xff;
    }
  } else {
    const parts = ip.split(":");
    let i = 0;
    for (const part of parts) {
      const v = parseInt(part, 16);
      bytes[i++] = (v >> 8) & 0xff;
      bytes[i++] = v & 0xff;
    }
  }
  return Array.from(bytes);
}

/**
 * Encodes structured HTTPS/SVCB parameters into standard RFC 9460 RDATA byte sequence.
 */
export function encodeHttpsRDataFromParams(options: {
  priority?: number;
  target?: string;
  alpn?: string[];
  ipv4hints?: string[];
  ipv6hints?: string[];
  echBase64?: string;
}): number[] {
  const {
    priority = 1,
    target = ".",
    alpn = ["h3", "h2"],
    ipv4hints = [],
    ipv6hints = [],
    echBase64 = null
  } = options;

  const bytes: number[] = [];

  // 1. Priority (uint16)
  bytes.push((priority >> 8) & 0xff, priority & 0xff);

  // 2. Target Name (wire format DNS name, 0x00 for root ".")
  if (!target || target === ".") {
    bytes.push(0x00);
  } else {
    const labels = target.split(".");
    for (const label of labels) {
      bytes.push(label.length);
      for (let i = 0; i < label.length; i++) {
        bytes.push(label.charCodeAt(i));
      }
    }
    bytes.push(0x00);
  }

  // 3. SvcParams strictly ordered by key in ascending order (RFC 9460 Section 2.2):
  // Key 1: alpn
  if (alpn && alpn.length > 0) {
    const alpnVal: number[] = [];
    for (const proto of alpn) {
      alpnVal.push(proto.length);
      for (let i = 0; i < proto.length; i++) {
        alpnVal.push(proto.charCodeAt(i));
      }
    }
    bytes.push(0x00, 0x01); // Key 1
    bytes.push((alpnVal.length >> 8) & 0xff, alpnVal.length & 0xff);
    bytes.push(...alpnVal);
  }

  // Key 4: ipv4hint
  if (ipv4hints && ipv4hints.length > 0) {
    const ipBytes: number[] = [];
    for (const ip of ipv4hints) {
      const parts = ip.split(".").map(Number);
      if (parts.length === 4 && parts.every((p) => !isNaN(p) && p >= 0 && p <= 255)) {
        ipBytes.push(...parts);
      }
    }
    if (ipBytes.length > 0) {
      bytes.push(0x00, 0x04); // Key 4
      bytes.push((ipBytes.length >> 8) & 0xff, ipBytes.length & 0xff);
      bytes.push(...ipBytes);
    }
  }

  // Key 5: ech
  if (echBase64) {
    try {
      const binaryStr = atob(echBase64);
      const echBytes: number[] = [];
      for (let i = 0; i < binaryStr.length; i++) {
        echBytes.push(binaryStr.charCodeAt(i));
      }
      bytes.push(0x00, 0x05); // Key 5
      bytes.push((echBytes.length >> 8) & 0xff, echBytes.length & 0xff);
      bytes.push(...echBytes);
    } catch (e) {
      console.error("Failed to decode base64 ech config:", e);
    }
  }

  // Key 6: ipv6hint
  if (ipv6hints && ipv6hints.length > 0) {
    const ip6Bytes: number[] = [];
    for (const ip of ipv6hints) {
      const raw16 = parseIPv6Bytes(ip);
      if (raw16 && raw16.length === 16) {
        ip6Bytes.push(...raw16);
      }
    }
    if (ip6Bytes.length > 0) {
      bytes.push(0x00, 0x06); // Key 6
      bytes.push((ip6Bytes.length >> 8) & 0xff, ip6Bytes.length & 0xff);
      bytes.push(...ip6Bytes);
    }
  }

  return bytes;
}

/**
 * Encodes a standard textual HTTPS/SVCB presentation string (e.g. "1 . alpn=h3,h2 ipv4hint=... ech=...")
 * into RFC 9460 RDATA binary bytes.
 *
 * @param value - The textual presentation string.
 * @returns Array of RDATA bytes.
 */
export function encodeHttpsRDataFromString(value: string): number[] {
  const tokens = value.trim().split(/\s+/);
  const priority = parseInt(tokens[0], 10) || 1;
  const target = tokens[1] || ".";

  let alpn: string[] | undefined;
  let ipv4hints: string[] | undefined;
  let echBase64: string | undefined;
  let ipv6hints: string[] | undefined;

  for (let i = 2; i < tokens.length; i++) {
    const token = tokens[i];
    const eqIdx = token.indexOf("=");
    if (eqIdx === -1) continue;
    const k = token.substring(0, eqIdx);
    const v = token.substring(eqIdx + 1);
    if (k === "alpn") {
      alpn = v.split(",");
    } else if (k === "ipv4hint") {
      ipv4hints = v.split(",");
    } else if (k === "ech") {
      echBase64 = v;
    } else if (k === "ipv6hint") {
      ipv6hints = v.split(",");
    }
  }

  return encodeHttpsRDataFromParams({
    priority,
    target,
    alpn,
    ipv4hints,
    ipv6hints,
    echBase64
  });
}
