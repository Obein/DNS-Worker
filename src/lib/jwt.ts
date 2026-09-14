export function base64urlEncode(buf: ArrayBuffer | Uint8Array | string): string {
  let stringToEncode = "";
  if (typeof buf === "string") {
    stringToEncode = buf;
  } else {
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.byteLength; i++) {
      stringToEncode += String.fromCharCode(bytes[i]);
    }
  }
  return btoa(stringToEncode)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function base64urlDecode(str: string): Uint8Array {
  let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4) {
    base64 += "=";
  }
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export function stringToUint8Array(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

/** Minimum accepted JWT_SECRET length. The built-in generator produces 64 characters. */
export const MIN_JWT_SECRET_LENGTH = 32;

/**
 * Placeholder values from the READMEs and .env.serverfull. A deployment that kept
 * one of these has a publicly known secret, so its tokens can be forged no matter
 * how the signing key is derived. Checked explicitly because length alone does not
 * catch them all: the .env.serverfull placeholder is 58 characters.
 */
const PLACEHOLDER_JWT_SECRETS = new Set([
  "your_secure_random_string_here",
  "您的随机安全JWT密钥",
  "您的隨機安全JWT金鑰",
  "replace_with_a_secure_random_jwt_secret_string_32chars_min",
]);

/**
 * Whether JWT_SECRET is present and is not a documentation placeholder.
 * Does not block on string length to allow legacy deployments to continue operating.
 */
export function isUsableJwtSecret(secret: string | undefined | null): secret is string {
  if (typeof secret !== "string") return false;
  const trimmed = secret.trim();
  return trimmed.length > 0 && !PLACEHOLDER_JWT_SECRETS.has(trimmed);
}

/**
 * Checks whether JWT_SECRET meets the recommended cryptographic length (>= 32 characters).
 * Shorter secrets are still usable to avoid breaking legacy deployments, but will trigger
 * a non-blocking warning in the administration dashboard and startup logs.
 */
export function isStrongJwtSecret(secret: string | undefined | null): boolean {
  if (!isUsableJwtSecret(secret)) return false;
  return secret.trim().length >= MIN_JWT_SECRET_LENGTH;
}

const JWT_KEY_SALT = "DNS_WORKER_JWT_KEY_SALT_v1";

/**
 * Derives a CryptoKey for JWT signing and verification.
 * Fixes hex parsing vulnerabilities where invalid hex characters evaluated to NaN (and implicitly 0 in Uint8Array),
 * or non-hex inputs could cause length mismatches / null pointer exceptions.
 * Derives a consistent 256-bit raw key by hashing secret + fixed salt using SHA-256.
 *
 * @param secret - Raw secret string or hex secret configured in environment
 * @returns CryptoKey for HMAC-SHA512 signing/verification
 */
export async function importJwtSecret(secret: string): Promise<CryptoKey> {
  const saltedData = new TextEncoder().encode(`${secret}:${JWT_KEY_SALT}`);
  const secretBytes = await crypto.subtle.digest("SHA-256", saltedData);

  return crypto.subtle.importKey(
    "raw",
    secretBytes,
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign", "verify"]
  );
}

export async function signJWT(payload: any, key: CryptoKey): Promise<string> {
  const header = { alg: "HS512", typ: "JWT" };
  const encodedHeader = base64urlEncode(JSON.stringify(header));
  const encodedPayload = base64urlEncode(JSON.stringify(payload));
  
  const dataToSign = `${encodedHeader}.${encodedPayload}`;
  const signatureBuffer = await crypto.subtle.sign(
    "HMAC",
    key,
    stringToUint8Array(dataToSign)
  );
  
  const encodedSignature = base64urlEncode(signatureBuffer);
  return `${dataToSign}.${encodedSignature}`;
}

export async function verifyJWT<T = any>(token: string, key: CryptoKey): Promise<T | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const dataToVerify = `${encodedHeader}.${encodedPayload}`;
  
  const signatureBytes = base64urlDecode(encodedSignature);
  
  const isValid = await crypto.subtle.verify(
    "HMAC",
    key,
    signatureBytes,
    stringToUint8Array(dataToVerify)
  );
  
  if (!isValid) return null;
  
  try {
    const payloadBytes = base64urlDecode(encodedPayload);
    const payloadStr = new TextDecoder().decode(payloadBytes);
    const payload = JSON.parse(payloadStr) as any;
    
    // Check expiry
    if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) {
      return null;
    }
    
    return payload as T;
  } catch (e) {
    return null;
  }
}
