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
 * Access key validation regular expression.
 * Requirements: 6-12 alphanumeric characters only.
 */
export const ACCESS_KEY_REGEX = /^[a-zA-Z0-9]{6,12}$/;
/**
 * TOTP token validation regular expression.
 * Requirements: exactly 6 digits.
 */
export const TOTP_TOKEN_REGEX = /^\d{6}$/;
/**
 * Profile name validation regular expression.
 * Requirements: 1-30 characters, allowing letters, numbers, spaces, underscores, and hyphens.
 */
export const PROFILE_NAME_REGEX = /^[\p{L}\p{N}_ -]{1,30}$/u;
/**
 * Access Point (AP) name validation regular expression.
 * Requirements: 1-30 characters, allowing letters, numbers, underscores, and hyphens.
 */
export const AP_NAME_REGEX = /^[a-zA-Z0-9_-]{1,30}$/;
/**
 * PIN validation regular expression.
 * Requirements: exactly 4 digits.
 */
export const PIN_REGEX = /^\d{4}$/;

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
  if (bodyText === "password_leaked") return true;
  if (res.status === 403 && (bodyText.includes("password_leaked") || bodyText.includes("password breached"))) {
    return true;
  }
  return false;
}

export interface CloudflareErrorInfo {
  isCf: boolean;
  isHtml: boolean;
  errorCode: string | null;
  errorDesc: string | null;
  rayId: string | null;
}

/**
 * Detects and parses Cloudflare error pages or HTML error responses.
 */
export function parseCloudflareError(bodyText?: string | null): CloudflareErrorInfo | null {
  if (!bodyText || typeof bodyText !== "string") return null;

  const trimmed = bodyText.trim();
  const isHtml = trimmed.startsWith("<!DOCTYPE") || trimmed.startsWith("<html") || /<[a-z][\s\S]*>/i.test(trimmed);
  const isCf = trimmed.includes("cf-error-details") || 
               trimmed.includes("cf-wrapper") || 
               trimmed.includes("cf.errors.css") || 
               trimmed.includes("Cloudflare Ray ID") || 
               /Worker threw exception/i.test(trimmed);

  if (!isHtml && !isCf) return null;

  // Extract Code (e.g. 1101, 1020, 520, etc.)
  const codeMatch = trimmed.match(/class=["']cf-error-code["'][^>]*>([^<]+)</i) || 
                    trimmed.match(/Error\s+([0-9]{3,4})/i);
  const errorCode = codeMatch ? codeMatch[1].trim() : null;

  // Extract Description / Headline
  const descMatch = trimmed.match(/data-translate=["']error_desc["'][^>]*>([^<]+)</i) ||
                    trimmed.match(/class=["']cf-subheadline["'][^>]*>([^<]+)</i) ||
                    trimmed.match(/<title>([^<|]+)/i);
  const errorDesc = descMatch ? descMatch[1].trim() : null;

  // Extract Ray ID
  const rayMatch = trimmed.match(/Ray ID:\s*<strong[^>]*>([a-f0-9]+)<\/strong>/i) ||
                   trimmed.match(/Ray ID:\s*([a-f0-9]+)/i) ||
                   trimmed.match(/Cloudflare Ray ID:\s*<strong[^>]*>([a-f0-9]+)<\/strong>/i);
  const rayId = rayMatch ? rayMatch[1].trim() : null;

  return {
    isCf,
    isHtml,
    errorCode,
    errorDesc,
    rayId
  };
}

/**
 * Formats API errors into concise, user-friendly messages.
 * Automatically intercepts Cloudflare error pages and converts them to 1-2 sentence prompts.
 */
export function formatApiErrorMessage(err: any, t: (key: string, options?: any) => string): string {
  if (!err) return t("auth.authFailed", "Authentication failed");

  const bodyText = typeof err === "string" ? err : err.bodyText || err.message || "";
  const cfError = parseCloudflareError(bodyText);

  if (cfError) {
    const rayIdSuffix = cfError.rayId ? ` (Ray ID: ${cfError.rayId})` : "";
    if (cfError.errorCode && cfError.errorDesc) {
      return t("auth.cfErrorWithDetails", {
        defaultValue: `Cloudflare 边缘节点异常 (错误代码 ${cfError.errorCode}: ${cfError.errorDesc})。服务暂时不可用，请稍后重试。${rayIdSuffix}`,
        code: cfError.errorCode,
        desc: cfError.errorDesc,
        rayId: rayIdSuffix
      });
    }
    if (cfError.errorCode) {
      return t("auth.cfErrorCodeOnly", {
        defaultValue: `Cloudflare 边缘服务异常 (错误代码 ${cfError.errorCode})。服务暂时不可用，请稍后重试。${rayIdSuffix}`,
        code: cfError.errorCode,
        rayId: rayIdSuffix
      });
    }
    if (cfError.isCf) {
      return t("auth.cfErrorGeneric", {
        defaultValue: `Cloudflare 边缘服务异常，服务暂时不可用，请稍后重试。${rayIdSuffix}`,
        rayId: rayIdSuffix
      });
    }
    return t("auth.htmlErrorGeneric", {
      defaultValue: `服务器返回异常网页响应 (HTTP ${err.status || 500})，请稍后重试。`,
      status: err.status || 500
    });
  }

  // Handle specific backend error strings
  if (
    err?.status === 429 ||
    bodyText.toLowerCase().includes("too many") ||
    bodyText === "rate_limited"
  ) {
    return t("auth.tooManyAttempts", {
      defaultValue: "请求过于频繁或尝试次数过多，已被临时限制，请稍后再试。"
    });
  }

  if (bodyText.includes("row read limit") || bodyText.includes("exceeded D1") || bodyText === "database_unavailable") {
    return t("auth.dbQuotaExceeded", {
      defaultValue: "数据库每日免费读取配额已用尽，请等待每日重置（北京时间 08:00）或升级配额。"
    });
  }

  if (bodyText === "invalid_credentials" || bodyText === "user_not_found") {
    return t("auth.authFailed", "Authentication failed, please check your username or password.");
  }
  if (bodyText === "invalid_totp") {
    return t("auth.invalidTotp", "Invalid TOTP verification code.");
  }
  if (bodyText === "invalid_turnstile" || bodyText === "turnstile_failed") {
    return t("auth.turnstileRequired", "Please complete Turnstile verification.");
  }
  if (bodyText === "geolocation_missing") {
    return t("auth.geolocationRequired", "Geolocation retrieval failed, please re-enter.");
  }
  if (bodyText === "username_exists") {
    return t("auth.usernameExists", "Username already exists.");
  }
  if (bodyText === "password_leaked") {
    return t("auth.passwordLeaked", "Your password has been leaked.");
  }

  // If bodyText is short and doesn't contain HTML markup, return it directly
  if (bodyText && bodyText.length < 200 && !bodyText.includes("<") && !bodyText.includes(">")) {
    return bodyText;
  }

  return t("auth.authFailed", "Authentication failed, please check your username or password.");
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

/**
 * Hashes the client pinHash with a nonce challenge.
 * Uses 10,000 iterations to be fully compatible with Cloudflare Workers limits.
 */
export async function hashChallenge(pinHash: string, nonce: string): Promise<string> {
  return hashPasswordClient(pinHash, nonce, 10000);
}
