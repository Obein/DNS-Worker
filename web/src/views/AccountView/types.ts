export interface UserInfo {
  id: string;
  username: string;
  role: 'admin' | 'user';
  created_at?: number;
  totp_enabled?: boolean;
  totp_skip_password?: boolean;
  last_active_at?: number;
  last_resolve_at?: number;
}

export interface ActivityEntry {
  id: number;
  action: string;
  ip_address: string | null;
  user_agent: string | null;
  timestamp: number;
  extra: string | null;
}

export interface SessionInfo {
  id: string;
  ip_address: string | null;
  user_agent: string | null;
  created_at: number;
  expires_at: number;
  is_current: boolean;
}
