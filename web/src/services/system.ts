import type { ClientInfo } from "./types";

export interface SubstituteInfo {
  ip: string | null;
  ipv6: string | null;
}

export interface TraceInfo {
  colo: string;
  raw: string;
}

export async function getClientInfo(): Promise<ClientInfo> {
  const res = await fetch("/api/clientinfo");
  if (!res.ok) throw new Error("Failed to fetch client info");
  return res.json();
}

export async function getRegions(): Promise<Record<string, any>> {
  const res = await fetch("/api/regions");
  if (!res.ok) throw new Error("Failed to fetch regions");
  return res.json();
}

export async function getSubstituteInfo(): Promise<SubstituteInfo> {
  const res = await fetch("/api/substitute");
  if (!res.ok) throw new Error("Failed to fetch substitute info");
  return res.json();
}

export async function getTraceInfo(): Promise<TraceInfo | null> {
  try {
    const res = await fetch("/cdn-cgi/trace");
    if (!res.ok) return null;
    const text = await res.text();
    const traceLines = text.split("\n");
    const data: Record<string, string> = {};
    for (const line of traceLines) {
      const eqIdx = line.indexOf("=");
      if (eqIdx !== -1) {
        const key = line.slice(0, eqIdx).trim();
        const val = line.slice(eqIdx + 1).trim();
        data[key] = val;
      }
    }
    return { colo: data["colo"] || "UNKNOWN", raw: text };
  } catch (e) {
    console.warn("Failed to fetch /cdn-cgi/trace:", e);
    return null;
  }
}

export async function getMapTopology(): Promise<any> {
  const res = await fetch("/world-110m.json");
  if (!res.ok) throw new Error("Failed to load map topology");
  return res.json();
}

export async function queryDnsJson(server: string, name: string, type: string): Promise<any> {
  const res = await fetch(`https://${server}/dns-query?name=${encodeURIComponent(name)}&type=${type}`, {
    headers: { Accept: "application/dns-json" },
  });
  if (!res.ok) throw new Error(`DoH query failed: ${res.statusText}`);
  return res.json();
}

export async function getPresetUpstreams(): Promise<any[]> {
  const res = await fetch("/api/presets/upstreams");
  if (!res.ok) throw new Error("Failed to fetch preset upstreams");
  return res.json();
}

export async function getPresetFilters(): Promise<any[]> {
  const res = await fetch("/api/presets/filters");
  if (!res.ok) throw new Error("Failed to fetch preset filters");
  return res.json();
}

