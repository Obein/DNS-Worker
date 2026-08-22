import { DEFAULT_ECH_FRONTING_DOMAIN, CLOUDFLARE_DEFAULT_ECH_BASE64 } from "./constants";

/**
 * Rebuilds an existing RFC draft-13 ECHConfigList by replacing its public_name (outer SNI)
 * with the specified fronting domain, keeping Cloudflare's exact public key, config_id, and cipher suites.
 *
 * @param rawBase64 - Existing Base64 ECHConfigList from Cloudflare.
 * @param newFrontingDomain - Target fronting domain (e.g. "crypto.cloudflare.com").
 * @returns Base64 string of the updated ECHConfigList.
 */
export function rebuildEchWithFronting(
  rawBase64: string,
  newFrontingDomain: string = DEFAULT_ECH_FRONTING_DOMAIN
): string {
  try {
    const binary = atob(rawBase64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    if (bytes.length < 16) return rawBase64;

    // uint16 list_len: bytes[0..1]
    // uint16 version: bytes[2..3] (0xfe0d)
    const version = (bytes[2] << 8) | bytes[3];
    if (version !== 0xfe0d) return rawBase64;

    // ECHConfigContents:
    // uint8 config_id: bytes[6]
    // uint16 kem_id: bytes[7..8]
    // uint16 pk_len: bytes[9..10]
    const configId = bytes[6];
    const kemId = (bytes[7] << 8) | bytes[8];
    const pkLen = (bytes[9] << 8) | bytes[10];
    const pkStart = 11;
    const pkEnd = pkStart + pkLen;
    if (pkEnd > bytes.length) return rawBase64;
    const publicKey = bytes.slice(pkStart, pkEnd);

    let offset = pkEnd;
    const csLen = (bytes[offset] << 8) | bytes[offset + 1];
    offset += 2;
    const cipherSuites = bytes.slice(offset, offset + csLen);
    offset += csLen;

    const maxNameLen = bytes[offset++];
    const oldNameLen = bytes[offset++];
    offset += oldNameLen;

    const extLen = (bytes[offset] << 8) | bytes[offset + 1];
    offset += 2;
    const extensions = bytes.slice(offset, offset + extLen);

    const targetName = (newFrontingDomain || DEFAULT_ECH_FRONTING_DOMAIN).trim().toLowerCase();
    const nameBytes = new Uint8Array(targetName.length);
    for (let i = 0; i < targetName.length; i++) {
      nameBytes[i] = targetName.charCodeAt(i);
    }

    // Assemble new ECHConfigContents
    const contents: number[] = [
      configId,
      (kemId >> 8) & 0xff,
      kemId & 0xff,
      (pkLen >> 8) & 0xff,
      pkLen & 0xff,
      ...Array.from(publicKey),
      (csLen >> 8) & 0xff,
      csLen & 0xff,
      ...Array.from(cipherSuites),
      maxNameLen,
      nameBytes.length,
      ...Array.from(nameBytes),
      (extLen >> 8) & 0xff,
      extLen & 0xff,
      ...Array.from(extensions)
    ];

    // ECHConfig
    const config: number[] = [
      0xfe,
      0x0d,
      (contents.length >> 8) & 0xff,
      contents.length & 0xff,
      ...contents
    ];

    // ECHConfigList
    const list: number[] = [
      (config.length >> 8) & 0xff,
      config.length & 0xff,
      ...config
    ];

    let resultBinary = "";
    for (let i = 0; i < list.length; i++) {
      resultBinary += String.fromCharCode(list[i]);
    }
    return btoa(resultBinary);
  } catch (e) {
    console.error("Failed to rebuild ECH with fronting domain:", e);
    return rawBase64;
  }
}

/**
 * Generates an RFC draft-13 ECHConfigList base64 string for Cloudflare's edge,
 * embedding the custom or preset public_name (outer SNI / ECH Fronting domain).
 *
 * @param publicName - The fronting outer domain name (defaults to "crypto.cloudflare.com").
 * @param sourceEchBase64 - Optional raw ECH template from Cloudflare upstream.
 * @returns A base64-encoded ECHConfigList string.
 */
export function buildCloudflareEchConfig(
  publicName: string = DEFAULT_ECH_FRONTING_DOMAIN,
  sourceEchBase64?: string
): string {
  const base = sourceEchBase64 || CLOUDFLARE_DEFAULT_ECH_BASE64;
  return rebuildEchWithFronting(base, publicName);
}
