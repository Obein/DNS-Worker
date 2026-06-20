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
}

export interface PreloginPayload {
  username: string;
  turnstileToken: string | null;
}

export interface PreloginResponse {
  requires_password: boolean;
  requires_totp: boolean;
}

export interface LoginPayload {
  password?: string;
  recoveryKey?: string;
  totpTokenHash?: string;
  totpSalt?: string;
}

export interface LoginResponse {
  accessToken: string;
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
