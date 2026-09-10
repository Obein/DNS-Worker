/**
 * @file webauthn.ts
 * @description Client-side WebAuthn / Passkey helper utilities.
 */

/**
 * Checks if the browser supports WebAuthn credentials API.
 */
export function isPasskeySupported(): boolean {
  return (
    typeof window !== "undefined" &&
    window.PublicKeyCredential !== undefined &&
    typeof window.PublicKeyCredential === "function"
  );
}

/**
 * Decodes a Base64URL string into an ArrayBuffer.
 */
export function base64UrlToBuffer(base64url: string): Uint8Array {
  let base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
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
 * Encodes an ArrayBuffer or Uint8Array into a Base64URL string.
 */
export function bufferToBase64Url(buffer: ArrayBuffer | Uint8Array): string {
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
 * Triggers the browser's native Passkey creation ceremony (`navigator.credentials.create`).
 * @param options - Server-generated registration options.
 */
export async function startPasskeyRegistration(options: any): Promise<any> {
  if (!isPasskeySupported()) {
    throw new Error("Passkeys are not supported by this browser.");
  }

  const publicKey: PublicKeyCredentialCreationOptions = {
    ...options,
    challenge: base64UrlToBuffer(options.challenge),
    user: {
      ...options.user,
      id: base64UrlToBuffer(options.user.id)
    },
    excludeCredentials: (options.excludeCredentials || []).map((cred: any) => ({
      ...cred,
      id: base64UrlToBuffer(cred.id)
    }))
  };

  const credential = (await navigator.credentials.create({
    publicKey
  })) as PublicKeyCredential;

  if (!credential) {
    throw new Error("Credential creation was cancelled or failed.");
  }

  const response = credential.response as AuthenticatorAttestationResponse;
  const transports = response.getTransports ? response.getTransports() : [];

  return {
    id: credential.id,
    rawId: bufferToBase64Url(credential.rawId),
    response: {
      clientDataJSON: bufferToBase64Url(response.clientDataJSON),
      attestationObject: bufferToBase64Url(response.attestationObject),
      transports
    }
  };
}

/**
 * Triggers the browser's native Passkey assertion ceremony (`navigator.credentials.get`).
 * @param options - Server-generated authentication challenge and allowed credentials.
 */
export async function startPasskeyAuthentication(options: any): Promise<any> {
  if (!isPasskeySupported()) {
    throw new Error("Passkeys are not supported by this browser.");
  }

  const publicKey: PublicKeyCredentialRequestOptions = {
    ...options,
    challenge: base64UrlToBuffer(options.challenge),
    allowCredentials: (options.allowCredentials || []).map((cred: any) => ({
      ...cred,
      id: base64UrlToBuffer(cred.id)
    }))
  };

  const credential = (await navigator.credentials.get({
    publicKey
  })) as PublicKeyCredential;

  if (!credential) {
    throw new Error("Passkey authentication was cancelled.");
  }

  const response = credential.response as AuthenticatorAssertionResponse;

  return {
    id: credential.id,
    rawId: bufferToBase64Url(credential.rawId),
    response: {
      clientDataJSON: bufferToBase64Url(response.clientDataJSON),
      authenticatorData: bufferToBase64Url(response.authenticatorData),
      signature: bufferToBase64Url(response.signature),
      userHandle: response.userHandle ? bufferToBase64Url(response.userHandle) : null
    }
  };
}
