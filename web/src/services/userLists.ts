import { ApiError } from "./auth";

export interface UserList {
  id: number;
  user_id: string;
  url: string;
  is_system: number; // 0 = user, 1 = system
  enabled: boolean;
  created_at: number;
  last_synced_at?: number | null;
  sync_error?: string | null;
  etag?: string | null;
  last_modified?: number | null;
}

export async function getUserLists(): Promise<UserList[]> {
  const res = await fetch("/api/account/user-lists");
  if (!res.ok) throw new ApiError(res.status, await res.text());
  return res.json();
}

export async function addUserList(url: string): Promise<{ success: boolean; list: UserList }> {
  const res = await fetch("/api/account/user-lists", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url })
  });
  if (!res.ok) {
    const errorText = await res.text();
    let msg = errorText;
    try {
      const parsed = JSON.parse(errorText);
      if (parsed.error) msg = parsed.error;
    } catch {}
    throw new ApiError(res.status, msg);
  }
  return res.json();
}

export async function toggleUserList(id: number, enabled: boolean): Promise<void> {
  const res = await fetch(`/api/account/user-lists/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled })
  });
  if (!res.ok) throw new ApiError(res.status, await res.text());
}

export async function deleteUserList(id: number): Promise<void> {
  const res = await fetch(`/api/account/user-lists/${id}`, {
    method: "DELETE"
  });
  if (!res.ok) throw new ApiError(res.status, await res.text());
}
