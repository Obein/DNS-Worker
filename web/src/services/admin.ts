import type { UserInfo } from "./types";

export interface CreateUserPayload {
  username: string;
  password?: string;
  role?: "admin" | "user";
}

export async function getUsers(): Promise<UserInfo[]> {
  const res = await fetch("/api/admin/users");
  if (!res.ok) throw new Error("Failed to fetch users");
  return res.json();
}

export async function createUser(payload: CreateUserPayload): Promise<void> {
  const res = await fetch("/api/admin/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error(await res.text());
}

export async function deleteUser(id: string): Promise<void> {
  const res = await fetch(`/api/admin/users/${id}`, {
    method: "DELETE"
  });
  if (!res.ok) throw new Error(await res.text());
}

export async function getSystemSettings(): Promise<Record<string, string>> {
  const res = await fetch("/api/admin/settings");
  if (!res.ok) throw new Error("Failed to fetch system settings");
  return res.json();
}

export async function updateSystemSettings(settings: Record<string, string>): Promise<void> {
  const res = await fetch("/api/admin/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings)
  });
  if (!res.ok) throw new Error(await res.text());
}
