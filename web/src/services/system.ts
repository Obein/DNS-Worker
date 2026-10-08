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

export async function getPresetEchFrontingDomains(): Promise<string[]> {
  const res = await fetch("/api/presets/ech-fronting-domains");
  if (!res.ok) throw new Error("Failed to fetch preset ECH fronting domains");
  return res.json();
}

/**
 * Resolves IPv4 and IPv6 addresses for a given domain or IP string.
 * Supports direct IP recognition, Cloudflare DoH, and backend fallback.
 */
export async function resolveDomainDnsIps(domain: string): Promise<{ ipv4: string[]; ipv6: string[] }> {
  const cleanDomain = domain.trim().toLowerCase();
  if (!cleanDomain) {
    return { ipv4: [], ipv6: [] };
  }

  // 1. Direct IPv4 check
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(cleanDomain)) {
    return { ipv4: [cleanDomain], ipv6: [] };
  }

  // 2. Direct IPv6 check
  if (/^([0-9a-fA-F]{0,4}:){1,7}[0-9a-fA-F]{0,4}$/.test(cleanDomain)) {
    return { ipv4: [], ipv6: [cleanDomain] };
  }

  // 3. DoH resolution via public servers
  const resolveDoH = async (type: "A" | "AAAA"): Promise<string[]> => {
    const servers = ["cloudflare-dns.com", "1.1.1.1"];
    for (const server of servers) {
      try {
        const data = await queryDnsJson(server, cleanDomain, type);
        if (Array.isArray(data?.Answer) && data.Answer.length > 0) {
          const typeNum = type === "A" ? 1 : 28;
          const records = data.Answer
            .filter((a: any) => a.type === typeNum && typeof a.data === "string")
            .map((a: any) => a.data as string);
          if (records.length > 0) return records;
        }
      } catch {
        // Fallback to next server
      }
    }
    return [];
  };

  try {
    const [ipv4, ipv6] = await Promise.all([
      resolveDoH("A"),
      resolveDoH("AAAA"),
    ]);

    if (ipv4.length > 0 || ipv6.length > 0) {
      return { ipv4, ipv6 };
    }
  } catch {
    // Fallback to backend API
  }

  // 4. Fallback to backend /api/resolve
  try {
    const res = await fetch(`/api/resolve?name=${encodeURIComponent(cleanDomain)}`);
    if (res.ok) {
      const data = await res.json();
      return {
        ipv4: Array.isArray(data.ipv4) ? data.ipv4 : [],
        ipv6: Array.isArray(data.ipv6) ? data.ipv6 : [],
      };
    }
  } catch {
    // Ignore error
  }

  return { ipv4: [], ipv6: [] };
}

/**
 * Fetches geographic location for a domain or IP from the frontend.
 * Queries https://ipwho.is/ directly with fallback to backend /api/geoip.
 */
export async function getDomainGeoLocation(domain: string): Promise<string> {
  const cleanDomain = domain.trim().toLowerCase();
  if (!cleanDomain || cleanDomain === "localhost" || cleanDomain === "127.0.0.1" || cleanDomain === "::1") {
    return "Localhost / 127.0.0.1 🏠";
  }

  if (
    cleanDomain.startsWith("192.168.") ||
    cleanDomain.startsWith("10.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(cleanDomain)
  ) {
    return "Private Network (LAN) 🏠";
  }

  // If it's a domain name, resolve an IP first
  let targetIp = cleanDomain;
  const isIp = /^(\d{1,3}\.){3}\d{1,3}$/.test(cleanDomain) || /^([0-9a-fA-F]{0,4}:){1,7}[0-9a-fA-F]{0,4}$/.test(cleanDomain);
  if (!isIp) {
    const resolved = await resolveDomainDnsIps(cleanDomain);
    if (resolved.ipv4.length > 0) {
      targetIp = resolved.ipv4[0];
    } else if (resolved.ipv6.length > 0) {
      targetIp = resolved.ipv6[0];
    } else {
      return cleanDomain;
    }
  }

  // Query ipwho.is directly from frontend
  try {
    const res = await fetch(`https://ipwho.is/${encodeURIComponent(targetIp)}`, {
      signal: AbortSignal.timeout(3500),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.success) {
        const parts: string[] = [];
        if (data.city) parts.push(data.city);
        if (data.region && data.region !== data.city) parts.push(data.region);
        if (data.country) parts.push(data.country);
        const flag = data.flag?.emoji ? ` ${data.flag.emoji}` : "";
        return (parts.join(", ") || targetIp) + flag;
      }
    }
  } catch {
    // Fallback to backend /api/geoip
  }

  try {
    const res = await fetch(`/api/geoip?ip=${encodeURIComponent(targetIp)}`);
    if (res.ok) {
      const data = await res.json();
      if (data.success) {
        const parts: string[] = [];
        if (data.city) parts.push(data.city);
        if (data.region && data.region !== data.city) parts.push(data.region);
        if (data.country) parts.push(data.country);
        const flag = data.flag?.emoji ? ` ${data.flag.emoji}` : "";
        return (parts.join(", ") || targetIp) + flag;
      }
    }
  } catch {
    // Ignore error
  }

  return targetIp;
}


