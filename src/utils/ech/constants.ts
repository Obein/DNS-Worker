/**
 * Default fallback preset ECH Fronting (outer SNI) domains when not configured in env.
 */
export const DEFAULT_PRESET_ECH_FRONTING_DOMAINS: readonly string[] = [
  "cloudflare-ech.com",
  "crypto.cloudflare.com",
  "one.one.one.one",
  "www.cloudflare.com",
  "encryptedsni.com",
  "cdnjs.com"
];

/**
 * Supported preset ECH Fronting (outer SNI) domains (alias of default preset).
 * For runtime configured domains, use `getPresetEchFrontingDomains(env)`.
 */
export const PRESET_ECH_FRONTING_DOMAINS: readonly string[] = DEFAULT_PRESET_ECH_FRONTING_DOMAINS;


/**
 * Default preferred ECH fronting domain.
 */
export const DEFAULT_ECH_FRONTING_DOMAIN = "cloudflare-ech.com";

/**
 * Fallback Cloudflare active ECH public key & parameters (RFC draft-13 / RFC 9460).
 */
export const CLOUDFLARE_DEFAULT_ECH_BASE64 =
  "AEX+DQBBawAgACAUjjcEHSf2wlThCqPLx//d+m3qlWUe3nwuQaUVaVwQBgAEAAEAAQASY2xvdWRmbGFyZS1lY2guY29tAAA=";

/**
 * Hardcoded baseline Cloudflare Proxy CIDRs used as instantaneous fallback if DB is unreachable.
 */
export const DEFAULT_CF_PROXY_CIDRS: readonly string[] = [
  "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22",
  "141.101.64.0/18", "108.162.192.0/18", "190.93.240.0/20", "188.114.96.0/20",
  "197.234.240.0/22", "198.41.128.0/17", "162.158.0.0/15", "104.16.0.0/13",
  "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22", "2400:cb00::/32",
  "2606:4700::/32", "2803:f800::/32", "2405:b500::/32", "2405:8100::/32",
  "2a06:98c0::/29", "2c0f:f248::/32"
];

/**
 * Resolves preset ECH fronting domains from environment variables or falls back to default presets.
 *
 * @param env - Worker or Serverfull environment bindings.
 * @returns Array of fronting domain strings.
 */
export function getPresetEchFrontingDomains(env?: { PRESET_ECH_FRONTING_DOMAINS?: string }): string[] {
  if (env?.PRESET_ECH_FRONTING_DOMAINS) {
    try {
      const parsed = JSON.parse(env.PRESET_ECH_FRONTING_DOMAINS);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed
          .map((item: unknown) => (typeof item === "string" ? item : (item as { domain?: string })?.domain || ""))
          .filter(Boolean);
      }
    } catch (e) {
      console.warn("[ECH] Failed to parse PRESET_ECH_FRONTING_DOMAINS from env:", e);
    }
  }
  return [...DEFAULT_PRESET_ECH_FRONTING_DOMAINS];
}

