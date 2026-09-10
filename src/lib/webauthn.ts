/**
 * @file webauthn.ts
 * @description Zero-dependency WebAuthn / Passkey authentication and attestation engine for Cloudflare Workers.
 * Complies with W3C WebAuthn Level 3 and FIDO2 specifications using native Web Crypto API.
 */

/**
 * Encodes a buffer or byte array into a Base64URL string (RFC 4648 §5).
 */
export function base64UrlEncode(buffer: Uint8Array | ArrayBuffer): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Decodes a Base64URL string into a Uint8Array.
 */
export function base64UrlDecode(str: string): Uint8Array {
  let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4 !== 0) {
    base64 += "=";
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Generates a high-entropy random challenge for WebAuthn ceremony.
 * @returns 32-byte Base64URL challenge string.
 */
export function generateWebAuthnChallenge(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

/**
 * Minimal, robust CBOR decoder tailored for WebAuthn attestationObject and COSE key structures.
 */
export function decodeCbor(data: Uint8Array): { value: any; bytesRead: number } {
  let offset = 0;

  function readUint(info: number): number | bigint {
    if (info < 24) return info;
    if (info === 24) return data[offset++];
    if (info === 25) {
      const val = (data[offset] << 8) | data[offset + 1];
      offset += 2;
      return val;
    }
    if (info === 26) {
      const val = ((data[offset] << 24) >>> 0) + (data[offset + 1] << 16) + (data[offset + 2] << 8) + data[offset + 3];
      offset += 4;
      return val;
    }
    if (info === 27) {
      const hi = BigInt(((data[offset] << 24) >>> 0) + (data[offset + 1] << 16) + (data[offset + 2] << 8) + data[offset + 3]);
      const lo = BigInt(((data[offset + 4] << 24) >>> 0) + (data[offset + 5] << 16) + (data[offset + 6] << 8) + data[offset + 7]);
      offset += 8;
      return (hi << 32n) | lo;
    }
    throw new Error(`Unsupported CBOR uint info: ${info}`);
  }

  function parseItem(): any {
    if (offset >= data.length) throw new Error("Unexpected end of CBOR data");
    const initialByte = data[offset++];
    const majorType = initialByte >> 5;
    const info = initialByte & 0x1f;

    switch (majorType) {
      case 0: { // unsigned integer
        const val = readUint(info);
        return typeof val === "bigint" ? Number(val) : val;
      }
      case 1: { // negative integer (-1 - n)
        const val = readUint(info);
        return typeof val === "bigint" ? Number(-1n - val) : -1 - Number(val);
      }
      case 2: { // byte string
        const len = Number(readUint(info));
        const slice = data.subarray(offset, offset + len);
        offset += len;
        return slice;
      }
      case 3: { // text string
        const len = Number(readUint(info));
        const slice = data.subarray(offset, offset + len);
        offset += len;
        return new TextDecoder().decode(slice);
      }
      case 4: { // array
        const len = Number(readUint(info));
        const arr: any[] = [];
        for (let i = 0; i < len; i++) {
          arr.push(parseItem());
        }
        return arr;
      }
      case 5: { // map
        const len = Number(readUint(info));
        const map: any = {};
        for (let i = 0; i < len; i++) {
          const key = parseItem();
          const val = parseItem();
          map[key] = val;
        }
        return map;
      }
      case 7: { // simple values
        if (info === 20) return false;
        if (info === 21) return true;
        if (info === 22) return null;
        return undefined;
      }
      default:
        throw new Error(`Unsupported CBOR major type: ${majorType}`);
    }
  }

  const value = parseItem();
  return { value, bytesRead: offset };
}

/**
 * Converts an ASN.1 DER-encoded ECDSA signature to raw IEEE P1363 (r || s) format
 * expected by Web Crypto API `subtle.verify`.
 */
export function derToP1363(der: Uint8Array): Uint8Array {
  if (der[0] !== 0x30) {
    if (der.length === 64) return der;
    throw new Error("Invalid ECDSA signature: expected ASN.1 SEQUENCE");
  }

  let offset = 2;
  if (der[1] & 0x80) {
    offset = 2 + (der[1] & 0x7f);
  }

  // Read r
  if (der[offset++] !== 0x02) throw new Error("Expected INTEGER for r in signature");
  const rLen = der[offset++];
  let r = der.subarray(offset, offset + rLen);
  offset += rLen;

  // Read s
  if (der[offset++] !== 0x02) throw new Error("Expected INTEGER for s in signature");
  const sLen = der[offset++];
  let s = der.subarray(offset, offset + sLen);

  // Strip leading zero padding if added to keep value positive in two's complement
  while (r.length > 32 && r[0] === 0x00) r = r.subarray(1);
  while (s.length > 32 && s[0] === 0x00) s = s.subarray(1);

  const p1363 = new Uint8Array(64);
  p1363.set(r, 32 - r.length);
  p1363.set(s, 64 - s.length);
  return p1363;
}

export interface ParsedAttestation {
  rpIdHash: Uint8Array;
  flags: number;
  signCount: number;
  aaguid: string;
  credentialId: string;
  publicKeySpki: string;
  algorithm: number;
}

/**
 * Parses the WebAuthn authenticatorData structure from an attestationObject.
 */
export async function parseAttestationAuthData(authData: Uint8Array): Promise<ParsedAttestation> {
  if (authData.length < 37) {
    throw new Error("Invalid authenticatorData length");
  }

  const rpIdHash = authData.subarray(0, 32);
  const flags = authData[32];
  const signCount = ((authData[33] << 24) >>> 0) + (authData[34] << 16) + (authData[35] << 8) + authData[36];

  // Bit 6 must be set for Attested Credential Data
  const hasAttestedCredData = !!(flags & 0x40);
  if (!hasAttestedCredData) {
    throw new Error("Attestation does not contain attested credential data");
  }

  let offset = 37;
  const aaguidBytes = authData.subarray(offset, offset + 16);
  offset += 16;
  const aaguid = Array.from(aaguidBytes).map(b => b.toString(16).padStart(2, "0")).join("");

  const credIdLen = (authData[offset] << 8) | authData[offset + 1];
  offset += 2;

  const credIdBytes = authData.subarray(offset, offset + credIdLen);
  offset += credIdLen;
  const credentialId = base64UrlEncode(credIdBytes);

  // Remaining bytes contain the COSE Key encoded in CBOR
  const coseCborData = authData.subarray(offset);
  const { value: coseKey } = decodeCbor(coseCborData);

  // Key 3 is algorithm: -7 = ES256, -257 = RS256
  const alg = coseKey[3] ?? -7;
  let publicKeySpki = "";

  if (alg === -7) {
    // ES256: Key 1=2 (EC2), Key -1=1 (P-256), Key -2=x (32 bytes), Key -3=y (32 bytes)
    const x = coseKey[-2];
    const y = coseKey[-3];
    if (!x || !y || x.length !== 32 || y.length !== 32) {
      throw new Error("Invalid EC2 COSE public key components");
    }

    const uncompressedPoint = new Uint8Array(65);
    uncompressedPoint[0] = 0x04;
    uncompressedPoint.set(x, 1);
    uncompressedPoint.set(y, 33);

    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      uncompressedPoint,
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["verify"]
    );

    const spkiBuffer = (await crypto.subtle.exportKey("spki", cryptoKey)) as ArrayBuffer;
    publicKeySpki = base64UrlEncode(spkiBuffer);
  } else if (alg === -257) {
    // RS256: Key 1=3 (RSA), Key -1=n, Key -2=e
    const n = coseKey[-1];
    const e = coseKey[-2];
    if (!n || !e) {
      throw new Error("Invalid RSA COSE public key components");
    }

    const jwk = {
      kty: "RSA",
      n: base64UrlEncode(n),
      e: base64UrlEncode(e),
      alg: "RS256",
      ext: true
    };

    const cryptoKey = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      true,
      ["verify"]
    );

    const spkiBuffer = (await crypto.subtle.exportKey("spki", cryptoKey)) as ArrayBuffer;
    publicKeySpki = base64UrlEncode(spkiBuffer);
  } else {
    throw new Error(`Unsupported COSE algorithm: ${alg}`);
  }

  return {
    rpIdHash,
    flags,
    signCount,
    aaguid,
    credentialId,
    publicKeySpki,
    algorithm: alg
  };
}

