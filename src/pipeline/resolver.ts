import { Context, DNSQuery, ResolutionResult, ProfileSettings } from "../types";
import { LogModel } from "../models/log";
import { fetchGeoIP } from "../utils/geoip";
import { buildResponse, buildResponseMulti, buildDNSQuery, parseDNSAnswer, injectEcsIntoQuery, DNSRecord } from "../utils/dns";
import { isCloudflareIp, buildCloudflareEchConfig, DEFAULT_ECH_FRONTING_DOMAIN, ensureCloudflareIpRangesLoaded } from "../utils/ech";
import { dnsCache } from "./cache";
import { connect } from 'cloudflare:sockets';
import { isSafeUrl } from "../utils/validator";

export const pipelineResolver = {
  async resolve(request: Request, query: DNSQuery, context: Context, settings: ProfileSettings, action: 'PASS', reason?: string): Promise<ResolutionResult> {
    const logModel = new LogModel(context.env.DB);
    let upstreamUrl = settings.upstream[0] || "https://security.cloudflare-dns.com/dns-query";
    if (!isSafeUrl(upstreamUrl)) {
      return { 
        answer: new Uint8Array(), ttl: 0, action: "FAIL", reason: "Unsafe upstream URL",
        diagnostics: { upstream_url: upstreamUrl, method: "BLOCKED", status: 0 },
        latency: Date.now() - context.startTime
      };
    }
    const startFetch = Date.now();
    let answer: Uint8Array;
    let upstreamLatency = 0;
    let isClassicDns = !upstreamUrl.startsWith('http');

    // ── ECS 处理 ──────────────────────────────────────────────────────────
    // ECS 通过 RFC 7871 OPT RR 直接写入 DNS 线格式（wire format），而非 URL 参数。
    // URL 参数方式（edns_client_subnet=...）是 Google DoH 私有扩展，
    // ControlD、NextDNS 等主流上游均不支持，只能识别 wire format 中的 OPT 记录。
    let ecs: string | undefined;
    let queryRaw = query.raw; // 可能被 ECS 注入后替换
    if (settings.ecs?.enabled) {
      const clientIp = request.headers.get("CF-Connecting-IP") || "127.0.0.1";
      ecs = settings.ecs.use_client_ip
        ? `${clientIp}/${clientIp.includes(':') ? 48 : 24}`
        : (query.type === 'AAAA'
            ? (settings.ecs.ipv6_cidr || settings.ecs.ipv4_cidr)
            : (settings.ecs.ipv4_cidr || settings.ecs.ipv6_cidr));
      if (ecs) {
        // 将 ECS OPT RR 注入到 DNS 查询的 wire format 中
        queryRaw = injectEcsIntoQuery(query.raw, ecs);
      }
    }

    try {
      // 经典 DNS 的 host 和 port，提升到外层供 diagnostics 使用
      let tcpHost = '';
      let tcpPort = 53;

      if (isClassicDns) {
        // 经典 DNS 处理 (通过 TCP Socket)
        // 去除 tcp:// 前缀和裸 IP 均可正确解析
        tcpHost = upstreamUrl.replace(/^tcp:\/\//, '');
        if (tcpHost.includes(':')) {
          const parts = tcpHost.split(':');
          tcpHost = parts[0];
          tcpPort = parseInt(parts[1]) || 53;
        }

        const socket = connect({ hostname: tcpHost, port: tcpPort });
        const writer = socket.writable.getWriter();
        const reader = socket.readable.getReader();

        // TCP DNS：同样使用注入 ECS 后的 queryRaw
        const tcpQuery = new Uint8Array(queryRaw.length + 2);
        tcpQuery[0] = (queryRaw.length >> 8) & 0xff;
        tcpQuery[1] = queryRaw.length & 0xff;
        tcpQuery.set(queryRaw, 2);

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
        // DoH 处理：ECS 已注入 queryRaw（wire format），无需 URL 参数
        const response = await fetch(upstreamUrl, {
          method: "POST",
          headers: { 
            "Accept": "application/dns-message",
            "Content-Type": "application/dns-message", 
            "User-Agent": "Obex-DNS/1.0",
            "Connection": "keep-alive"
          },
          body: queryRaw,
          signal: AbortSignal.timeout(5000)
        });

        if (!response.ok) throw new Error(`Upstream HTTP ${response.status}`);
        const answerBuffer = await response.arrayBuffer();
        answer = new Uint8Array(answerBuffer);
        upstreamLatency = Date.now() - startFetch;
      }

      let parsedAnswers = parseDNSAnswer(answer);
      let effectiveReason = reason;

      // ── 尽力 ECH (Best-effort ECH) 处理 ──────────────────────────────────────
      // 仅支持由 Cloudflare 代理的地址。针对 Type 65 (HTTPS) 或 Type 64 (SVCB)：
      // 若上游未返回 ECH 配置或无应答，检查目标是否为 CF 代理 IP，若是则自动注入 ECH 重写。
      const isHttpsOrSvcb = query.type === 'HTTPS' || query.type === 'SVCB' || query.type === 'TYPE65' || query.type === 'TYPE64';
      const echEnabled = typeof settings.best_effort_ech === 'boolean'
        ? settings.best_effort_ech
        : !!settings.best_effort_ech?.enabled;

      if (isHttpsOrSvcb && echEnabled) {
        await ensureCloudflareIpRangesLoaded(context.env.DB);
        const hasEch = parsedAnswers.some(a => a.data.includes("ech="));
        if (!hasEch) {
          const existingIpv4s: string[] = [];
          const existingIpv6s: string[] = [];
          for (const a of parsedAnswers) {
            const v4Match = a.data.match(/ipv4hint=([^\s]+)/);
            if (v4Match) existingIpv4s.push(...v4Match[1].split(","));
            const v6Match = a.data.match(/ipv6hint=([^\s]+)/);
            if (v6Match) existingIpv6s.push(...v6Match[1].split(","));
          }

          let isCf = existingIpv4s.some(isCloudflareIp) || existingIpv6s.some(isCloudflareIp);

          // 若现有 hint 中未发现或无 answer，快速解析 A 记录验证是否为 CF 代理
          if (!isCf) {
            try {
              const aQueryRaw = buildDNSQuery(query.name, 'A');
              const aRes = await pipelineResolver.resolve(
                request,
                { name: query.name, type: 'A', raw: aQueryRaw },
                context,
                settings,
                'PASS'
              );
              if (aRes.answer && aRes.answer.length > 0) {
                const aAnswers = parseDNSAnswer(aRes.answer);
                for (const ans of aAnswers) {
                  if (ans.type === 'A') {
                    existingIpv4s.push(ans.data);
                    if (isCloudflareIp(ans.data)) isCf = true;
                  }
                }
              }
            } catch (e) {
              console.warn("Failed to probe A records for ECH check:", e);
            }
          }

          if (isCf) {
            const frontingDomain = (typeof settings.best_effort_ech === 'object' && settings.best_effort_ech?.fronting_domain)
              ? settings.best_effort_ech.fronting_domain
              : DEFAULT_ECH_FRONTING_DOMAIN;

            const echConfigBase64 = buildCloudflareEchConfig(frontingDomain);
            const targetType = (query.type === 'SVCB' || query.type === 'TYPE64') ? 'SVCB' : 'HTTPS';

            const params: string[] = ["alpn=h3,h2"];
            if (existingIpv4s.length > 0) {
              params.push(`ipv4hint=${Array.from(new Set(existingIpv4s)).join(",")}`);
            }
            params.push(`ech=${echConfigBase64}`);
            if (existingIpv6s.length > 0) {
              params.push(`ipv6hint=${Array.from(new Set(existingIpv6s)).join(",")}`);
            }

            const rdataValue = `1 . ${params.join(" ")}`;
            answer = buildResponse(query.raw, targetType, rdataValue, 300, 0);
            parsedAnswers = parseDNSAnswer(answer);
            effectiveReason = "ECH Rewritten";
          }
        }
      }

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
          access_point_id: context.accessPointId,
          timestamp: Math.floor(Date.now() / 1000),
          client_ip: clientIp,
          geo_country: (request as any).cf?.country || request.headers.get("CF-IPCountry") || "UN",
          domain: query.name,
          record_type: query.type,
          action,
          reason: effectiveReason,
          answer: parsedAnswers.map(a => a.data).join(", "),
          dest_geoip: destGeoJson,
          upstream: upstreamUrl,
          latency,
          ecs
        });

        if (answer.length > 0) {
          dnsCache.set(`${context.profileId}:${query.name}:${query.type}`, {
            answer, ttl: minTTL, action, reason: effectiveReason, expiresAt: Date.now() + (minTTL * 1000)
          });
        }
      })());

      return { 
        answer, 
        ttl: minTTL, 
        action, 
        reason: effectiveReason, 
        latency: Date.now() - context.startTime, 
        timings: { upstream_fetch: upstreamLatency },
        diagnostics: {
          upstream_url: isClassicDns ? `tcp://${tcpHost}:${tcpPort}` : upstreamUrl,
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
      access_point_id: context.accessPointId,
      timestamp: Math.floor(Date.now() / 1000),
      client_ip: clientIp,
      geo_country: (request as any).cf?.country || request.headers.get("CF-IPCountry") || "UN",
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
