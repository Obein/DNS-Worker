import { base64UrlDecode, derToP1363 } from "./encoding";
import { VerifyAuthenticationOptions } from "./types";

/**
 * Validates a client's WebAuthn assertion (Ceremony 2: Authentication).
 *
 * Verifies:
 * 1. clientDataJSON (type 'webauthn.get', challenge, and origin).
 * 2. authenticatorData (RP ID hash, UP flag, monotonic sign count check).
 * 3. Cryptographic signature over `authenticatorData || SHA-256(clientDataJSON)`
 *    using Web Crypto API (ES256 via IEEE P1363 conversion, or RS256).
 *
 * @param options - Verification options including signatures, public key, and challenges.
 * @returns Object containing the verified new signature count.
 */
export async function verifyAuthenticationResponse(
  options: VerifyAuthenticationOptions
): Promise<{ signCount: number }> {
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

  // 2. Verify authenticatorData
  const authDataBytes = base64UrlDecode(authenticatorData);
  if (authDataBytes.length < 37) {
    throw new Error("Invalid authenticatorData length");
  }

  const rpIdHash = authDataBytes.subarray(0, 32);
  const flags = authDataBytes[32];
  const signCount =
    ((authDataBytes[33] << 24) >>> 0) +
    (authDataBytes[34] << 16) +
    (authDataBytes[35] << 8) +
    authDataBytes[36];

  const expectedRpIdHash = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(expectedRpId))
  );
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
    throw new Error(
      "Authenticator sign count is not strictly monotonic. Possible cloned authenticator detected."
    );
  }

  // 3. Cryptographic Signature Verification
  // Signed data = authenticatorData || SHA-256(clientDataJSON)
  const clientDataHash = new Uint8Array(
    await crypto.subtle.digest("SHA-256", clientDataBytes)
  );
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
