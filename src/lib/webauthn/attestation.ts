import { base64UrlEncode, base64UrlDecode } from "./encoding";
import { decodeCbor } from "./cbor";
import { ParsedAttestation, VerifyRegistrationOptions } from "./types";

/**
 * Parses the WebAuthn authenticatorData structure from an attestationObject.
 * Extracts flags, AAGUID, credential ID, and exports the public key as SPKI Base64URL.
 *
 * @param authData - Raw bytes of authenticatorData.
 * @returns Parsed attestation details with SPKI public key.
 */
export async function parseAttestationAuthData(
  authData: Uint8Array
): Promise<ParsedAttestation> {
  if (authData.length < 37) {
    throw new Error("Invalid authenticatorData length");
  }

  const rpIdHash = authData.subarray(0, 32);
  const flags = authData[32];
  const signCount =
    ((authData[33] << 24) >>> 0) +
    (authData[34] << 16) +
    (authData[35] << 8) +
    authData[36];

  // Bit 6 must be set for Attested Credential Data
  const hasAttestedCredData = Boolean(flags & 0x40);
  if (!hasAttestedCredData) {
    throw new Error("Attestation does not contain attested credential data");
  }

  let offset = 37;
  const aaguidBytes = authData.subarray(offset, offset + 16);
  offset += 16;
  const aaguid = Array.from(aaguidBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

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

/**
 * Validates a client's WebAuthn registration response (Ceremony 1: Attestation).
 *
 * @param options - Verification options including client data, attestation object, and expected values.
 * @returns Parsed attestation containing verified credential ID and public key.
 */
export async function verifyRegistrationResponse(
  options: VerifyRegistrationOptions
): Promise<ParsedAttestation> {
  const {
    clientDataJSON,
    attestationObject,
    expectedChallenge,
    expectedOrigin,
    expectedRpId
  } = options;

  // 1. Verify clientDataJSON
  const clientDataBytes = base64UrlDecode(clientDataJSON);
  const clientData = JSON.parse(new TextDecoder().decode(clientDataBytes));

  if (clientData.type !== "webauthn.create") {
    throw new Error(`Invalid clientData type: ${clientData.type}`);
  }

  if (clientData.challenge !== expectedChallenge) {
    throw new Error("WebAuthn challenge mismatch");
  }

  const clientOriginUrl = new URL(clientData.origin);
  const expectedOriginUrl = expectedOrigin.includes("://")
    ? new URL(expectedOrigin)
    : new URL(`https://${expectedOrigin}`);

  if (clientOriginUrl.hostname.toLowerCase() !== expectedOriginUrl.hostname.toLowerCase()) {
    throw new Error(
      `WebAuthn origin mismatch: expected ${expectedOriginUrl.hostname}, received ${clientOriginUrl.hostname}`
    );
  }

  const isLocalhost = clientOriginUrl.hostname === "localhost" || clientOriginUrl.hostname === "127.0.0.1";
  if (!isLocalhost && clientOriginUrl.protocol !== "https:") {
    throw new Error(`WebAuthn requires HTTPS origin, received: ${clientOriginUrl.protocol}`);
  }
  if (clientOriginUrl.protocol !== expectedOriginUrl.protocol) {
    throw new Error(
      `WebAuthn protocol mismatch: expected ${expectedOriginUrl.protocol}, received ${clientOriginUrl.protocol}`
    );
  }

  // 2. Decode attestationObject
  const attestationBytes = base64UrlDecode(attestationObject);
  const { value: attestation } = decodeCbor(attestationBytes);

  if (!attestation.authData) {
    throw new Error("Missing authData in attestationObject");
  }

  const parsed = await parseAttestationAuthData(attestation.authData);

  // 3. Verify RP ID hash
  const expectedRpIdHash = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(expectedRpId))
  );
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
