/**
 * Low-level PBKDF2 key derivation using Web Crypto API.
 * Single responsibility: performing the raw cryptographic derivation.
 */
export async function pbkdf2(
  data: string,
  salt: Uint8Array,
  iterations: number,
  keyLength: number = 256
): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(data);

  const baseKey = await crypto.subtle.importKey(
    "raw",
    dataBuffer,
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const hashBuffer = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: salt,
      iterations: iterations,
      hash: "SHA-256"
    },
    baseKey,
    keyLength
  );

  return new Uint8Array(hashBuffer);
}

/**
 * Hashes a password/string using PBKDF2 and formats the result as a hex string.
 * @param data - The data to hash.
 * @param salt - The optional salt. If not provided, a random 16-byte salt is generated.
 * @param iterations - The number of iterations (default 100,000).
 * @param keyLength - The derived key length in bits (default 256).
 */
export async function hashWithPBKDF2(
  data: string,
  salt?: Uint8Array,
  iterations: number = 100000,
  keyLength: number = 256
): Promise<string> {
  const actualSalt = salt ?? crypto.getRandomValues(new Uint8Array(16));
  const derived = await pbkdf2(data, actualSalt, iterations, keyLength);

  return Array.from(derived)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Simple PBKDF2 implementation using Web Crypto API for Cloudflare Workers
 * - Uses SHA-256 with 100,000 iterations for password hashing (configurable)
 * - Generates a random 16-byte salt for each password
 * - Stores the salt and hash together in a base64-encoded string
 * - Provides functions for hashing and verifying passwords
 *
 * Note: In a production environment, consider using a well-established library like bcrypt or argon2. 
 * @param password - The plaintext password to hash.
 * @param version - The hashing version to use (default 1). Version 2 uses fewer iterations for faster hashing.
 * @returns A base64-encoded string containing the salt and hash for storage.
 */
export async function hashPassword(
  password: string,
  version: number = 1
): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iterations = version === 2 ? 100000 : 100000;
  
  const derived = await pbkdf2(password, salt, iterations, 256);
  
  const combinedBytes = new Uint8Array(salt.length + derived.length);
  combinedBytes.set(salt);
  combinedBytes.set(derived, salt.length);
  return btoa(String.fromCharCode(...combinedBytes));
}

export async function verifyPassword(password: string, storedHash: string, version: number = 1): Promise<boolean> {
  // Decode the stored hash
  const combined = new Uint8Array(
    atob(storedHash)
      .split("")
      .map((c) => c.charCodeAt(0))
  );
  
  const salt = combined.slice(0, 16);
  const originalHash = combined.slice(16);
  
  const iterations = version === 2 ? 100000 : 100000;
  
  const testHashArray = await pbkdf2(password, salt, iterations, 256);
  
  if (testHashArray.length !== originalHash.length) return false;
  
  // Constant-time comparison
  let result = 0;
  for (let i = 0; i < testHashArray.length; i++) {
    result |= testHashArray[i] ^ originalHash[i];
  }
  return result === 0;
}

/**
 * Standard z-base-32 alphabet (Tahoe-LAFS human-oriented base-32 encoding).
 * 32 characters designed for high legibility and reduced transcription errors:
 * excludes 0, l, v, 2 to avoid visual ambiguity.
 */
export const ZBASE32_ALPHABET: string = "ybndrfg8ejkmcpqxot1uwisza345h769";

/**
 * Generates a cryptographically secure random token of the specified length
 * using the z-base-32 character set, derived directly from binary randomness.
 *
 * Each character is sampled from a cryptographically secure random byte via
 * `crypto.getRandomValues`. Because 256 is an exact integer multiple of 32 (256 % 32 === 0),
 * masking each byte with `0x1f` (31) partitions the 256 possible byte values into 32
 * equally probable buckets (8 byte values per character), guaranteeing zero modulo bias
 * and uniform entropy.
 *
 * @param length - Number of characters to generate (defaults to 5).
 * @returns A string of z-base-32 encoded characters.
 */
export function generateZBase32Token(length: number = 5): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let token = "";
  for (let i = 0; i < length; i++) {
    token += ZBASE32_ALPHABET[bytes[i] & 0x1f];
  }
  return token;
}

/**
 * Generates a secure random ID of the specified length.
 */
export function generateId(length: number): string {
  const byteLength = Math.ceil(length / 2);
  const bytes = new Uint8Array(byteLength);
  
  crypto.getRandomValues(bytes);
  
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, length);
}

/**
 * Extracts the 16-byte salt from the stored base64 hash and returns it as a hex string.
 */
export function extractSaltHex(storedHash: string): string {
  const combined = new Uint8Array(
    atob(storedHash)
      .split("")
      .map((c) => c.charCodeAt(0))
  );
  const salt = combined.slice(0, 16);
  return Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Computes the HMAC-SHA256 signature of the given data using the specified key.
 * Key and data can be strings (UTF-8) or Uint8Arrays. Returns a hex-encoded signature.
 */
export async function hmacSha256(key: string | Uint8Array, data: string | Uint8Array): Promise<string> {
  const encoder = new TextEncoder();
  const keyBuffer = typeof key === "string" ? encoder.encode(key) : key;
  const dataBuffer = typeof data === "string" ? encoder.encode(data) : data;

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign("HMAC", cryptoKey, dataBuffer);
  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Hashes the PIN using PBKDF2 with 600,000 iterations.
 * This is equivalent to the client-side hashPin/hashPasswordClient.
 */
export async function hashPin(pin: string, salt: string): Promise<string> {
  const saltBytes = new TextEncoder().encode(salt.toLowerCase());
  const derived = await pbkdf2(pin, saltBytes, 600000, 256);
  return Array.from(derived)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Hashes the session ID using PBKDF2-HMAC-SHA256 with the user ID as a fixed salt.
 * Uses 100 iterations for deterministic hashing.
 * Returns a 64-character hex string.
 */
export async function generateSessionHash(sessionId: string, userId: string): Promise<string> {
  const salt = new TextEncoder().encode(userId);
  return hashWithPBKDF2(sessionId, salt, 100, 256);
}

/**
 * Hashes the client pinHash with a nonce challenge.
 * Uses 10,000 iterations to be fully compatible with Cloudflare Workers limits.
 */
export async function hashChallenge(pinHash: string, nonce: string): Promise<string> {
  const saltBytes = new TextEncoder().encode(nonce.toLowerCase());
  const derived = await pbkdf2(pinHash, saltBytes, 10000, 256);
  return Array.from(derived)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
