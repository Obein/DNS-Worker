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