export interface VerifyRegistrationOptions {
  clientDataJSON: string; // Base64URL
  attestationObject: string; // Base64URL
  expectedChallenge: string; // Base64URL
  expectedOrigin: string; // e.g. "https://dns.example.com"
  expectedRpId: string; // e.g. "dns.example.com"
}

/**
 * Validates a client's WebAuthn registration response.
 */
export async function verifyRegistrationResponse(options: VerifyRegistrationOptions): Promise<ParsedAttestation> {
  const { clientDataJSON, attestationObject, expectedChallenge, expectedOrigin, expectedRpId } = options;

  // 1. Verify clientDataJSON
  const clientDataBytes = base64UrlDecode(clientDataJSON);
  const clientData = JSON.parse(new TextDecoder().decode(clientDataBytes));

  if (clientData.type !== "webauthn.create") {
    throw new Error(`Invalid clientData type: ${clientData.type}`);
  }

  if (clientData.challenge !== expectedChallenge) {
    throw new Error("WebAuthn challenge mismatch");
  }

  // Verify origin matches hostname or exact origin
  const clientOrigin = new URL(clientData.origin).hostname;
  const expectedOriginHost = expectedOrigin.includes("://") ? new URL(expectedOrigin).hostname : expectedOrigin;
  if (clientOrigin.toLowerCase() !== expectedOriginHost.toLowerCase()) {
    throw new Error(`WebAuthn origin mismatch: expected ${expectedOriginHost}, received ${clientOrigin}`);
  }

  // 2. Decode attestationObject
  const attestationBytes = base64UrlDecode(attestationObject);
  const { value: attestation } = decodeCbor(attestationBytes);

  if (!attestation.authData) {
    throw new Error("Missing authData in attestationObject");
  }

  const parsed = await parseAttestationAuthData(attestation.authData);

  // 3. Verify RP ID hash
  const expectedRpIdHash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(expectedRpId)));
  for (let i = 0; i < 32; i++) {
    if (parsed.rpIdHash[i] !== expectedRpIdHash[i]) {
      throw new Error("WebAuthn rpIdHash mismatch");
    }
  }

  // 4. Verify User Presence (UP) flag
  if (!(parsed.flags & 0x01)) {
    throw new Error("User Presence (UP) flag not set");
  }

  return parsed;
}

