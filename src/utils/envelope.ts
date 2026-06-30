export function getActiveKekVersion(env: any): string | null {
  if (!env) return null;
  let maxVer = 0;
  for (let ver = 1; ver <= 100; ver++) {
    const val = env[`KEK_v${ver}`] || env[`KEK_V${ver}`];
    if (val !== undefined && val !== null && val !== "") {
      if (ver > maxVer) {
        maxVer = ver;
      }
    }
  }
  return maxVer > 0 ? `v${maxVer}` : null;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function fromBase64(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function importKek(secret: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const secretData = encoder.encode(secret.trim());
  const hashBuffer = await crypto.subtle.digest("SHA-256", secretData);
  return await crypto.subtle.importKey(
    "raw",
    hashBuffer,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"]
  );
}

async function importDek(dekBytes: Uint8Array): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    "raw",
    dekBytes,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"]
  );
}

export interface EnvelopeEncryptedData {
  ciphertext: string;
  iv: string;
}

export interface EnvelopeEncryptedDek {
  ciphertext: string;
  iv: string;
  kek_version: string;
}

/**
 * Encrypts a plaintext string using Envelope Encryption.
 * @returns Encrypted data and encrypted DEK strings (JSON serialized)
 */
export async function encryptEnvelope(
  plainText: string,
  env: any
): Promise<{ dataEncrypted: string; dekEncrypted: string } | null> {
  const activeVersion = getActiveKekVersion(env);
  if (!activeVersion) {
    // If no KEK is present in env, skip encryption
    return null;
  }

  const kekSecret = env[`KEK_${activeVersion}`] || env[`KEK_${activeVersion.toUpperCase()}`];
  if (!kekSecret || typeof kekSecret !== "string" || kekSecret.trim() === "") {
    throw new Error(`KEK version ${activeVersion} is missing or invalid in environment variables`);
  }

  const kekKey = await importKek(kekSecret);

  // 1. Generate plain Data Encryption Key (DEK) - 256 bits (32 bytes)
  const dekBytes = new Uint8Array(32);
  crypto.getRandomValues(dekBytes);
  const dekKey = await importDek(dekBytes);

  // 2. Encrypt plaintext data using the DEK via AES-256-GCM
  const dataIv = new Uint8Array(12);
  crypto.getRandomValues(dataIv);
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(plainText);
  const encryptedDataBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: dataIv },
    dekKey,
    dataBuffer
  );

  const dataEncrypted: EnvelopeEncryptedData = {
    ciphertext: toBase64(new Uint8Array(encryptedDataBuffer)),
    iv: toBase64(dataIv)
  };

  // 3. Encrypt the DEK using the KEK via AES-256-GCM
  const dekIv = new Uint8Array(12);
  crypto.getRandomValues(dekIv);
  const encryptedDekBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: dekIv },
    kekKey,
    dekBytes
  );

  const dekEncrypted: EnvelopeEncryptedDek = {
    ciphertext: toBase64(new Uint8Array(encryptedDekBuffer)),
    iv: toBase64(dekIv),
    kek_version: activeVersion
  };

  return {
    dataEncrypted: JSON.stringify(dataEncrypted),
    dekEncrypted: JSON.stringify(dekEncrypted)
  };
}

/**
 * Decrypts envelope encrypted data using the stored DEK and KEK.
 */
export async function decryptEnvelope(
  dataEncryptedStr: string,
  dekEncryptedStr: string,
  env: any
): Promise<string> {
  const dataEncrypted: EnvelopeEncryptedData = JSON.parse(dataEncryptedStr);
  const dekEncrypted: EnvelopeEncryptedDek = JSON.parse(dekEncryptedStr);

  const kekSecret = env[`KEK_${dekEncrypted.kek_version}`] || env[`KEK_${dekEncrypted.kek_version.toUpperCase()}`];
  if (!kekSecret || typeof kekSecret !== "string" || kekSecret.trim() === "") {
    throw new Error(`Required KEK version ${dekEncrypted.kek_version} is missing or invalid in environment variables`);
  }

  const kekKey = await importKek(kekSecret);

  // 1. Decrypt the DEK using the KEK
  const encryptedDekBytes = fromBase64(dekEncrypted.ciphertext);
  const dekIv = fromBase64(dekEncrypted.iv);
  const decryptedDekBuffer = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: dekIv },
    kekKey,
    encryptedDekBytes
  );

  const dekBytes = new Uint8Array(decryptedDekBuffer);
  const dekKey = await importDek(dekBytes);

  // 2. Decrypt the data using the decrypted DEK
  const encryptedDataBytes = fromBase64(dataEncrypted.ciphertext);
  const dataIv = fromBase64(dataEncrypted.iv);
  const decryptedDataBuffer = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: dataIv },
    dekKey,
    encryptedDataBytes
  );

  const decoder = new TextDecoder();
  return decoder.decode(decryptedDataBuffer);
}

/**
 * Performs on-the-fly key rotation of the DEK if a newer version of KEK is available.
 * Rotation logic is strictly sequential: N -> N+1.
 * @returns The new encrypted DEK string (JSON serialized), or null if no rotation occurred.
 */
export async function rotateEnvelopeDek(
  dekEncryptedStr: string,
  env: any
): Promise<string | null> {
  if (!env) return null;

  const dekEncrypted: EnvelopeEncryptedDek = JSON.parse(dekEncryptedStr);
  const currentKekVersion = dekEncrypted.kek_version; // e.g. "v1"
  const currentVersionNumber = parseInt(currentKekVersion.replace(/^v/, ""), 10);
  if (isNaN(currentVersionNumber)) {
    return null;
  }

  const nextVersionNumber = currentVersionNumber + 1;
  const nextKekVersion = `v${nextVersionNumber}`;
  const nextKekSecret = env[`KEK_${nextKekVersion}`] || env[`KEK_${nextKekVersion.toUpperCase()}`];

  if (!nextKekSecret || typeof nextKekSecret !== "string" || nextKekSecret.trim() === "") {
    // Next version not configured/available yet
    return null;
  }

  // 1. Decrypt the DEK with current KEK
  const currentKekSecret = env[`KEK_${currentKekVersion}`] || env[`KEK_${currentKekVersion.toUpperCase()}`];
  if (!currentKekSecret || typeof currentKekSecret !== "string" || currentKekSecret.trim() === "") {
    throw new Error(`Current KEK version ${currentKekVersion} required for rotation is missing or invalid in environment`);
  }

  const currentKekKey = await importKek(currentKekSecret);
  const encryptedDekBytes = fromBase64(dekEncrypted.ciphertext);
  const dekIv = fromBase64(dekEncrypted.iv);
  const decryptedDekBuffer = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: dekIv },
    currentKekKey,
    encryptedDekBytes
  );

  const dekBytes = new Uint8Array(decryptedDekBuffer);

  // 2. Encrypt the DEK with the next KEK (KEK_v(N+1))
  const nextKekKey = await importKek(nextKekSecret);
  const newDekIv = new Uint8Array(12);
  crypto.getRandomValues(newDekIv);
  const newEncryptedDekBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: newDekIv },
    nextKekKey,
    dekBytes
  );

  const updatedDekEncrypted: EnvelopeEncryptedDek = {
    ciphertext: toBase64(new Uint8Array(newEncryptedDekBuffer)),
    iv: toBase64(newDekIv),
    kek_version: nextKekVersion
  };

  return JSON.stringify(updatedDekEncrypted);
}
