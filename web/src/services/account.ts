import type { UserInfo, SessionInfo, ActivityEntry, Passkey } from "./types";
import { ApiError } from "./auth";

export interface UpdatePasswordPayload {
  oldPassword?: string;
  newPassword?: string;
  totpTokenHash?: string;
  totpSalt?: string;
  passkeyAssertion?: any;
}

export interface VerifyIdentityPayload {
  password?: string;
  oldPassword?: string;
  totpTokenHash?: string;
  totpSalt?: string;
  passkeyAssertion?: any;
}

export interface ViewRecoveryKeysResponse {
  has_keys: boolean;
  is_legacy: boolean;
  recovery_keys: string[];
}

export interface RotateRecoveryKeyResponse {
  success: boolean;
  recovery_key: string;
}

export interface TotpConfirmPayload {
  secret: string;
  totpTokenHash: string;
  salt: string;
}

export interface TotpTogglePayload {
  enabled: boolean;
  skipPassword?: boolean;
  code?: string;
}

export async function getMe(): Promise<UserInfo> {
  const res = await fetch("/api/account/me");
  if (!res.ok) throw new ApiError(res.status, await res.text());
  return res.json();
}

export async function updateMe(payload: {
  username?: string | null;
  timezone?: string | null;
  locale?: string | null;
  session_lock_timeout?: number;
}): Promise<UserInfo> {
  const res = await fetch("/api/account/me", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function deleteMe(): Promise<void> {
  const res = await fetch("/api/account/me", { method: "DELETE" });
  if (!res.ok) throw new Error(await res.text());
}

export async function updatePassword(payload: UpdatePasswordPayload): Promise<void> {
  const res = await fetch("/api/account/password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error(await res.text());
}

export async function getSessions(): Promise<SessionInfo[]> {
  const res = await fetch("/api/account/sessions");
  if (!res.ok) throw new Error("Failed to fetch sessions");
  return res.json();
}

export async function revokeSession(id: string): Promise<{ is_current: boolean }> {
  const res = await fetch(`/api/account/sessions/${id}`, {
    method: "DELETE"
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getActivityLog(params: string): Promise<ActivityEntry[]> {
  const res = await fetch(`/api/account/activity?${params}`);
  if (!res.ok) throw new Error("Failed to fetch activity log");
  return res.json();
}

export async function clearLogs(): Promise<void> {
  const res = await fetch("/api/account/logs", { method: "DELETE" });
  if (!res.ok) throw new Error(await res.text());
}

export async function setupTotp(): Promise<{ secret: string; uri: string }> {
  const res = await fetch("/api/account/totp/setup");
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function confirmTotp(payload: TotpConfirmPayload): Promise<{ recovery_keys: string[] }> {
  const res = await fetch("/api/account/totp/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function disableTotp(password: string): Promise<void> {
  const res = await fetch("/api/account/totp", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password })
  });
  if (!res.ok) throw new Error(await res.text());
}

export async function updateTotpSettings(skipPassword: boolean): Promise<void> {
  const res = await fetch("/api/account/totp/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ skip_password: skipPassword })
  });
  if (!res.ok) throw new Error(await res.text());
}

export const updateMfaSettings = updateTotpSettings;

export async function migratePassword(clientHash: string): Promise<void> {
  const res = await fetch("/api/account/migrate-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientHash })
  });
  if (!res.ok) throw new Error(await res.text());
}

export async function setPin(pinHash: string, verificationPayload: { password?: string; totpTokenHash?: string; totpSalt?: string }): Promise<void> {
  const res = await fetch("/api/account/pin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pinHash, ...verificationPayload })
  });
  if (!res.ok) throw new ApiError(res.status, await res.text());
}

export async function clearPin(verificationPayload: { password?: string; totpTokenHash?: string; totpSalt?: string }): Promise<void> {
  const res = await fetch("/api/account/pin", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(verificationPayload)
  });
  if (!res.ok) throw new ApiError(res.status, await res.text());
}

export async function getPasskeys(): Promise<Passkey[]> {
  const res = await fetch("/api/account/passkeys");
  if (!res.ok) throw new ApiError(res.status, await res.text());
  return res.json();
}

export async function getPasskeyRegistrationOptions(): Promise<any> {
  const res = await fetch("/api/account/passkeys/register/options", {
    method: "POST"
  });
  if (!res.ok) throw new ApiError(res.status, await res.text());
  return res.json();
}

export interface VerifyPasskeyResponse {
  success: boolean;
  passkey: Passkey;
  recovery_keys?: string[];
}

export async function verifyPasskeyRegistration(payload: { name: string; credential: any }): Promise<VerifyPasskeyResponse> {
  const res = await fetch("/api/account/passkeys/register/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new ApiError(res.status, await res.text());
  return res.json();
}

export async function renamePasskey(id: string, name: string): Promise<void> {
  const res = await fetch(`/api/account/passkeys/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name })
  });
  if (!res.ok) throw new ApiError(res.status, await res.text());
}

export async function deletePasskey(id: string): Promise<void> {
  const res = await fetch(`/api/account/passkeys/${id}`, {
    method: "DELETE"
  });
  if (!res.ok) throw new ApiError(res.status, await res.text());
}

export async function getPasskeyAuthOptions(): Promise<any> {
  const res = await fetch("/api/account/passkeys/auth-options", {
    method: "POST"
  });
  if (!res.ok) throw new ApiError(res.status, await res.text());
  return res.json();
}

export async function viewRecoveryKeys(payload: VerifyIdentityPayload): Promise<ViewRecoveryKeysResponse> {
  const res = await fetch("/api/account/recovery-keys/view", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new ApiError(res.status, await res.text());
  return res.json();
}

export async function rotateRecoveryKey(payload: VerifyIdentityPayload): Promise<RotateRecoveryKeyResponse> {
  const res = await fetch("/api/account/recovery-keys/rotate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new ApiError(res.status, await res.text());
  return res.json();
}
