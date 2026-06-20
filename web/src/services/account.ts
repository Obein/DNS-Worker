import type { UserInfo, SessionInfo, ActivityEntry } from "./types";

export interface UpdatePasswordPayload {
  oldPassword?: string;
  newPassword?: string;
  totpTokenHash?: string;
  totpSalt?: string;
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
  if (!res.ok) throw new Error("Failed to fetch account info");
  return res.json();
}

export async function updateMe(payload: { username?: string | null; timezone?: string | null; locale?: string | null }): Promise<UserInfo> {
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
