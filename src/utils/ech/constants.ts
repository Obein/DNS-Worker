/**
 * Supported preset ECH Fronting (outer SNI) domains.
 */
export const PRESET_ECH_FRONTING_DOMAINS: readonly string[] = [
  "cloudflare-ech.com",
  "crypto.cloudflare.com",
  "one.one.one.one",
  "www.cloudflare.com",
  "encryptedsni.com",
  "cdnjs.com"
];

/**
 * Default preferred ECH fronting domain.
 */
export const DEFAULT_ECH_FRONTING_DOMAIN = "cloudflare-ech.com";

/**
 * Fallback Cloudflare active ECH public key & parameters (RFC draft-13 / RFC 9460).
 */
export const CLOUDFLARE_DEFAULT_ECH_BASE64 =
  "AEX+DQBBawAgACAUjjcEHSf2wlThCqPLx//d+m3qlWUe3nwuQaUVaVwQBgAEAAEAAQASY2xvdWRmbGFyZS1lY2guY29tAAA=";
