import { Env } from '../types';
import { cacheUtils } from '../utils/cache';
import { getPresetEchFrontingDomains } from '../utils/ech/constants';
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

    const country = cf?.country || request.headers.get("CF-IPCountry") || "UNKNOWN";
    const region = cf?.region || request.headers.get("CF-Region") || "UNKNOWN";
    const city = cf?.city || request.headers.get("CF-IPCity") || "UNKNOWN";
    const timezone = cf?.timezone || request.headers.get("CF-Timezone") || "UNKNOWN";
    const asn = cf?.asn ? Number(cf.asn) : (request.headers.get("CF-ASN") ? Number(request.headers.get("CF-ASN")) : 0);
    const asOrganization = cf?.asOrganization || request.headers.get("CF-AS-Org") || "UNKNOWN";

    const isServerfull = Boolean(
      env.SERVERFULL_DEFAULT_PROFILE_KEY !== undefined ||
      env.SERVERFULL_HOST !== undefined ||
      env.SERVERFULL_DOT_DOMAIN !== undefined ||
      env.SERVERFULL_HTTP_PORT !== undefined ||
      env.SERVERFULL_HTTPS_PORT !== undefined
    );

    return new Response(JSON.stringify({
      ip: clientIp,
      country,
      region,
      city,
      timezone,
      asn,
      asOrganization,
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
    if (!domain) {
      return new Response("Missing domain", { status: 400 });
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
    const targetIp = url.searchParams.get('ip') || request.headers.get("CF-Connecting-IP") || "127.0.0.1";
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
        flag: { emoji: '🏠' }
      }), { headers: { 'Content-Type': 'application/json' } });
    }

    try {
      const geoRes = await fetch(`https://ipwho.is/${encodeURIComponent(targetIp)}`, {
        signal: AbortSignal.timeout(3000)
      });
      if (geoRes.ok) {
        const data = await geoRes.json();
        return new Response(JSON.stringify(data), {
          headers: { 'Content-Type': 'application/json' }
        });
      }
    } catch (e) {
      console.warn(`[System API] Failed resolving geoip for ${targetIp}:`, e);
    }
    return new Response(JSON.stringify({ success: false, ip: targetIp }), {
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
            const data = await res.json() as any;
            if (Array.isArray(data?.Answer) && data.Answer.length > 0) {
              const typeNum = type === 'A' ? 1 : 28;
              return data.Answer
                .filter((ans: any) => ans.type === typeNum && typeof ans.data === 'string')
                .map((ans: any) => ans.data as string);
            }
          }
        } catch {
          // Continue to next server
        }
      }
      return [];
    };

    try {
      const [ipv4, ipv6] = await Promise.all([
        resolveDoH('A'),
        resolveDoH('AAAA')
      ]);
      return new Response(JSON.stringify({ ipv4, ipv6 }), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (e) {
      return new Response(JSON.stringify({ ipv4: [], ipv6: [], error: String(e) }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  return new Response("Not Found", { status: 404 });
}
