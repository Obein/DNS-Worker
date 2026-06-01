/**
 * TOTP (Time-based One-Time Password) implementation for Cloudflare Workers
 * RFC 6238 / RFC 4226 compliant, using Web Crypto API only (no Node.js dependencies)
 */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * Encodes a Uint8Array to a Base32 string.
 */
function base32Encode(bytes: Uint8Array): string {
  let result = '';
  let buffer = 0;
  let bitsLeft = 0;

  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bitsLeft += 8;
    while (bitsLeft >= 5) {
      bitsLeft -= 5;
      result += BASE32_ALPHABET[(buffer >> bitsLeft) & 0x1f];
    }
  }

  if (bitsLeft > 0) {
    result += BASE32_ALPHABET[(buffer << (5 - bitsLeft)) & 0x1f];
  }

  return result;
}

/**
 * Decodes a Base32 string to a Uint8Array.
 */
function base32Decode(input: string): Uint8Array {
  let end = input.length;
  while (end > 0 && input[end - 1] === '=') {
    end--;
  }
  const normalized = input.slice(0, end).toUpperCase();
  const bytes: number[] = [];
  let buffer = 0;
  let bitsLeft = 0;

  for (const char of normalized) {
    const val = BASE32_ALPHABET.indexOf(char);
    if (val === -1) continue; // skip invalid chars
    buffer = (buffer << 5) | val;
    bitsLeft += 5;
    if (bitsLeft >= 8) {
      bitsLeft -= 8;
      bytes.push((buffer >> bitsLeft) & 0xff);
    }
  }

  return new Uint8Array(bytes);
}

/**
 * Generates a cryptographically secure 20-byte TOTP secret encoded as Base32.
 * @returns Base32-encoded secret string (compatible with Google Authenticator)
 */
export function generateTOTPSecret(): string {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return base32Encode(bytes);
}

/**
 * Computes an HOTP value for a given counter using HMAC-SHA1.
 * @param secret - Base32-encoded shared secret
 * @param counter - 8-byte counter value
 * @returns 6-digit OTP string
 */
async function computeHOTP(secret: string, counter: number): Promise<string> {
  const keyBytes = base32Decode(secret);
  const counterBytes = new Uint8Array(8);
  // Write counter as big-endian 64-bit integer
  const view = new DataView(counterBytes.buffer);
  view.setUint32(4, counter >>> 0, false);
  view.setUint32(0, Math.floor(counter / 0x100000000) >>> 0, false);

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', cryptoKey, counterBytes);
  const hmac = new Uint8Array(signature);

  // Dynamic truncation
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return (code % 1_000_000).toString().padStart(6, '0');
}

/**
 * Verifies a TOTP token against a secret, allowing ±1 time step (30s window).
 * @param secret - Base32-encoded TOTP secret
 * @param token - 6-digit OTP string from the user
 * @returns true if the token is valid within the time window
 */
export async function verifyTOTP(secret: string, token: string): Promise<boolean> {
  if (!/^\d{6}$/.test(token)) return false;

  const timeStep = Math.floor(Date.now() / 1000 / 30);

  // Check current step and ±1 adjacent steps to tolerate clock skew
  for (const delta of [-1, 0, 1]) {
    const expected = await computeHOTP(secret, timeStep + delta);
    if (expected === token) return true;
  }

  return false;
}

/**
 * Generates an otpauth:// URI for QR code generation.
 * @param secret - Base32-encoded TOTP secret
 * @param username - Account username label
 * @param issuer - Service name displayed in the authenticator app
 * @returns otpauth:// URI string
 */
export function getTOTPUri(secret: string, username: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${username}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/**
 * Generates 8 one-time recovery keys (10 alphanumeric chars each) as plaintext.
 * These should be shown to the user ONCE and then stored hashed.
 * @returns Array of 8 plaintext recovery keys
 */
export function generateRecoveryKeys(): string[] {
  const charset = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Unambiguous characters
  const keys: string[] = [];

  for (let i = 0; i < 8; i++) {
    const bytes = new Uint8Array(10);
    crypto.getRandomValues(bytes);
    keys.push(
      Array.from(bytes)
        .map(b => charset[b % charset.length])
        .join('')
    );
  }

  return keys;
}

/**
 * Hashes a recovery key using SHA-256 for secure storage.
 * @param key - Plaintext recovery key
 * @returns Hex-encoded SHA-256 hash
 */
export async function hashRecoveryKey(key: string): Promise<string> {
  const data = new TextEncoder().encode(key.toUpperCase().trim());
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Verifies a plaintext recovery key against an array of stored hashes.
 * Returns the index of the matching key, or -1 if no match.
 * @param key - Plaintext key entered by the user
 * @param storedHashes - Array of SHA-256 hex hashes from DB
 * @returns Index of matching hash, or -1
 */
export async function findMatchingRecoveryKey(key: string, storedHashes: string[]): Promise<number> {
  const inputHash = await hashRecoveryKey(key);
  return storedHashes.findIndex(h => h === inputHash);
}
