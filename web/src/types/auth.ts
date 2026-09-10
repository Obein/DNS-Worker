export interface Profile {
  id: string;
  name: string;
  profile_key?: string;
  owner_id?: string;
  settings?: string;
  created_at?: number;
  updated_at?: number;
}

export interface UserInfo {
  id: string;
  username: string;
  role: "admin" | "user";
  timezone?: string | null;
  locale?: string | null;
  password_version?: number;
  pin_enabled?: boolean;
  session_lock_timeout?: number;
  max_log_retention_days?: number;
}

export interface AccessPoint {
  id: string;
  profile_id: string;
  name: string;
  token: string;
  created_at: number;
}

export interface Passkey {
  id: string;
  user_id: string;
  name: string;
  credential_id: string;
  public_key: string;
  algorithm: number;
  sign_count: number;
  transports?: string | null;
  aaguid?: string | null;
  created_at: number;
  last_used_at?: number | null;
}
