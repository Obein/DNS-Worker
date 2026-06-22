declare global {
  interface Window {
    onloadTurnstileCallback: () => void;
    turnstile: any;
  }
}

/**
 * Username validation regular expression.
 * Requirements: 5-15 alphanumeric characters only.
 */
export const USERNAME_REGEX = /^[a-z_][a-z0-9_-]{4,31}$/;

/**
 * Password validation regular expression.
 * Requirements: 12-100 characters containing letters, numbers, and special characters.
 */
export const PASSWORD_REGEX = /^[a-zA-Z\d~`!@#$%^&*()_\-+={[}\]|\\:;"'<,>.?\/]{12,100}$/;

/**
 * Validates whether a username matches the required alphanumeric 5-15 character format.
 *
 * @param username - The username to validate.
 * @returns True if valid.
 */
export function validateUsername(username: string): boolean {
  return USERNAME_REGEX.test(username);
}

/**
 * Validates whether a password matches the required alphanumeric 12+ character format.
 *
 * @param password - The password to validate.
 * @returns True if valid.
 */
export function validatePassword(password: string): boolean {
  return PASSWORD_REGEX.test(password);
}

/**
 * Checks if a response or its text content indicates a password breach/leak
 * (either returned explicitly from backend API or caught/blocked by custom WAF rules).
 *
 * @param res - The fetch Response object.
 * @param bodyText - The raw response body text.
 * @returns True if a password leak warning is detected.
 */
export function isPasswordLeaked(res: Response, bodyText: string): boolean {
  return bodyText === "password_leaked" || 
    (res.status === 403 && (
      bodyText.toLowerCase().includes("ray id") || 
      bodyText.includes("blocked") || 
      bodyText.includes("security service")
    ));
}

/**
 * Dynamically injects the Cloudflare Turnstile verification script into the document head.
 * Ensures the callback is registered and the script is loaded only once.
 *
 * @param onLoad - Callback function to invoke when Turnstile SDK is loaded and ready.
 */
export function loadTurnstileScript(onLoad: () => void): void {
  if (window.turnstile) {
    onLoad();
    return;
  }
  window.onloadTurnstileCallback = onLoad;
  if (!document.querySelector('script[src*="turnstile/v0/api.js"]')) {
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=onloadTurnstileCallback";
    script.async = true;
    script.defer = true;
    const nonce = (window as any).OBEX_CONFIG?.nonce;
    if (nonce) {
      script.nonce = nonce;
    }
    document.head.appendChild(script);
  }
}

/**
 * Hashes a TOTP token code with a given UUID salt using SHA-256 for secure transport.
 *
 * @param token - The 6-digit TOTP token.
 * @param salt - The random UUID salt.
 * @returns Hex-encoded SHA-256 hash string.
 */
export async function hashTotpToken(token: string, salt: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(token + salt);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Hashes a password on the client side using PBKDF2 with SHA-256 (600,000 iterations).
 *
 * @param password - The raw password.
 * @param salt - The salt (usually the username, lowercase).
 * @param iterations - The number of iterations (default 600000).
 * @returns Hex-encoded client hash string (length 64, >= 256 bits).
 */
export async function hashPasswordClient(password: string, salt: string, iterations: number = 600000): Promise<string> {
  const encoder = new TextEncoder();
  const passwordBuffer = encoder.encode(password);
  const saltBuffer = encoder.encode(salt.toLowerCase());

  const baseKey = await crypto.subtle.importKey(
    "raw",
    passwordBuffer,
    "PBKDF2",
    false,
    ["deriveBits", "deriveKey"]
  );

  const hashBuffer = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: saltBuffer,
      iterations: iterations,
      hash: "SHA-256"
    },
    baseKey,
    256
  );

  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export const ACCESS_KEY_REGEX = /^[a-zA-Z0-9]{6,12}$/;
export const TOTP_TOKEN_REGEX = /^\d{6}$/;
export const PROFILE_NAME_REGEX = /^[\p{L}\p{N}_ -]{1,30}$/u;
export const AP_NAME_REGEX = /^[a-zA-Z0-9_-]{1,30}$/;

/**
 * Converts a hexadecimal string to a Uint8Array.
 */
export function hexToUint8Array(hexString: string): Uint8Array {
  const bytes = new Uint8Array(hexString.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hexString.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Derives the stored hash from the client hash using PBKDF2 with 100,000 iterations.
 * This matches the backend hashPassword(clientHash, 2) implementation.
 */
export async function deriveStoredHashClient(clientHash: string, saltHex: string): Promise<string> {
  const encoder = new TextEncoder();
  const passwordBuffer = encoder.encode(clientHash);
  const salt = hexToUint8Array(saltHex);

  const baseKey = await crypto.subtle.importKey(
    "raw",
    passwordBuffer,
    "PBKDF2",
    false,
    ["deriveBits", "deriveKey"]
  );

  const hashBuffer = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: salt as any,
      iterations: 100000,
      hash: "SHA-256"
    },
    baseKey,
    256
  );

  const combined = new Uint8Array(salt.length + hashBuffer.byteLength);
  combined.set(salt);
  combined.set(new Uint8Array(hashBuffer), salt.length);

  return btoa(String.fromCharCode(...combined));
}

/**
 * Computes the HMAC-SHA256 signature of the given data using the specified key.
 * Returns a hex-encoded signature.
 */
export async function hmacSha256(key: string, data: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyBuffer = encoder.encode(key);
  const dataBuffer = encoder.encode(data);

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
 * Computes the PBKDF2 client hash of a 4-digit PIN for session locking,
 * reusing the client-side password hashing scheme (600,000 iterations).
 */
export async function hashPin(pin: string, salt: string): Promise<string> {
  return hashPasswordClient(pin, salt);
}
