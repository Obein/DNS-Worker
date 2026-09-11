export class ApiError extends Error {
  status: number;
  bodyText: string;
  constructor(status: number, bodyText: string) {
    super(bodyText);
    this.status = status;
    this.bodyText = bodyText;
    this.name = "ApiError";
  }
}

export interface AuthConfig {
  turnstile_site_key?: string | null;
  turnstile_enabled_login?: boolean;
  turnstile_enabled_signup?: boolean;
  optional_session_expiration_days?: number;
}

export interface PreloginPayload {
  username: string;
  turnstileToken: string | null;
}

export interface PreloginResponse {
  requires_password: boolean;
  requires_totp: boolean;
  has_passkey?: boolean;
  passkey_options?: any;
  password_version?: number;
  nonce?: string;
  serverSalt?: string | null;
}

export interface LoginPayload {
  password?: string;
  recoveryKey?: string;
  totpTokenHash?: string;
  totpSalt?: string;
  passkeyAssertion?: any;
  keepLoggedIn?: boolean;
}

export interface LoginResponse {
  accessToken: string;
  needsMigration?: boolean;
}

export interface SignupPayload {
  username: string;
  password: string;
  turnstileToken: string | null;
}

export interface SignupResponse {
  success: boolean;
  accessToken?: string;
}

export async function getAuthConfig(): Promise<AuthConfig> {
  const res = await fetch("/api/auth/config");
  if (!res.ok) throw new ApiError(res.status, await res.text());
  return res.json();
}

export async function checkUsernameDuplicate(username: string): Promise<boolean> {
  const res = await fetch(`/api/auth/check-username?username=${encodeURIComponent(username)}`);
  if (!res.ok) throw new ApiError(res.status, await res.text());
  const data = await res.json() as { exists: boolean };
  return data.exists;
}

export async function prelogin(payload: PreloginPayload): Promise<PreloginResponse> {
  const res = await fetch("/api/auth/prelogin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new ApiError(res.status, await res.text());
  return res.json();
}

export async function login(payload: LoginPayload): Promise<LoginResponse> {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new ApiError(res.status, await res.text());
  return res.json();
}

export async function signup(payload: SignupPayload): Promise<SignupResponse> {
  const res = await fetch("/api/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new ApiError(res.status, await res.text());
  return res.json();
}

export async function logout(): Promise<void> {
  const res = await fetch("/api/auth/logout", { method: "POST" });
  if (!res.ok) throw new ApiError(res.status, await res.text());
}

export async function refresh(): Promise<LoginResponse> {
  const res = await fetch("/api/auth/refresh", { method: "POST" });
  if (!res.ok) throw new ApiError(res.status, await res.text());
  return res.json();
}

export async function getUnlockNonce(): Promise<{ nonce: string; legacy?: boolean }> {
  const res = await fetch("/api/auth/unlock-session", { method: "GET" });
  if (!res.ok) throw new ApiError(res.status, await res.text());
  return res.json();
}

export async function unlockSession(pinHash: string, nonce: string): Promise<void> {
  const res = await fetch("/api/auth/unlock-session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pinHash, nonce })
  });
  if (!res.ok) throw new ApiError(res.status, await res.text());
}

export async function lockSession(): Promise<void> {
  const res = await fetch("/api/auth/lock-session", { method: "POST" });
  if (!res.ok) throw new ApiError(res.status, await res.text());
}

export interface ForgotPasswordInitResponse {
  can_reset: boolean;
  reason?: string;
  recoveryToken?: string;
  has_passkey?: boolean;
  passkey_options?: any;
  has_totp?: boolean;
  has_recovery_keys?: boolean;
}

export interface ForgotPasswordVerifyPayload {
  recoveryToken: string;
  passkeyAssertion?: any;
  totpTokenHash?: string;
  totpSalt?: string;
  recoveryKey?: string;
}

export interface ForgotPasswordVerifyResponse {
  success: boolean;
  resetToken: string;
}

export async function initForgotPassword(username: string, turnstileToken?: string | null): Promise<ForgotPasswordInitResponse> {
  const res = await fetch("/api/auth/forgot-password/init", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, turnstileToken })
  });
  if (!res.ok) throw new ApiError(res.status, await res.text());
  return res.json();
}

export async function verifyForgotPasswordMfa(payload: ForgotPasswordVerifyPayload): Promise<ForgotPasswordVerifyResponse> {
  const res = await fetch("/api/auth/forgot-password/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new ApiError(res.status, await res.text());
  return res.json();
}

export async function resetPasswordWithToken(resetToken: string, newPassword: string): Promise<{ success: boolean }> {
  const res = await fetch("/api/auth/forgot-password/reset", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ resetToken, newPassword })
  });
  if (!res.ok) throw new ApiError(res.status, await res.text());
  return res.json();
}
