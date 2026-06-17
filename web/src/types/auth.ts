export interface Profile {
  id: string;
  name: string;
  profile_key?: string; // App.tsx also references profile_key
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