export interface VerifyAuthenticationOptions {
  clientDataJSON: string; // Base64URL
  authenticatorData: string; // Base64URL
  signature: string; // Base64URL
  publicKeySpki: string; // Base64URL
  algorithm: number;
  expectedChallenge: string; // Base64URL
  expectedOrigin: string;
  expectedRpId: string;
  previousSignCount?: number;
}

/**
 * Validates a client's WebAuthn assertion (authentication) response.
 */
export async function verifyAuthenticationResponse(options: VerifyAuthenticationOptions): Promise<{ signCount: number }> {
  const {
    clientDataJSON,
    authenticatorData,
    signature,
    publicKeySpki,
    algorithm,
    expectedChallenge,
    expectedOrigin,
    expectedRpId,
    previousSignCount = 0
  } = options;

  // 1. Verify clientDataJSON
  const clientDataBytes = base64UrlDecode(clientDataJSON);
  const clientData = JSON.parse(new TextDecoder().decode(clientDataBytes));

  if (clientData.type !== "webauthn.get") {
    throw new Error(`Invalid clientData type: ${clientData.type}`);
  }

  if (clientData.challenge !== expectedChallenge) {
    throw new Error("WebAuthn challenge mismatch");
  }

  const clientOrigin = new URL(clientData.origin).hostname;
  const expectedOriginHost = expectedOrigin.includes("://") ? new URL(expectedOrigin).hostname : expectedOrigin;
  if (clientOrigin.toLowerCase() !== expectedOriginHost.toLowerCase()) {
    throw new Error(`WebAuthn origin mismatch: expected ${expectedOriginHost}, received ${clientOrigin}`);
  }

  // 2. Verify authenticatorData
  const authDataBytes = base64UrlDecode(authenticatorData);
  if (authDataBytes.length < 37) {
    throw new Error("Invalid authenticatorData length");
  }

  const rpIdHash = authDataBytes.subarray(0, 32);
  const flags = authDataBytes[32];
  const signCount = ((authDataBytes[33] << 24) >>> 0) + (authDataBytes[34] << 16) + (authDataBytes[35] << 8) + authDataBytes[36];

  const expectedRpIdHash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(expectedRpId)));
  for (let i = 0; i < 32; i++) {
    if (rpIdHash[i] !== expectedRpIdHash[i]) {
      throw new Error("WebAuthn rpIdHash mismatch");
    }
  }

  // User Present flag
  if (!(flags & 0x01)) {
    throw new Error("User Presence flag (UP) was not set by authenticator");
  }

  // Monotonic sign count check (detect cloned authenticators)
  if (signCount > 0 && previousSignCount > 0 && signCount <= previousSignCount) {
    throw new Error("Authenticator sign count is not strictly monotonic. Possible cloned authenticator detected.");
  }

  // 3. Cryptographic Signature Verification
  // Signed data = authenticatorData || SHA-256(clientDataJSON)
  const clientDataHash = new Uint8Array(await crypto.subtle.digest("SHA-256", clientDataBytes));
  const signedData = new Uint8Array(authDataBytes.length + clientDataHash.length);
  signedData.set(authDataBytes, 0);
  signedData.set(clientDataHash, authDataBytes.length);

  const sigBytes = base64UrlDecode(signature);
  const spkiBytes = base64UrlDecode(publicKeySpki);

  if (algorithm === -7) {
    // ES256 (ECDSA P-256)
    const cryptoKey = await crypto.subtle.importKey(
      "spki",
      spkiBytes,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"]
    );

    const rawSig = derToP1363(sigBytes);
    const valid = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      cryptoKey,
      rawSig,
      signedData
    );

    if (!valid) {
      throw new Error("WebAuthn signature verification failed");
    }
  } else if (algorithm === -257) {
    // RS256
    const cryptoKey = await crypto.subtle.importKey(
      "spki",
      spkiBytes,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"]
    );

    const valid = await crypto.subtle.verify(
      { name: "RSASSA-PKCS1-v1_5" },
      cryptoKey,
      sigBytes,
      signedData
    );

    if (!valid) {
      throw new Error("WebAuthn signature verification failed");
    }
  } else {
    throw new Error(`Unsupported public key algorithm: ${algorithm}`);
  }

  return { signCount };
}
