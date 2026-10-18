/**
 * @file base64.ts
 * @description Universal cross-platform Base64 encoder and decoder.
 * Supports Web Workers, Cloudflare Workers, Node.js, and browser runtimes.
 */

/**
 * Universal base64 encoder supporting Web Workers, Cloudflare Workers, Node.js, and Browsers.
 */
export function toBase64(bytes: Uint8Array | ArrayBuffer): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (typeof Buffer !== "undefined") {
    return Buffer.from(u8).toString("base64");
  }
  let binary = "";
  for (let i = 0; i < u8.length; i++) {
    binary += String.fromCharCode(u8[i]);
  }
  return btoa(binary);
}

/**
 * Universal base64 decoder supporting Web Workers, Cloudflare Workers, Node.js, and Browsers.
 */
export function fromBase64(base64: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(base64, "base64"));
  }
  const binary = atob(base64);
  const u8 = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    u8[i] = binary.charCodeAt(i);
  }
  return u8;
}
