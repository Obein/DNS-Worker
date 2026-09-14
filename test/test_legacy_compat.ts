import assert from 'node:assert';
import { isUsableJwtSecret, isStrongJwtSecret } from '../src/lib/jwt';
import { getOrCreateJwtSecret } from '../src/lib/auth';
import {
  getActiveKekVersion,
  getKekSecret,
  encryptEnvelope,
  decryptEnvelope,
  rotateEnvelopeDek
} from '../src/utils/envelope';

async function runTests() {
  console.log('>>> [TEST] Running JWT_SECRET & Envelope Compatibility Tests...');

  // 1. JWT_SECRET Usability & Strength Validation
  console.log('1. Validating isUsableJwtSecret and isStrongJwtSecret...');

  const shortSecret = "my_short_secret";
  const strongSecret = "this_is_a_sufficiently_long_secret_for_production_use_123456";
  const placeholder = "replace_with_a_secure_random_jwt_secret_string_32chars_min";

  assert.strictEqual(isUsableJwtSecret(shortSecret), true, "Short secret should be usable");
  assert.strictEqual(isStrongJwtSecret(shortSecret), false, "Short secret should NOT be strong");

  assert.strictEqual(isUsableJwtSecret(strongSecret), true, "Strong secret should be usable");
  assert.strictEqual(isStrongJwtSecret(strongSecret), true, "Strong secret should be strong");

  assert.strictEqual(isUsableJwtSecret(placeholder), false, "Placeholder secret must be rejected as unusable");
  assert.strictEqual(isStrongJwtSecret(placeholder), false, "Placeholder secret must not be strong");

  assert.strictEqual(isUsableJwtSecret(""), false, "Empty string should be unusable");
  assert.strictEqual(isUsableJwtSecret("   "), false, "Whitespace string should be unusable");
  assert.strictEqual(isUsableJwtSecret(null), false, "Null should be unusable");
  assert.strictEqual(isUsableJwtSecret(undefined), false, "Undefined should be unusable");

  // getOrCreateJwtSecret should succeed for short secrets
  const envShort = { JWT_SECRET: shortSecret } as any;
  const returnedSecret = await getOrCreateJwtSecret(envShort);
  assert.strictEqual(returnedSecret, shortSecret, "getOrCreateJwtSecret should return short secret without throwing");

  // 2. getActiveKekVersion behavior
  console.log('2. Validating getActiveKekVersion...');
  assert.strictEqual(getActiveKekVersion({ JWT_SECRET: "anything" }), null, "Should return null when no KEK_v* exists");
  assert.strictEqual(getActiveKekVersion({ KEK_v1: "key1" }), "v1");
  assert.strictEqual(getActiveKekVersion({ KEK_v105: "key105", KEK_v2: "key2" }), "v105", "Should support versions > 100");

  // 3. Encrypt envelope when no KEK configured
  console.log('3. Validating encryptEnvelope with no KEK...');
  const noKekEnv = { JWT_SECRET: "legacy_secret_123" };
  const nullResult = await encryptEnvelope("my_secret_totp_seed", noKekEnv);
  assert.strictEqual(nullResult, null, "Should return null when no KEK is configured (do not mix JWT_SECRET)");

  // 4. Encrypt envelope with KEK_v1 and decrypt with KEK_v1
  console.log('4. Validating envelope encryption and decryption with KEK_v1...');
  const kek1Env = {
    JWT_SECRET: "legacy_secret_123",
    KEK_v1: "kek_secret_key_version_one_alpha"
  };
  const encResult = await encryptEnvelope("my_secret_totp_seed", kek1Env);
  assert(encResult !== null, "Encryption should succeed with KEK_v1");

  const decrypted = await decryptEnvelope(encResult.dataEncrypted, encResult.dekEncrypted, kek1Env);
  assert.strictEqual(decrypted, "my_secret_totp_seed", "Decrypted plaintext should match original");

  // 5. Fallback decryption using KEK_v0 (JWT_SECRET)
  console.log('5. Validating fallback to KEK_v0 (JWT_SECRET)...');
  // Simulate legacy data encrypted with JWT_SECRET (v0)
  const legacyEncResult = await (async () => {
    const kekKey = await crypto.subtle.importKey(
      "raw",
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode("original_jwt_secret_used_as_kek")),
      { name: "AES-GCM" },
      false,
      ["encrypt", "decrypt"]
    );
    const dekBytes = new Uint8Array(32);
    crypto.getRandomValues(dekBytes);
    const dekKey = await crypto.subtle.importKey("raw", dekBytes, { name: "AES-GCM" }, false, ["encrypt"]);

    const dataIv = new Uint8Array(12);
    crypto.getRandomValues(dataIv);
    const encData = await crypto.subtle.encrypt({ name: "AES-GCM", iv: dataIv }, dekKey, new TextEncoder().encode("legacy_totp_data"));

    const dekIv = new Uint8Array(12);
    crypto.getRandomValues(dekIv);
    const encDek = await crypto.subtle.encrypt({ name: "AES-GCM", iv: dekIv }, kekKey, dekBytes);

    return {
      dataEncrypted: JSON.stringify({
        ciphertext: Buffer.from(encData).toString('base64'),
        iv: Buffer.from(dataIv).toString('base64')
      }),
      dekEncrypted: JSON.stringify({
        ciphertext: Buffer.from(encDek).toString('base64'),
        iv: Buffer.from(dekIv).toString('base64'),
        kek_version: "v0"
      })
    };
  })();

  // Scenario A: Environment only has JWT_SECRET (no KEK_v0 explicitly defined)
  const legacyDeployEnv = {
    JWT_SECRET: "original_jwt_secret_used_as_kek"
  };
  const decryptedLegacy = await decryptEnvelope(legacyEncResult.dataEncrypted, legacyEncResult.dekEncrypted, legacyDeployEnv);
  assert.strictEqual(decryptedLegacy, "legacy_totp_data", "Should decrypt legacy v0 data using env.JWT_SECRET");

  // Scenario B: Primary KEK version failed or missing, but fallback to JWT_SECRET succeeds
  const mislabeledEncResult = {
    ...legacyEncResult,
    dekEncrypted: legacyEncResult.dekEncrypted.replace('"kek_version":"v0"', '"kek_version":"v1"')
  };
  const decryptedFallback = await decryptEnvelope(mislabeledEncResult.dataEncrypted, mislabeledEncResult.dekEncrypted, legacyDeployEnv);
  assert.strictEqual(decryptedFallback, "legacy_totp_data", "Should fallback to v0 (JWT_SECRET) when primary version fails");

  // 6. Automatic DEK rotation from v0 to v1
  console.log('6. Validating automatic rotation from v0 to v1...');
  const upgradeEnv = {
    JWT_SECRET: "original_jwt_secret_used_as_kek",
    KEK_v1: "brand_new_kek_v1_secret_string"
  };
  const rotatedDek = await rotateEnvelopeDek(legacyEncResult.dekEncrypted, upgradeEnv);
  assert(rotatedDek !== null, "rotateEnvelopeDek should produce a new DEK for v1");

  const parsedRotatedDek = JSON.parse(rotatedDek);
  assert.strictEqual(parsedRotatedDek.kek_version, "v1", "Rotated DEK should now have kek_version = v1");

  // Decrypt using newly rotated DEK and KEK_v1
  const decryptedAfterRotation = await decryptEnvelope(legacyEncResult.dataEncrypted, rotatedDek, upgradeEnv);
  assert.strictEqual(decryptedAfterRotation, "legacy_totp_data", "Rotated DEK should decrypt legacy data with KEK_v1");

  console.log('>>> [TEST] All compatibility tests passed successfully!');
}

runTests().catch(err => {
  console.error('>>> [TEST ERROR]', err);
  process.exit(1);
});
