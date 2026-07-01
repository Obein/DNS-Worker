import type {
  Profile,
  AccessPoint,
  LogEntry,
  Rule,
  FilterList,
  GlobalProfileSettings,
  TestResponse
} from "./types";

/**
 * 包装 fetch 方法，当请求 Profile 相关接口遇到 404 (不存在或无权限) 时，直接引导前端至 404 界面
 */
async function profileFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init);
  if (res.status === 404) {
    window.location.href = "/404";
  }
  return res;
}

export async function getProfiles(): Promise<Profile[]> {
  const res = await profileFetch("/api/profiles");
  if (!res.ok) throw new Error("Failed to fetch profiles");
  return res.json();
}

export async function getProfileDetails(profileId: string): Promise<Profile> {
  const res = await profileFetch(`/api/profiles/${profileId}`);
  if (!res.ok) throw new Error("Failed to fetch profile details");
  return res.json();
}

export async function createProfile(name: string): Promise<Profile> {
  const res = await profileFetch("/api/profiles", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name })
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function deleteProfile(id: string): Promise<void> {
  const res = await profileFetch(`/api/profiles/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await res.text());
}

export async function updateProfileSettings(profileId: string, settings: GlobalProfileSettings): Promise<void> {
  const res = await profileFetch(`/api/profiles/${profileId}/settings`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings)
  });
  if (!res.ok) throw new Error(await res.text());
}

export async function getProfileLists(profileId: string): Promise<FilterList[]> {
  const res = await profileFetch(`/api/profiles/${profileId}/lists`);
  if (!res.ok) throw new Error("Failed to fetch lists");
  return res.json();
}

export async function toggleProfileList(profileId: string, listId: number, enabled: boolean): Promise<void> {
  const res = await profileFetch(`/api/profiles/${profileId}/lists/${listId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled })
  });
  if (!res.ok) throw new Error(await res.text());
}

export async function addCustomProfileList(profileId: string, url: string): Promise<void> {
  const res = await profileFetch(`/api/profiles/${profileId}/lists`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url })
  });
  if (!res.ok) throw new Error(await res.text());
}

export async function deleteCustomProfileList(profileId: string, listId: number): Promise<void> {
  const res = await profileFetch(`/api/profiles/${profileId}/lists`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: listId })
  });
  if (!res.ok) throw new Error(await res.text());
}

export async function syncProfileLists(profileId: string): Promise<void> {
  const res = await profileFetch(`/api/profiles/${profileId}/lists/sync`, {
    method: "POST"
  });
  if (!res.ok) throw new Error(await res.text());
}

export async function getProfileRules(profileId: string): Promise<Rule[]> {
  const res = await profileFetch(`/api/profiles/${profileId}/rules`);
  if (!res.ok) throw new Error("Failed to fetch rules");
  return res.json();
}

export async function addProfileRule(profileId: string, rule: Omit<Rule, "id">): Promise<void> {
  const res = await profileFetch(`/api/profiles/${profileId}/rules`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(rule)
  });
  if (!res.ok) throw new Error(await res.text());
}

export async function updateProfileRule(profileId: string, rule: Rule): Promise<void> {
  const res = await profileFetch(`/api/profiles/${profileId}/rules`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(rule)
  });
  if (!res.ok) throw new Error(await res.text());
}

export async function deleteProfileRule(profileId: string, ruleId: number): Promise<void> {
  const res = await profileFetch(`/api/profiles/${profileId}/rules`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: ruleId })
  });
  if (!res.ok) throw new Error(await res.text());
}

export async function getProfileAccessPoints(profileId: string): Promise<AccessPoint[]> {
  const res = await profileFetch(`/api/profiles/${profileId}/access_points`);
  if (!res.ok) throw new Error("Failed to fetch access points");
  return res.json();
}

export async function addProfileAccessPoint(profileId: string, name: string): Promise<AccessPoint> {
  const res = await profileFetch(`/api/profiles/${profileId}/access_points`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name })
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function deleteProfileAccessPoint(profileId: string, apId: string): Promise<void> {
  const res = await profileFetch(`/api/profiles/${profileId}/access_points/${apId}`, {
    method: "DELETE"
  });
  if (!res.ok) throw new Error(await res.text());
}

export async function renameProfileAccessPoint(profileId: string, apId: string, name: string): Promise<void> {
  const res = await profileFetch(`/api/profiles/${profileId}/access_points/${apId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name })
  });
  if (!res.ok) throw new Error(await res.text());
}

export async function rotateProfileAccessPointToken(profileId: string, apId: string): Promise<{ token: string }> {
  const res = await profileFetch(`/api/profiles/${profileId}/access_points/${apId}/rotate_token`, {
    method: "POST"
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getProfileLogs(profileId: string, queryParams: string, options?: { signal?: AbortSignal }): Promise<LogEntry[]> {
  const query = queryParams.startsWith("?") ? queryParams.slice(1) : queryParams;
  const res = await profileFetch(`/api/profiles/${profileId}/logs?${query}`, { signal: options?.signal });
  if (!res.ok) throw new Error("Failed to fetch logs");
  return res.json();
}

export async function exportProfileLogs(profileId: string, queryParams: string): Promise<any[]> {
  const query = queryParams.startsWith("?") ? queryParams.slice(1) : queryParams;
  const res = await profileFetch(`/api/profiles/${profileId}/logs/export?${query}`);
  if (!res.ok) throw new Error("Failed to export logs");
  return res.json();
}

export async function getProfileLogDetails(profileId: string, logId: number, options?: { signal?: AbortSignal }): Promise<LogEntry> {
  const res = await profileFetch(`/api/profiles/${profileId}/logs/${logId}`, { signal: options?.signal });
  if (!res.ok) throw new Error("Failed to fetch log details");
  return res.json();
}

export async function clearProfileLogs(profileId: string): Promise<void> {
  const res = await profileFetch(`/api/profiles/${profileId}/logs`, {
    method: "DELETE"
  });
  if (!res.ok) throw new Error(await res.text());
}

export async function getProfileAnalytics(profileId: string, type: string, queryParams: string, options?: { signal?: AbortSignal }): Promise<any> {
  const query = queryParams.startsWith("?") ? queryParams.slice(1) : queryParams;
  const res = await profileFetch(`/api/profiles/${profileId}/analytics/${type}?${query}`, { signal: options?.signal });
  if (!res.ok) throw new Error(`Failed to fetch analytics for ${type}`);
  return res.json();
}

export async function testResolution(profileId: string, payload: { domain: string; type: string }): Promise<TestResponse> {
  const res = await profileFetch(`/api/profiles/${profileId}/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error("Resolution test failed");
  return res.json();
}

export async function renameProfile(profileId: string, name: string): Promise<void> {
  const res = await profileFetch(`/api/profiles/${profileId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name })
  });
  if (!res.ok) throw new Error(await res.text());
}
