/**
 * @file recovery.ts
 * @description Key Encryption Key (KEK) derivation from plaintext recovery key via PBKDF2-HMAC-SHA256.
 */

/**
 * Derives a 256-bit Key Encryption Key (KEK) from a normalized plaintext Recovery Key using PBKDF2-HMAC-SHA256.
 *
 * @param plaintextRecoveryKey - Plaintext 30-digit or raw recovery key
 * @param salt - 16-byte random salt
 * @returns CryptoKey for AES-GCM
 */
export async function deriveRecoveryKek(
  plaintextRecoveryKey: string,
  salt: Uint8Array
): Promise<CryptoKey> {
  const subtle = crypto.subtle;
  const normalized = plaintextRecoveryKey.replace(/[-\s]/g, "").toUpperCase().trim();
  const data = new TextEncoder().encode(normalized);

  const baseKey = await subtle.importKey(
    "raw",
    data,
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );

  return subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt as BufferSource,
      iterations: 100000,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}
