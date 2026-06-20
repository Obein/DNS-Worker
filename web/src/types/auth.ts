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
}

export interface AccessPoint {
  id: string;
  profile_id: string;
  name: string;
  token: string;
  created_at: number;
}
