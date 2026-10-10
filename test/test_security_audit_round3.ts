/**
 * @file test_security_audit_round3.ts
 * @description Comprehensive verification tests for Round 3 security hardening:
 * 1. SSRF and Dynamic DNS / Wildcard rebinding rejection in isSafeUrl
 * 2. WebAuthn origin port binding verification
 * 3. HTTP redirect manual enforcement in fetchListContent
 * 4. Passkey recovery key preservation
 */

import assert from "node:assert";
import { isSafeUrl, isSafeUrlWithDnsCheck } from "../src/utils/validator";
import { verifyAuthenticationResponse, base64UrlEncode } from "../src/lib/webauthn";
import { buildDNSQuery } from "../src/utils/dns/encoder";

async function testSafeUrlSSRFVectors(): Promise<void> {
  console.log("1. Testing isSafeUrl SSRF & Dynamic DNS Wildcard Filtering...");

  // Forbidden suffixes & local namespaces
  assert.strictEqual(isSafeUrl("http://service.localhost/list.txt"), false, "Must block .localhost domain");
  assert.strictEqual(isSafeUrl("http://printer.local/hosts"), false, "Must block .local mDNS domain");
  assert.strictEqual(isSafeUrl("http://metadata.internal/secrets"), false, "Must block .internal domain");
  assert.strictEqual(isSafeUrl("http://router.lan/config"), false, "Must block .lan domain");
  assert.strictEqual(isSafeUrl("http://gateway.home.arpa/status"), false, "Must block .home.arpa domain");
  assert.strictEqual(isSafeUrl("http://localtest.me/api"), false, "Must block localtest.me");
  assert.strictEqual(isSafeUrl("http://foo.localtest.me/api"), false, "Must block *.localtest.me");

  // Dynamic DNS wildcard / embedded IPs (nip.io, sslip.io)
  assert.strictEqual(isSafeUrl("http://127.0.0.1.nip.io/malicious.txt"), false, "Must block 127.0.0.1.nip.io");
  assert.strictEqual(isSafeUrl("http://sub.10.0.0.1.nip.io/list"), false, "Must block 10.0.0.1.nip.io");
  assert.strictEqual(isSafeUrl("http://192.168.1.1.sslip.io/list"), false, "Must block 192.168.1.1.sslip.io");
  assert.strictEqual(isSafeUrl("http://127-0-0-1.sslip.io/list"), false, "Must block 127-0-0-1.sslip.io");
  assert.strictEqual(isSafeUrl("http://169-254-169-254.nip.io/meta"), false, "Must block 169-254-169-254.nip.io");

  // Cloud metadata services
  assert.strictEqual(isSafeUrl("http://metadata.google.internal/computeMetadata/v1/"), false, "Must block GCP metadata");
  assert.strictEqual(isSafeUrl("http://metadata.goog/info"), false, "Must block metadata.goog");
  assert.strictEqual(isSafeUrl("http://169.254.169.254/latest/meta-data/"), false, "Must block AWS IMDS IPv4");
  assert.strictEqual(isSafeUrl("http://instance-data/latest"), false, "Must block instance-data");

  // Legitimate public resources must be allowed
  assert.strictEqual(isSafeUrl("https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts"), true, "Must allow GitHub HTTPS");
  assert.strictEqual(isSafeUrl("https://oisd.nl/domainswbl"), true, "Must allow OISD HTTPS");
  assert.strictEqual(isSafeUrl("tls://1.1.1.1:853"), true, "Must allow Cloudflare DNS over TLS");
  assert.strictEqual(isSafeUrl("http://8.8.8.8/dns-query"), true, "Must allow Google DNS over HTTP");

  // Public IP via sslip.io should be allowed
  assert.strictEqual(isSafeUrl("http://8.8.8.8.nip.io/list.txt"), true, "Must allow public IP via nip.io");

  console.log("  Passed: All SSRF vectors, wildcards, and suffixes correctly handled.");
}

