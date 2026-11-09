import { User } from "../../types";
import { StoredRecoveryKeyItem } from "../../lib/totp";

/**
 * Detailed database representation of a user record, including raw/encrypted secrets and DEK info.
 */
export interface UserRecord extends User {
  hashed_password: string;
  totp_secret?: string | null;
  totp_secret_encrypted?: string | null;
  totp_secret_dek?: string | null;
  totp_recovery_keys?: string | null;
  totp_recovery_keys_encrypted?: string | null;
  totp_recovery_keys_dek?: string | null;
}

/**
 * Options for creating a new user account.
 */
export interface CreateUserOptions {
  id: string;
  username: string;
  passwordHash: string;
  role: string;
  timezone?: string | null;
  locale?: string | null;
  passwordVersion?: number;
}

/**
 * Result structure returned by the inactivity policy batch cleanup.
 */
export interface InactivityPolicyResult {
  clearedProfiles: number;
  deletedUsers: number;
  purgedLogsCount?: number;
}

/**
 * Type representing a stored recovery key item (string hash or StoredRecoveryKeyItem object).
 */
export type StoredRecoveryKey = string | StoredRecoveryKeyItem | { key?: string; hash?: string; [key: string]: any };
