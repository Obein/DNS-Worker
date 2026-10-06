/**
 * @file e2ee.ts
 * @description Backward-compatible facade for Client-side End-to-End Encryption (E2EE) Service.
 * Re-exports the modular architecture implemented in ./e2ee/*.
 */

export { e2ee, E2eeService } from "./e2ee/index";
export type {
  ProfileE2eeStatus,
  EncryptedPayload,
  CompactEncryptedLogPayload,
  UnlockedPrivateKey,
  SensitiveLogData,
  DerivedPasskeyKek,
  WrappedRecoveryKey
} from "./e2ee/index";
