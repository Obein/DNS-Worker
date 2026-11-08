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

export interface DatabaseMigrationStats {
  completed: boolean;
  totalAvailable: number;
  appliedCount: number;
  pendingCount: number;
  lastApplied: string | null;
  pendingFiles: string[];
}

export interface DatabaseStatusResponse {
  databaseService: string;
  isTurso: boolean;
  configured: boolean;
  migrations: DatabaseMigrationStats | null;
}

export interface RunMigrationsResponse {
  success: boolean;
  appliedCount: number;
  message?: string;
  stats?: DatabaseMigrationStats;
}

export async function getDatabaseStatus(): Promise<DatabaseStatusResponse> {
  const res = await fetch("/api/admin/database");
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function runDatabaseMigrations(): Promise<RunMigrationsResponse> {
  const res = await fetch("/api/admin/database/migrate", {
    method: "POST"
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export interface DistributeFilterResponse {
  success: boolean;
  url: string;
  totalUsers: number;
  addedCount: number;
  skippedCount: number;
  failedCount: number;
  addedUsernames: string[];
  skippedUsernames: string[];
  failedUsernames: string[];
  affectedProfilesCount: number;
}

export async function distributeFilter(url: string): Promise<DistributeFilterResponse> {
  const res = await fetch("/api/admin/distribute-filter", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url })
  });
  if (!res.ok) {
    const text = await res.text();
    try {
      const json = JSON.parse(text);
      if (json.error) throw new Error(json.error);
    } catch {
      // fallback to raw text
    }
    throw new Error(text);
  }
  return res.json();
}

export interface DistributedFilterItem {
  url: string;
  profileCount: number;
  userCount: number;
  usernames: string[];
}

export interface RevokeFilterResponse {
  success: boolean;
  url: string;
  revokedCount: number;
  affectedProfilesCount: number;
  affectedUserCount: number;
  affectedUsernames: string[];
}

export async function getDistributedFilters(): Promise<DistributedFilterItem[]> {
  const res = await fetch("/api/admin/distribute-filter");
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function revokeDistributedFilter(url: string): Promise<RevokeFilterResponse> {
  const res = await fetch("/api/admin/distribute-filter", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url })
  });
  if (!res.ok) {
    const text = await res.text();
    try {
      const json = JSON.parse(text);
      if (json.error) throw new Error(json.error);
    } catch {
      // fallback to raw text
    }
    throw new Error(text);
  }
  return res.json();
}