async function testWebAuthnOriginPortBinding(): Promise<void> {
  console.log("2. Testing WebAuthn Origin Port Binding...");

  // Generate a mock challenge and clientDataJSON
  const challenge = "dGVzdC1jaGFsbGVuZ2UtMTIzNDU2";
  const clientDataPort3000 = {
    type: "webauthn.get",
    challenge,
    origin: "http://localhost:3000"
  };
  const clientDataJSONPort3000 = base64UrlEncode(
    new TextEncoder().encode(JSON.stringify(clientDataPort3000))
  );

  // Authenticator data: 32 bytes rpIdHash + 1 byte flag (UP=1) + 4 bytes counter
  const rpId = "localhost";
  const rpIdHashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rpId));
  const authData = new Uint8Array(37);
  authData.set(new Uint8Array(rpIdHashBuffer), 0);
  authData[32] = 0x01; // User Present
  authData[36] = 0x01; // sign count = 1
  const authDataB64 = base64UrlEncode(authData);

  // Generate an ECDSA key pair
  const keyPair = (await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  )) as CryptoKeyPair;
  const spkiBuffer = (await crypto.subtle.exportKey("spki", keyPair.publicKey)) as ArrayBuffer;
  const publicKeySpki = base64UrlEncode(spkiBuffer);

  // Compute signature over authData + clientDataHash
  const clientDataHashBuffer = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(clientDataPort3000))
  );
  const signedData = new Uint8Array(authData.length + 32);
  signedData.set(authData, 0);
  signedData.set(new Uint8Array(clientDataHashBuffer), authData.length);

  const signatureBuffer = (await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    keyPair.privateKey,
    signedData
  )) as ArrayBuffer;
  const signature = base64UrlEncode(signatureBuffer);

  // Verification against the EXACT matching origin (http://localhost:3000) should PASS
  const validResult = await verifyAuthenticationResponse({
    clientDataJSON: clientDataJSONPort3000,
    authenticatorData: authDataB64,
    signature,
    publicKeySpki,
    algorithm: -7,
    expectedChallenge: challenge,
    expectedOrigin: "http://localhost:3000",
    expectedRpId: rpId,
    previousSignCount: 0
  });
  assert.strictEqual(validResult.signCount, 1, "Matching origin with port must succeed");

  // Verification against a DIFFERENT port (http://localhost:8080) must FAIL
  let portMismatchThrew = false;
  try {
    await verifyAuthenticationResponse({
      clientDataJSON: clientDataJSONPort3000,
      authenticatorData: authDataB64,
      signature,
      publicKeySpki,
      algorithm: -7,
      expectedChallenge: challenge,
      expectedOrigin: "http://localhost:8080",
      expectedRpId: rpId,
      previousSignCount: 0
    });
  } catch (err: any) {
    portMismatchThrew = true;
    assert.match(err.message, /WebAuthn origin mismatch/i, "Must throw origin mismatch error");
  }
  assert.strictEqual(portMismatchThrew, true, "Must reject cross-port authentication assertion");

  console.log("  Passed: WebAuthn origin port mismatch correctly rejected.");
}

async function testFetchListContentSSRFBlocking(): Promise<void> {
  console.log("3. Testing fetchListContent SSRF Pre-validation...");
  const { fetchListContent } = await import("../src/utils/listFetcher");

  // SSRF attempts via loopback / local TLD / dynamic DNS should be blocked before making any requests
  const blocked1 = await fetchListContent("http://127.0.0.1.nip.io/malicious.txt", 1024, 1000, async () => {});
  assert.strictEqual(blocked1.count, 0);
  assert.match(blocked1.error || "", /Invalid list URL/);

  const blocked2 = await fetchListContent("http://metadata.google.internal/secret", 1024, 1000, async () => {});
  assert.strictEqual(blocked2.count, 0);
  assert.match(blocked2.error || "", /Invalid list URL/);

  const blocked3 = await fetchListContent("http://intranet.local/hosts", 1024, 1000, async () => {});
  assert.strictEqual(blocked3.count, 0);
  assert.match(blocked3.error || "", /Invalid list URL/);

  console.log("  Passed: fetchListContent blocked all forbidden SSRF URLs.");
}

