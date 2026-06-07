export interface Profile {
  id: string;
  name: string;
  profile_key?: string; // App.tsx also references profile_key
}

export interface UserInfo {
  id: string;
  username: string;
  role: "admin" | "user";
}
