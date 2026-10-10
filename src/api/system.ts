import { Env } from '../types';
import { cacheUtils } from '../utils/cache';
import { getPresetEchFrontingDomains } from '../utils/ech/constants';
import { fetchGeoIP } from '../utils/geoip';
import { isPublicInternetIP } from '../utils/validator';
import {
  DEFAULT_PRESET_UPSTREAMS,
  DEFAULT_PRESET_EXTERNAL_FILTERS,
  DEFAULT_IP_REGION_CN,
  DEFAULT_SUBSTITUTE_DOMAIN
} from '../constants/presets';

/**
 * Handles system/utility routes like /api/clientinfo and /api/substitute
 */
export async function handleSystemRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const cache = typeof caches !== 'undefined' ? (caches as any).default : null;

  if (url.pathname === '/api/clientinfo') {
    const clientIp = request.headers.get("CF-Connecting-IP") || "127.0.0.1";
    const connectedProfileId = await cacheUtils.get<string>(cache, `active_dns:${clientIp}`);
    const cf = (request as any).cf;

    let country = cf?.country || request.headers.get("CF-IPCountry") || "";
    let countryCode = country;
    let region = cf?.region || request.headers.get("CF-Region") || "";
    let city = cf?.city || request.headers.get("CF-IPCity") || "";
    let timezone = cf?.timezone || request.headers.get("CF-Timezone") || "";
    let asn = cf?.asn ? Number(cf.asn) : (request.headers.get("CF-ASN") ? Number(request.headers.get("CF-ASN")) : 0);
    let asOrganization = cf?.asOrganization || request.headers.get("CF-AS-Org") || "";

    // If geolocation is missing (e.g. Serverfull mode or direct reverse proxy), resolve via GeoIP
    if (!country || country === "UNKNOWN" || country === "UN" || country === "XX") {
      if (!isPublicInternetIP(clientIp)) {
        country = "Private Network";
        countryCode = "LAN";
        region = "LAN";
        city = "Local";
        timezone = "UNKNOWN";
        asOrganization = "Private Network";
      } else {
        try {
          const geo = await fetchGeoIP(clientIp);
          if (geo) {
            country = geo.country || geo.country_code || "UNKNOWN";
            countryCode = geo.country_code || "UNKNOWN";
            region = geo.region || "UNKNOWN";
            city = geo.city || "UNKNOWN";
            timezone = geo.timezone || "UNKNOWN";
            asOrganization = geo.org || geo.isp || "UNKNOWN";
            if (!asn && geo.as) {
              const asnMatch = geo.as.match(/^AS(\d+)/i);
              if (asnMatch) asn = Number(asnMatch[1]);
            }
          }
        } catch (e) {
          console.warn(`[ClientInfo] Failed resolving geoip for ${clientIp}:`, e);
        }
      }
    }

    const isServerfull = Boolean(
      env.SERVERFULL_DEFAULT_PROFILE_KEY !== undefined ||
      env.SERVERFULL_HOST !== undefined ||
      env.SERVERFULL_DOT_DOMAIN !== undefined ||
      env.SERVERFULL_HTTP_PORT !== undefined ||
      env.SERVERFULL_HTTPS_PORT !== undefined
    );

    return new Response(JSON.stringify({
      ip: clientIp,
      country: country || "UNKNOWN",
      countryCode: countryCode || undefined,
      region: region || "UNKNOWN",
      city: city || "UNKNOWN",
      timezone: timezone || "UNKNOWN",
      asn: asn || 0,
      asOrganization: asOrganization || "UNKNOWN",
      connectedProfileId: connectedProfileId || null,
      substituteDomain: env.SUBSTITUTE_DOMAIN || DEFAULT_SUBSTITUTE_DOMAIN,
      dotDomain: env.SERVERFULL_DOT_DOMAIN || env.DOT_DOMAIN || null,
      isServerfull,
      mode: isServerfull ? 'serverfull' : 'cloudflare'
    }), { headers: { 'Content-Type': 'application/json' } });
  }

  if (url.pathname === '/api/regions') {
    const regions: Record<string, any> = {};
    for (const [key, value] of Object.entries(env)) {
      if (key.startsWith('IP_REGION_') && typeof value === 'string') {
        try {
          const regionKey = key.replace('IP_REGION_', '');
          let cleanVal = value.trim();
          cleanVal = cleanVal
            .replace(/^"""|"""$/g, "")
            .replace(/^"|"$/g, "")
            .replace(/^'|'$/g, "")
            .trim();
          regions[regionKey] = JSON.parse(cleanVal);
        } catch (e) {
          // Ignore parse errors for malformed env variables
        }
      }
    }
    if (Object.keys(regions).length === 0) {
      regions['CN'] = DEFAULT_IP_REGION_CN;
    }
    return new Response(JSON.stringify(regions), { headers: { 'Content-Type': 'application/json' } });
  }

  if (url.pathname === '/api/substitute') {
    const subDomain = env.SUBSTITUTE_DOMAIN || DEFAULT_SUBSTITUTE_DOMAIN;
    let substituteDomainIp: string | null = null;
    let substituteDomainIpv6: string | null = null;

    const resolveRecord = async (type: 'A' | 'AAAA'): Promise<string | null> => {
      const dnsServers = [
        'https://cloudflare-dns.com/dns-query',
        'https://1.1.1.1/dns-query'
      ];
      for (const server of dnsServers) {
        try {
          const res = await fetch(`${server}?name=${subDomain}&type=${type}`, {
            headers: { 'Accept': 'application/dns-json' },
            signal: AbortSignal.timeout(3000)
          });
          if (res.ok) {
            const data = await res.json() as any;
            if (data?.Answer?.length > 0) {
              const record = data.Answer.find((a: any) => a.type === (type === 'A' ? 1 : 28));
              if (record?.data) {
                return record.data;
              }
            }
          }
        } catch (e) {
          console.error(`[Substitute Resolve] Failed resolving ${type} via ${server}:`, e);
        }
      }
      return null;
    };

    try {
      const [ip, ipv6] = await Promise.all([
        resolveRecord('A'),
        resolveRecord('AAAA')
      ]);
      substituteDomainIp = ip;
      substituteDomainIpv6 = ipv6;
    } catch (e) {
      console.error('[Substitute API] Error resolving substitute domain:', e);
    }

    return new Response(JSON.stringify({
      ip: substituteDomainIp,
      ipv6: substituteDomainIpv6
    }), { headers: { 'Content-Type': 'application/json' } });
  }

  if (url.pathname === '/api/presets/upstreams') {
    let upstreams = DEFAULT_PRESET_UPSTREAMS;
    if (env.PRESET_UPSTREAMS) {
      try {
        const parsed = JSON.parse(env.PRESET_UPSTREAMS);
        if (Array.isArray(parsed) && parsed.length > 0) {
          upstreams = parsed;
        }
      } catch (e) {
        console.warn("[System API] Failed to parse PRESET_UPSTREAMS from env:", e);
      }
    }
    return new Response(JSON.stringify(upstreams), { headers: { 'Content-Type': 'application/json' } });
  }

  if (url.pathname === '/api/presets/filters') {
    let filters = DEFAULT_PRESET_EXTERNAL_FILTERS;
    if (env.PRESET_EXTERNAL_FILTERS) {
      try {
        const parsed = JSON.parse(env.PRESET_EXTERNAL_FILTERS);
        if (Array.isArray(parsed) && parsed.length > 0) {
          filters = parsed;
        }
      } catch (e) {
        console.warn("[System API] Failed to parse PRESET_EXTERNAL_FILTERS from env:", e);
      }
    }
    return new Response(JSON.stringify(filters), { headers: { 'Content-Type': 'application/json' } });
  }

  if (url.pathname === '/api/presets/ech-fronting-domains') {
    const domains = getPresetEchFrontingDomains(env);
    return new Response(JSON.stringify(domains), { headers: { 'Content-Type': 'application/json' } });
  }

  if (url.pathname.startsWith('/api/icon/')) {
    const domain = url.pathname.replace('/api/icon/', '');
    if (!domain || !/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(domain) || domain.includes('..') || domain.includes('/') || domain.includes('\\')) {
      return new Response("Invalid domain format", { status: 400 });
    }
    
    // Proxy request to DuckDuckGo
    const targetUrl = `https://icons.duckduckgo.com/ip3/${domain}`;
    try {
      const iconRes = await fetch(targetUrl);
      
      const newHeaders = new Headers(iconRes.headers);
      newHeaders.set('Cache-Control', 'public, max-age=2592000'); // 30 days
      newHeaders.delete('Access-Control-Allow-Origin'); // Ensure no upstream wildcard bleeds through
      
      return new Response(iconRes.body, {
        status: iconRes.status,
        statusText: iconRes.statusText,
        headers: newHeaders
      });
    } catch (e) {
      return new Response("Error fetching icon", { status: 500 });
    }
  }

  if (url.pathname === '/api/geoip') {
    const rawIp = url.searchParams.get('ip');
    const connectingIp = request.headers.get("CF-Connecting-IP");
    const targetIp = (rawIp || connectingIp || "").trim();

    // Check if explicitly requesting local/private IP
    if (
      targetIp === '127.0.0.1' ||
      targetIp === 'localhost' ||
      targetIp === '::1' ||
      targetIp.startsWith('192.168.') ||
      targetIp.startsWith('10.') ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(targetIp)
    ) {
      return new Response(JSON.stringify({
        success: true,
        ip: targetIp,
        city: 'Local',
        country: 'Private Network',
        flag: { emoji: '🛜' }
      }), { headers: { 'Content-Type': 'application/json' } });
    }

    try {
      // If a specific public target IP was requested, query that IP;
      // otherwise query without IP parameter so ipwho.is resolves the caller's / server's public egress IP.
      const geoUrl = targetIp ? `https://ipwho.is/${encodeURIComponent(targetIp)}` : 'https://ipwho.is/';
      const geoRes = await fetch(geoUrl, {
        signal: AbortSignal.timeout(3500)
      });
      if (geoRes.ok) {
        const data = await geoRes.json();
        return new Response(JSON.stringify(data), {
          headers: { 'Content-Type': 'application/json' }
        });
      }
    } catch (e) {
      console.warn(`[System API] Failed resolving geoip for ${targetIp || 'server'}:`, e);
    }
    return new Response(JSON.stringify({ success: false, ip: targetIp || 'unknown' }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (url.pathname === '/api/resolve') {
    const domain = url.searchParams.get('name') || url.searchParams.get('domain');
    if (!domain) {
      return new Response(JSON.stringify({ error: "Missing domain parameter" }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Direct IPv4 check
    if (/^(\d{1,3}\.){3}\d{1,3}$/.test(domain)) {
      return new Response(JSON.stringify({ ipv4: [domain], ipv6: [] }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Direct IPv6 check
    if (/^([0-9a-fA-F]{0,4}:){1,7}[0-9a-fA-F]{0,4}$/.test(domain)) {
      return new Response(JSON.stringify({ ipv4: [], ipv6: [domain] }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const resolveDoH = async (type: 'A' | 'AAAA'): Promise<string[]> => {
      const servers = ['https://cloudflare-dns.com/dns-query', 'https://1.1.1.1/dns-query'];
      for (const s of servers) {
        try {
          const res = await fetch(`${s}?name=${encodeURIComponent(domain)}&type=${type}`, {
            headers: { Accept: 'application/dns-json' },
            signal: AbortSignal.timeout(3000)
          });
          if (res.ok) {
            const data = (await res.json()) as { Answer?: Array<{ type: number; data: string }> };
            if (Array.isArray(data?.Answer) && data.Answer.length > 0) {
              const typeNum = type === 'A' ? 1 : 28;
              return data.Answer
                .filter((ans) => ans.type === typeNum && typeof ans.data === 'string')
                .map((ans) => ans.data);
            }
          }
        } catch {
          // Continue to next server
        }
      }
      return [];
    };

    try {
      let [ipv4, ipv6] = await Promise.all([
        resolveDoH('A'),
        resolveDoH('AAAA')
      ]);

      // In Node.js / Serverfull runtime, fallback to native DNS resolution if DoH returned empty
      if (ipv4.length === 0 && ipv6.length === 0 && typeof process !== 'undefined' && process.versions?.node) {
        try {
          const dnsPromises = await import('node:dns/promises');
          const [res4, res6] = await Promise.allSettled([
            dnsPromises.resolve4(domain),
            dnsPromises.resolve6(domain)
          ]);
          if (res4.status === 'fulfilled' && Array.isArray(res4.value)) {
            ipv4 = res4.value;
          }
          if (res6.status === 'fulfilled' && Array.isArray(res6.value)) {
            ipv6 = res6.value;
          }
        } catch {
          // Ignore native DNS lookup errors
        }
      }

      return new Response(JSON.stringify({ ipv4, ipv6 }), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (e) {
      console.error('DNS resolve failed:', e);
      return new Response(JSON.stringify({ ipv4: [], ipv6: [], error: 'Internal server error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  return new Response("Not Found", { status: 404 });
}
