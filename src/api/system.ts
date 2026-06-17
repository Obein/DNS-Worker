import { Env } from '../types';
import { cacheUtils } from '../utils/cache';

/**
 * Handles system/utility routes like /api/clientinfo and /api/substitute
 */
export async function handleSystemRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const cache = (caches as any).default;

  if (url.pathname === '/api/clientinfo') {
    const clientIp = request.headers.get("CF-Connecting-IP") || "127.0.0.1";
    const connectedProfileId = await cacheUtils.get<string>(cache, `active_dns:${clientIp}`);
    const cf = (request as any).cf;

    return new Response(JSON.stringify({
      ip: clientIp,
      country: cf?.country || "UNKNOWN",
      region: cf?.region || "UNKNOWN",
      city: cf?.city || "UNKNOWN",
      timezone: cf?.timezone || "UNKNOWN",
      asn: cf?.asn || 0,
      asOrganization: cf?.asOrganization || "UNKNOWN",
      connectedProfileId: connectedProfileId || null,
      substituteDomain: env.SUBSTITUTE_DOMAIN || "pages.dev"
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
    return new Response(JSON.stringify(regions), { headers: { 'Content-Type': 'application/json' } });
  }

  if (url.pathname === '/api/substitute') {
    const subDomain = env.SUBSTITUTE_DOMAIN || "pages.dev";
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

  return new Response("Not Found", { status: 404 });
}
