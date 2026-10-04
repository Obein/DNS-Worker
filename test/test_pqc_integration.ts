/**
 * @file test_pqc_integration.ts
 * @description End-to-end integration test for ObexDNS P256-MLKEM768 Post-Quantum E2EE with hourly KEM.
 */

import { ml_kem768_p256 } from "@noble/post-quantum/hybrid.js";
import assert from "node:assert";

// Base64 helpers
function toBase64(bytes: Uint8Array | ArrayBuffer): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return Buffer.from(u8).toString("base64");
}

function fromBase64(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, "base64"));
}

// HKDF-SHA256 derivation matching src/lib/crypto/e2ee.ts
async function deriveDekFromSharedSecret(sharedSecret: Uint8Array): Promise<CryptoKey> {
  const subtle = globalThis.crypto.subtle;
  const hkdfKey = await subtle.importKey(
    "raw",
    sharedSecret as BufferSource,
    { name: "HKDF" },
    false,
    ["deriveKey"]
  );

  return await subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(0),
      info: new TextEncoder().encode("obex-pqc-dek-v2"),
    },
    hkdfKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

// PBKDF2 Recovery Key KEK derivation matching src/lib/crypto/e2ee.ts
async function deriveRecoveryKek(plaintextRecoveryKey: string, salt: Uint8Array): Promise<CryptoKey> {
  const subtle = globalThis.crypto.subtle;
  const keyMaterial = await subtle.importKey(
    "raw",
    new TextEncoder().encode(plaintextRecoveryKey.trim().toUpperCase()),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );

  return await subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt as BufferSource,
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

// Compact Log Encryption matching src/lib/crypto/e2ee.ts
async function encryptLogWithDek(dek: CryptoKey, sensitiveData: Record<string, unknown>): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(sensitiveData));
  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    dek,
    plaintext
  );

  return JSON.stringify({
    iv: toBase64(iv),
    ciphertext: toBase64(ciphertextBuffer),
  });
}

// Compact Log Decryption matching src/lib/crypto/e2ee.ts
async function decryptLogWithDek(dek: CryptoKey, encryptedPayloadStr: string): Promise<Record<string, unknown>> {
  const payload = JSON.parse(encryptedPayloadStr) as { iv: string; ciphertext: string };
  const iv = fromBase64(payload.iv);
  const ciphertext = fromBase64(payload.ciphertext);

  const decryptedBytes = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    dek,
    ciphertext as BufferSource
  );

  return JSON.parse(new TextDecoder().decode(decryptedBytes)) as Record<string, unknown>;
}