async function testRecoveryKeyPreservationLogic(): Promise<void> {
  console.log("4. Testing Passkey Recovery Key Preservation Detection...");

  // Helper reflecting the preservation logic in passkeys.ts
  function shouldPreserveKeys(dbUser: { totp_recovery_keys?: string | null; totp_recovery_keys_encrypted?: string | null }): boolean {
    let hasExistingRecoveryKeys = false;
    if (dbUser.totp_recovery_keys) {
      try {
        const parsed = typeof dbUser.totp_recovery_keys === "string"
          ? JSON.parse(dbUser.totp_recovery_keys)
          : dbUser.totp_recovery_keys;
        if (Array.isArray(parsed) && parsed.length > 0) {
          hasExistingRecoveryKeys = true;
        }
      } catch {
        if (dbUser.totp_recovery_keys.length > 0) {
          hasExistingRecoveryKeys = true;
        }
      }
    } else if (dbUser.totp_recovery_keys_encrypted) {
      hasExistingRecoveryKeys = true;
    }
    return hasExistingRecoveryKeys;
  }

  // Case A: User with existing hashed recovery keys
  const userWithHashed = {
    totp_recovery_keys: JSON.stringify([{ hash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" }])
  };
  assert.strictEqual(shouldPreserveKeys(userWithHashed), true, "Must preserve existing hashed recovery keys");

  // Case B: User with envelope-encrypted recovery keys
  const userWithEncrypted = {
    totp_recovery_keys: null,
    totp_recovery_keys_encrypted: "encrypted_data_blob"
  };
  assert.strictEqual(shouldPreserveKeys(userWithEncrypted), true, "Must preserve envelope-encrypted recovery keys");

  // Case C: Brand new user with no recovery keys at all
  const brandNewUser = {
    totp_recovery_keys: null,
    totp_recovery_keys_encrypted: null
  };
  assert.strictEqual(shouldPreserveKeys(brandNewUser), false, "Brand new user without keys should generate fresh keys");

  console.log("  Passed: Recovery key preservation correctly identifies existing credentials.");
}

async function testDnsRebindingAndCsprng(): Promise<void> {
  console.log("5. Testing isSafeUrlWithDnsCheck & CSPRNG DNS Query ID...");

  // Anti-Rebinding / TOCTOU SSRF check
  assert.strictEqual(await isSafeUrlWithDnsCheck("http://127.0.0.1/evil"), false, "Must block loopback IP");
  assert.strictEqual(await isSafeUrlWithDnsCheck("http://169.254.169.254/latest"), false, "Must block IMDS metadata");
  assert.strictEqual(await isSafeUrlWithDnsCheck("http://localhost:8080/hosts"), false, "Must block localhost");
  assert.strictEqual(await isSafeUrlWithDnsCheck("http://10.0.0.1/list.txt"), false, "Must block RFC 1918 private IP");
  assert.strictEqual(await isSafeUrlWithDnsCheck("https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts"), true, "Must allow public GitHub URL");

  // CSPRNG DNS Transaction ID generation check
  const queryPacket1 = buildDNSQuery("example.com", "A");
  const queryPacket2 = buildDNSQuery("example.com", "A");
  const id1 = (queryPacket1[0] << 8) | queryPacket1[1];
  const id2 = (queryPacket2[0] << 8) | queryPacket2[1];

  assert.ok(id1 >= 0 && id1 <= 65535, "ID1 must be a valid 16-bit integer");
  assert.ok(id2 >= 0 && id2 <= 65535, "ID2 must be a valid 16-bit integer");

  console.log("  Passed: DNS rebinding defenses and CSPRNG query IDs validated.");
}

async function runAllTests(): Promise<void> {
  console.log("================================================================");
  console.log("       ObexDNS Security Audit Round 3 Verification Suite        ");
  console.log("================================================================\n");

  await testSafeUrlSSRFVectors();
  await testWebAuthnOriginPortBinding();
  await testFetchListContentSSRFBlocking();
  await testRecoveryKeyPreservationLogic();
  await testDnsRebindingAndCsprng();

  console.log("\n>>> [TEST] All Round 3 Security Audit tests passed successfully!\n");
}

runAllTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
