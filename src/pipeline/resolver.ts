import { Context, DNSQuery, ResolutionResult, ProfileSettings } from "../types";
import { LogModel } from "../models/log";
import { fetchGeoIP } from "../utils/geoip";
import { buildResponse, buildResponseMulti, buildDNSQuery, parseDNSAnswer, DNSRecord } from "../utils/dns";
import { dnsCache } from "./cache";
import { connect } from 'cloudflare:sockets';

export const pipelineResolver = {
  async resolve(request: Request, query: DNSQuery, context: Context, settings: ProfileSettings, action: 'PASS', reason?: string): Promise<ResolutionResult> {
    const logModel = new LogModel(context.env.DB);
    let upstreamUrl = settings.upstream[0] || "https://security.cloudflare-dns.com/dns-query";
    const startFetch = Date.now();
    let answer: Uint8Array;
    let upstreamLatency = 0;
    let isClassicDns = !upstreamUrl.startsWith('http');

    // 处理 ECS
    let ecs: string | undefined = "";
    if (settings.ecs?.enabled) {
      const clientIp = request.headers.get("CF-Connecting-IP") || "127.0.0.1";
      ecs = settings.ecs.use_client_ip ? `${clientIp}/${clientIp.includes(':') ? 48 : 24}` : (settings.ecs.ipv4_cidr || settings.ecs.ipv6_cidr);
    }

    try {
      if (isClassicDns) {
        // 经典 DNS 处理 (通过 TCP Socket)
        let host = upstreamUrl.replace('tcp://', '');
        let port = 53;
        if (host.includes(':')) {
          const parts = host.split(':');
          host = parts[0];
          port = parseInt(parts[1]) || 53;
        }

        const socket = connect({ hostname: host, port: port });
        const writer = socket.writable.getWriter();
        const reader = socket.readable.getReader();

        // TCP DNS 需要 2 字节长度前缀 (RFC 1035)
        const tcpQuery = new Uint8Array(query.raw.length + 2);
        tcpQuery[0] = (query.raw.length >> 8) & 0xff;
        tcpQuery[1] = query.raw.length & 0xff;
        tcpQuery.set(query.raw, 2);

        await writer.write(tcpQuery);
        writer.releaseLock();

        // 读取响应长度，添加 5 秒超时
        const timeoutPromise = new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error("TCP Upstream Timeout")), 5000)
        );
        const result = await Promise.race([reader.read(), timeoutPromise]);

        if (!result.value) throw new Error("Socket closed");
        
        let responseBuffer = result.value;
        if (responseBuffer.length < 2) throw new Error("Invalid TCP response");
        
        const responseLength = (responseBuffer[0] << 8) | responseBuffer[1];
        answer = responseBuffer.slice(2, 2 + responseLength);
        
        await socket.close();
        upstreamLatency = Date.now() - startFetch;
      } else {
        // DoH 处理
        let finalUrl = upstreamUrl;
        if (ecs) {
          const targetUrl = new URL(upstreamUrl);
          targetUrl.searchParams.set('edns_client_subnet', ecs);
          finalUrl = targetUrl.toString();
        }

        const response = await fetch(finalUrl, {
          method: "POST",
          headers: { 
            "Accept": "application/dns-message",
            "Content-Type": "application/dns-message", 
            "User-Agent": "Obex-DNS/1.0",
            "Connection": "keep-alive"
          },
          body: query.raw,
          signal: AbortSignal.timeout(5000)
        });

        if (!response.ok) throw new Error(`Upstream HTTP ${response.status}`);
        const answerBuffer = await response.arrayBuffer();
        answer = new Uint8Array(answerBuffer);
        upstreamLatency = Date.now() - startFetch;
      }

      const parsedAnswers = parseDNSAnswer(answer);
      const minTTL = parsedAnswers.length > 0 ? Math.max(10, Math.min(...parsedAnswers.map(a => a.ttl))) : 60;

      context.ctx.waitUntil((async () => {
        const clientIp = request.headers.get("CF-Connecting-IP") || "127.0.0.1";
        const firstIp = parsedAnswers.find(a => a.type === 'A' || a.type === 'AAAA')?.data;
        let destGeoJson = "";
        if (firstIp) {
          const geo = await fetchGeoIP(firstIp);
          if (geo) destGeoJson = JSON.stringify(geo);
        }

        const latency = Date.now() - context.startTime;
        await logModel.insert({
          profile_id: context.profileId,
          timestamp: Math.floor(Date.now() / 1000),
          client_ip: clientIp,
          geo_country: (request as any).cf?.country || "UN",
          domain: query.name,
          record_type: query.type,
          action,
          reason,
          answer: parsedAnswers.map(a => a.data).join(", "),
          dest_geoip: destGeoJson,
          upstream: upstreamUrl,
          latency,
          ecs
        });

        if (answer.length > 0) {
          dnsCache.set(`${context.profileId}:${query.name}:${query.type}`, {
            answer, ttl: minTTL, action, reason, expiresAt: Date.now() + (minTTL * 1000)
          });
        }
      })());

      return { 
        answer, 
        ttl: minTTL, 
        action, 
        reason, 
        latency: Date.now() - context.startTime, 
        timings: { upstream_fetch: upstreamLatency },
        diagnostics: {
          upstream_url: isClassicDns ? `tcp://${upstreamUrl}` : upstreamUrl,
          method: isClassicDns ? "TCP" : "GET",
          status: 200
        }
      };
    } catch (e: any) {
      return { 
        answer: new Uint8Array(), 
        ttl: 0, 
        action: "FAIL", 
        reason: `Upstream Error: ${e.message}`,
        diagnostics: {
          upstream_url: upstreamUrl,
          method: isClassicDns ? "TCP" : "GET",
          status: 0
        }
      };
    }
  },

  async block(request: Request, query: DNSQuery, context: Context, settings: ProfileSettings, action: 'BLOCK' | 'REDIRECT', reason: string, customAnswer?: string, responseType?: string): Promise<ResolutionResult> {
    const logModel = new LogModel(context.env.DB);
    const clientIp = request.headers.get("CF-Connecting-IP") || "127.0.0.1";
    let answer: Uint8Array;
    let displayAnswer = customAnswer || "";

    if (action === 'REDIRECT' && customAnswer) {
      if (responseType === 'CNAME' && (query.type === 'A' || query.type === 'AAAA')) {
        try {
          // 如果用户查询 A/AAAA，但规则返回 CNAME，我们需要为其补全目标域名的 A/AAAA 记录
          const targetQueryRaw = buildDNSQuery(customAnswer, query.type);
          const targetQuery: DNSQuery = { name: customAnswer, type: query.type, raw: targetQueryRaw };
          const upstreamRes = await pipelineResolver.resolve(request, targetQuery, context, settings, "PASS");
          
          if (upstreamRes.answer && upstreamRes.answer.length > 0) {
            const parsedTargetAnswers = parseDNSAnswer(upstreamRes.answer);
            const records: DNSRecord[] = [{ type: 'CNAME', value: customAnswer, ttl: 60 }];
            
            for (const a of parsedTargetAnswers) {
              if (a.type === query.type || a.type === 'CNAME') {
                records.push({ name: a.name, type: a.type, value: a.data, ttl: a.ttl });
              }
            }
            answer = buildResponseMulti(query.raw, records, 0);
          } else {
            answer = buildResponse(query.raw, responseType, customAnswer);
          }
        } catch (e) {
          console.error("CNAME resolution failed:", e);
          answer = buildResponse(query.raw, responseType, customAnswer);
        }
      } else {
        answer = buildResponse(query.raw, responseType || query.type, customAnswer);
      }
    } else {
      // 处理拦截模式 (BLOCK)
      const mode = settings.block_mode || 'NULL_IP';

      if (mode === 'NXDOMAIN') {
        answer = buildResponse(query.raw, query.type, "", 3600, 3);
        displayAnswer = "NXDOMAIN";
      } else if (mode === 'NODATA') {
        answer = buildResponse(query.raw, query.type, "", 3600, 0);
        displayAnswer = "NODATA";
      } else if (mode === 'CUSTOM_IP') {
        const customIp = query.type === 'AAAA' ? (settings.custom_block_ipv6 || "::") : (settings.custom_block_ipv4 || "0.0.0.0");
        answer = buildResponse(query.raw, query.type, customIp);
        displayAnswer = customIp;
      } else {
        const nullIp = query.type === 'AAAA' ? "::" : "0.0.0.0";
        answer = buildResponse(query.raw, query.type, nullIp);
        displayAnswer = nullIp;
      }
    }

    const latency = Date.now() - context.startTime;
    context.ctx.waitUntil(logModel.insert({
      profile_id: context.profileId,
      timestamp: Math.floor(Date.now() / 1000),
      client_ip: clientIp,
      geo_country: (request as any).cf?.country || "UN",
      domain: query.name,
      record_type: query.type,
      action,
      reason,
      answer: displayAnswer,
      latency
    }));

    return { answer, ttl: 3600, action, reason, latency };
  }
};
