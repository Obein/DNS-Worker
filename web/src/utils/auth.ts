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

export const ACCESS_KEY_REGEX = /^[a-zA-Z0-9]{6,12}$/;
export const TOTP_TOKEN_REGEX = /^\d{6}$/;
export const PROFILE_NAME_REGEX = /^[\p{L}\p{N}_ -]{1,30}$/u;
export const AP_NAME_REGEX = /^[a-zA-Z0-9_-]{1,30}$/;
