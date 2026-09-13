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