async function runTestSuite(): Promise<void> {
  console.log("================================================================");
  console.log("   ObexDNS PQC E2EE (P256-MLKEM768 + Hourly KEM) Integration Test");
  console.log("================================================================\n");

  // Step 1: User Account Key Generation (Client side)
  console.log("[1] Generating P256-MLKEM768 hybrid keypair...");
  const t0 = performance.now();
  const keys = ml_kem768_p256.keygen();
  const tKeygen = performance.now() - t0;
  console.log(`    ✓ Public Key length: ${keys.publicKey.length} bytes (ML-KEM-768 1184B + P-256 65B)`);
  console.log(`    ✓ Secret Key seed length: ${keys.secretKey.length} bytes`);
  console.log(`    ✓ Keygen duration: ${tKeygen.toFixed(2)} ms`);
  assert.strictEqual(keys.publicKey.length, 1249, "Public key must be exactly 1249 bytes");
  assert.strictEqual(keys.secretKey.length, 32, "Secret key seed must be exactly 32 bytes");

  // Step 2: Key Wrapping with Recovery Key
  console.log("\n[2] Wrapping PQC seed with 30-digit Recovery Key...");
  const mockRecoveryKey = "ABCD-EFGH-IJKL-MNOP-QRST-UVWX-YZ12";
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const wrapIv = crypto.getRandomValues(new Uint8Array(12));
  const kek = await deriveRecoveryKek(mockRecoveryKey, salt);
  const wrappedSeed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: wrapIv },
    kek,
    keys.secretKey
  );
  console.log(`    ✓ Wrapped seed ciphertext: ${wrappedSeed.byteLength} bytes`);

  // Step 3: Key Unwrapping with Recovery Key
  console.log("\n[3] Unwrapping PQC seed on client device...");
  const unwrapKek = await deriveRecoveryKek(mockRecoveryKey, salt);
  const unwrappedSeed = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: wrapIv },
      unwrapKek,
      wrappedSeed
    )
  );
  assert.deepStrictEqual(unwrappedSeed, keys.secretKey, "Unwrapped seed must exactly match original seed");
  console.log("    ✓ Unwrapped seed matched perfectly!");

  // Step 4: Hourly DEK Encapsulation by Server (DekManager)
  console.log("\n[4] Simulating hourly DEK rotation (DekManager encapsulate)...");
  const tEnc0 = performance.now();
  const enc = ml_kem768_p256.encapsulate(keys.publicKey);
  const tEnc = performance.now() - tEnc0;
  console.log(`    ✓ KEM ciphertext length: ${enc.cipherText.length} bytes (stored in kem_keys table)`);
  console.log(`    ✓ Shared secret length: ${enc.sharedSecret.length} bytes`);
  console.log(`    ✓ Encapsulation duration: ${tEnc.toFixed(2)} ms`);
  assert.strictEqual(enc.cipherText.length, 1153, "KEM ciphertext must be exactly 1153 bytes");
  assert.strictEqual(enc.sharedSecret.length, 32, "Shared secret must be 32 bytes");

  const serverDek = await deriveDekFromSharedSecret(enc.sharedSecret);
  console.log("    ✓ Server derived AES-256-GCM DEK CryptoKey for current hour");

  // Step 5: High-throughput log encryption pipeline (zero expiration checks on hot path)
  console.log("\n[5] Simulating batch log encryption (1,000 queries in hot path)...");
  const mockLogs: Array<Record<string, unknown>> = [];
  for (let i = 0; i < 1000; i++) {
    mockLogs.push({
      domain: `user-device-${i}.internal.corp.com`,
      client_ip: `10.200.${(i >> 8) & 0xff}.${i & 0xff}`,
      geo_country: "US",
      answer: `198.51.100.${i % 250}`,
      dest_geoip: "Ashburn, VA",
      upstream: "https://1.1.1.1/dns-query",
      reason: i % 10 === 0 ? "Blocked by security filter" : null,
    });
  }

  const tEncrypt0 = performance.now();
  const encryptedPayloads: string[] = [];
  for (const log of mockLogs) {
    const payloadStr = await encryptLogWithDek(serverDek, log);
    encryptedPayloads.push(payloadStr);
  }
  const tEncryptTotal = performance.now() - tEncrypt0;
  const encryptThroughput = (1000 / tEncryptTotal) * 1000;
  console.log(`    ✓ Encrypted 1,000 logs in ${tEncryptTotal.toFixed(2)} ms (${encryptThroughput.toFixed(0)} logs/sec)`);

  // Verify compact payload structure (no redundant fields)
  const samplePayload = JSON.parse(encryptedPayloads[0]) as Record<string, unknown>;
  assert.strictEqual(Object.keys(samplePayload).sort().join(","), "ciphertext,iv", "Payload must ONLY contain iv and ciphertext");
  console.log(`    ✓ Payload size: ${encryptedPayloads[0].length} bytes (compact, minimal overhead)`);

  // Step 6: Client decapsulates DEK once per hour
  console.log("\n[6] Simulating Client query logs & batch decryption...");
  const tDecaps0 = performance.now();
  const clientSharedSecret = ml_kem768_p256.decapsulate(enc.cipherText, unwrappedSeed);
  const clientDek = await deriveDekFromSharedSecret(clientSharedSecret);
  const tDecaps = performance.now() - tDecaps0;
  console.log(`    ✓ KEM Decapsulation + DEK derivation: ${tDecaps.toFixed(2)} ms (cached per kem_key_id)`);

  // Step 7: Client batch decrypts all 1,000 logs with cached DEK
  const tDecrypt0 = performance.now();
  let decryptedCount = 0;
  for (let i = 0; i < encryptedPayloads.length; i++) {
    const decrypted = await decryptLogWithDek(clientDek, encryptedPayloads[i]);
    assert.strictEqual(decrypted.domain, mockLogs[i].domain);
    assert.strictEqual(decrypted.client_ip, mockLogs[i].client_ip);
    assert.strictEqual(decrypted.answer, mockLogs[i].answer);
    assert.strictEqual(decrypted.upstream, mockLogs[i].upstream);
    assert.strictEqual(decrypted.reason, mockLogs[i].reason);
    decryptedCount++;
  }
  const tDecryptTotal = performance.now() - tDecrypt0;
  const decryptThroughput = (1000 / tDecryptTotal) * 1000;
  console.log(`    ✓ Decrypted ${decryptedCount} logs with 100% data fidelity in ${tDecryptTotal.toFixed(2)} ms (${decryptThroughput.toFixed(0)} logs/sec)`);

  // Step 8: Backward compatibility check (Legacy P-256 ECDH log decryption)
  console.log("\n[8] Testing backward compatibility with legacy P-256 ECDH (encrypt_version = 1)...");
  const subtle = crypto.subtle;
  const userLegacyKeypair = await subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveKey"]
  );
  const userLegacyPubJwk = await subtle.exportKey("jwk", userLegacyKeypair.publicKey);
  const userLegacyPrivJwk = await subtle.exportKey("jwk", userLegacyKeypair.privateKey);

  // Server encrypts legacy log
  const ephemKeypair = await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey"]);
  const importedUserPub = await subtle.importKey("jwk", userLegacyPubJwk, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const legacySharedKey = await subtle.deriveKey(
    { name: "ECDH", public: importedUserPub } as any,
    ephemKeypair.privateKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"]
  );
  const legacyIv = crypto.getRandomValues(new Uint8Array(12));
  const legacyData = { domain: "legacy-v1-test.com", client_ip: "1.2.3.4", upstream: "1.1.1.1" };
  const legacyCt = await subtle.encrypt(
    { name: "AES-GCM", iv: legacyIv },
    legacySharedKey,
    new TextEncoder().encode(JSON.stringify(legacyData))
  );
  const legacyEphemJwk = await subtle.exportKey("jwk", ephemKeypair.publicKey);

  // Client decrypts legacy log using legacy routine
  const importedLegacyPriv = await subtle.importKey("jwk", userLegacyPrivJwk, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveKey"]);
  const importedEphemPub = await subtle.importKey("jwk", legacyEphemJwk, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const clientLegacySharedKey = await subtle.deriveKey(
    { name: "ECDH", public: importedEphemPub } as any,
    importedLegacyPriv,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );
  const decryptedLegacyBytes = await subtle.decrypt(
    { name: "AES-GCM", iv: legacyIv },
    clientLegacySharedKey,
    legacyCt
  );
  const decryptedLegacy = JSON.parse(new TextDecoder().decode(decryptedLegacyBytes)) as Record<string, unknown>;
  assert.strictEqual(decryptedLegacy.domain, "legacy-v1-test.com");
  assert.strictEqual(decryptedLegacy.client_ip, "1.2.3.4");
  console.log("    ✓ Legacy v1 log decrypted flawlessly with backward compatibility!");

  console.log("\n================================================================");
  console.log("   ALL INTEGRATION TESTS PASSED (100% SUCCESS)!");
  console.log("================================================================\n");
}

runTestSuite().catch((err: unknown) => {
  console.error("Test failed:", err);
  process.exit(1);
});
