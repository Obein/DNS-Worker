import { Context, DNSQuery, ResolutionResult, ProfileSettings } from "../types";
import { LogModel } from "../models/log";
import { fetchGeoIP } from "../utils/geoip";
import { buildResponse, buildResponseMulti, buildDNSQuery, parseDNSAnswer, injectEcsIntoQuery, DNSRecord } from "../utils/dns";
import { isCloudflareIp, buildCloudflareEchConfig, DEFAULT_ECH_FRONTING_DOMAIN, ensureCloudflareIpRangesLoaded, saveActiveCfEchConfig } from "../utils/ech";
import { dnsCache } from "./cache";
import { connectUniversal } from "../utils/sockets";
import { isSafeUrl } from "../utils/validator";
import { parseDnsStamp } from "../utils/dnsStamp";
import { enqueueLog } from "./logBatcher";

export class UpstreamHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly statusText: string,
    public readonly responseBodySnippet: string,
    public readonly cfRay?: string
  ) {
    super(`Upstream HTTP ${status}${statusText ? ` ${statusText}` : ''}`);
    this.name = 'UpstreamHttpError';
  }
}

/**
 * Reads a 2-byte framed DNS message from a ReadableStream reader (RFC 1035 / RFC 7858).
 * Handles TCP / TLS packet fragmentation and enforces a timeout.
 */
async function readFramedDnsResponse(reader: ReadableStreamDefaultReader<Uint8Array>, timeoutMs = 5000): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let expectedBodyLength: number | null = null;

  let timer: any;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Upstream Socket Timeout")), timeoutMs);
  });

  try {
    while (true) {
      const { value, done } = await Promise.race([reader.read(), timeoutPromise]);
      if (done || !value) {
        throw new Error("Socket closed before complete DNS response received");
      }

      chunks.push(value);
      totalBytes += value.length;

      if (expectedBodyLength === null && totalBytes >= 2) {
        const b0 = chunks[0][0];
        const b1 = chunks[0].length > 1 ? chunks[0][1] : chunks[1][0];
        expectedBodyLength = (b0 << 8) | b1;
      }

      if (expectedBodyLength !== null && totalBytes >= 2 + expectedBodyLength) {
        const combined = new Uint8Array(totalBytes);
        let offset = 0;
        for (const chunk of chunks) {
          combined.set(chunk, offset);
          offset += chunk.length;
        }
        return combined.slice(2, 2 + expectedBodyLength);
      }
    }
  } finally {
    clearTimeout(timer);
  }
}

export const pipelineResolver = {
  async resolve(request: Request, query: DNSQuery, context: Context, settings: ProfileSettings, action: 'PASS', reason?: string): Promise<ResolutionResult> {
    const logModel = new LogModel(context.env.DB);
    const rawUpstreamUrl = settings.upstream[0] || "https://security.cloudflare-dns.com/dns-query";
    let effectiveUpstreamUrl = rawUpstreamUrl;
    let diagMethod = "POST";
    let diagTarget = rawUpstreamUrl;

    if (!isSafeUrl(rawUpstreamUrl)) {
      return { 
        answer: new Uint8Array(), ttl: 0, action: "FAIL", reason: "Unsafe upstream URL",
        diagnostics: { upstream_url: rawUpstreamUrl, method: "BLOCKED", status: 0 },
        latency: Date.now() - context.startTime
      };
    }
    const startFetch = Date.now();
    let answer: Uint8Array;
    let upstreamLatency = 0;

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
      if (rawUpstreamUrl.startsWith('sdns://')) {
        const stamp = parseDnsStamp(rawUpstreamUrl);
        if (stamp.protocol === 'dnscrypt') {
          throw new Error("DNSCrypt (0x01) protocol in DNS Stamp is not supported; please use DoH (0x02) or DoT (0x03) DNS Stamps");
        }
        if (stamp.protocol === 'doq') {
          throw new Error("DNS over QUIC (0x04) in DNS Stamp is not supported; please use DoH (0x02) or DoT (0x03) DNS Stamps");
        }
        if (!stamp.resolvedUrl) {
          throw new Error(`Unsupported DNS Stamp protocol: 0x${stamp.protocolId.toString(16)}`);
        }
        effectiveUpstreamUrl = stamp.resolvedUrl;
      }

      if (effectiveUpstreamUrl.startsWith('tls://')) {
        // ── DNS over TLS (DoT - RFC 7858) ──────────────────────────────────
        diagMethod = "DoT";
        let dotHost = effectiveUpstreamUrl.replace(/^tls:\/\//, '');
        let dotPort = 853;
        if (dotHost.startsWith('[')) {
          const closeIdx = dotHost.indexOf(']');
          if (closeIdx !== -1) {
            const ip = dotHost.slice(1, closeIdx);
            const rest = dotHost.slice(closeIdx + 1);
            dotHost = ip;
            if (rest.startsWith(':')) {
              dotPort = parseInt(rest.slice(1), 10) || 853;
            }
          }
        } else if (dotHost.includes(':')) {
          const parts = dotHost.split(':');
          dotHost = parts[0];
          dotPort = parseInt(parts[1], 10) || 853;
        }
        diagTarget = `tls://${dotHost}:${dotPort}`;

        const socket = await connectUniversal({
          hostname: dotHost,
          port: dotPort,
          secureTransport: 'on'
        });

        try {
          const writer = socket.writable.getWriter();
          const reader = socket.readable.getReader();

          // RFC 7858 Section 3.3: 2-byte length prefix + DNS message
          const framedQuery = new Uint8Array(queryRaw.length + 2);
          framedQuery[0] = (queryRaw.length >> 8) & 0xff;
          framedQuery[1] = queryRaw.length & 0xff;
          framedQuery.set(queryRaw, 2);

          await writer.write(framedQuery);
          writer.releaseLock();

          answer = await readFramedDnsResponse(reader, 5000);
        } finally {
          await socket.close().catch(() => {});
        }
        upstreamLatency = Date.now() - startFetch;

      } else if (!effectiveUpstreamUrl.startsWith('http://') && !effectiveUpstreamUrl.startsWith('https://')) {
        // ── 经典 DNS (TCP Socket) ──────────────────────────────────────────
        diagMethod = "TCP";
        let tcpHost = effectiveUpstreamUrl.replace(/^tcp:\/\//, '');
        let tcpPort = 53;
        if (tcpHost.startsWith('[')) {
          const closeIdx = tcpHost.indexOf(']');
          if (closeIdx !== -1) {
            const ip = tcpHost.slice(1, closeIdx);
            const rest = tcpHost.slice(closeIdx + 1);
            tcpHost = ip;
            if (rest.startsWith(':')) {
              tcpPort = parseInt(rest.slice(1), 10) || 53;
            }
          }
        } else if (tcpHost.includes(':')) {
          const parts = tcpHost.split(':');
          tcpHost = parts[0];
          tcpPort = parseInt(parts[1], 10) || 53;
        }
        diagTarget = `tcp://${tcpHost}:${tcpPort}`;

        const socket = await connectUniversal({
          hostname: tcpHost,
          port: tcpPort,
          secureTransport: 'off'
        });

        try {
          const writer = socket.writable.getWriter();
          const reader = socket.readable.getReader();

          const framedQuery = new Uint8Array(queryRaw.length + 2);
          framedQuery[0] = (queryRaw.length >> 8) & 0xff;
          framedQuery[1] = queryRaw.length & 0xff;
          framedQuery.set(queryRaw, 2);

          await writer.write(framedQuery);
          writer.releaseLock();

          answer = await readFramedDnsResponse(reader, 5000);
        } finally {
          await socket.close().catch(() => {});
        }
        upstreamLatency = Date.now() - startFetch;

      } else {
        // ── DoH (DNS over HTTPS) ───────────────────────────────────────────
        diagMethod = "POST";
        diagTarget = effectiveUpstreamUrl;

        const response = await fetch(effectiveUpstreamUrl, {
          method: "POST",
          headers: { 
            "Accept": "application/dns-message",
            "Content-Type": "application/dns-message", 
            "User-Agent": "Obex-DNS/1.0"
          },
          body: queryRaw,
          signal: AbortSignal.timeout(5000)
        });

        if (!response.ok) {
          let snippet = "";
          try {
            const rawBody = await response.text();
            // 提取纯文本摘要（剥除 HTML 标签及多余空白），保留前 300 字符
            snippet = rawBody.replace(/<[^>]*>?/gm, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
          } catch {}
          const cfRay = response.headers.get("cf-ray") || undefined;
          throw new UpstreamHttpError(response.status, response.statusText, snippet, cfRay);
        }
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
        const existingIpv4s: string[] = [];
        const existingIpv6s: string[] = [];
        let existingEch: string | undefined;

        for (const a of parsedAnswers) {
          const v4Match = a.data.match(/ipv4hint=([^\s]+)/);
          if (v4Match) existingIpv4s.push(...v4Match[1].split(","));
          const v6Match = a.data.match(/ipv6hint=([^\s]+)/);
          if (v6Match) existingIpv6s.push(...v6Match[1].split(","));
          const echMatch = a.data.match(/ech=([A-Za-z0-9+/=]+)/);
          if (echMatch) {
            existingEch = echMatch[1];
            context.ctx.waitUntil(saveActiveCfEchConfig(context.env.DB, existingEch));
          }
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

          const echConfigBase64 = buildCloudflareEchConfig(frontingDomain, existingEch);
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

      const minTTL = parsedAnswers.length > 0 ? Math.max(10, Math.min(...parsedAnswers.map(a => a.ttl))) : 60;

      context.ctx.waitUntil((async () => {
        try {
          const clientIp = request.headers.get("CF-Connecting-IP") || "127.0.0.1";
          const firstIp = parsedAnswers.find(a => a.type === 'A' || a.type === 'AAAA')?.data;
          let destGeoJson = "";
          if (firstIp) {
            const geo = await fetchGeoIP(firstIp);
            if (geo) destGeoJson = JSON.stringify(geo);
          }

          const latency = Date.now() - context.startTime;
          enqueueLog({
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
            upstream: rawUpstreamUrl,
            latency,
            ecs
          }, settings, context.env, context.ctx);

          if (answer.length > 0) {
            dnsCache.set(`${context.profileId}:${query.name}:${query.type}`, {
              answer, ttl: minTTL, action, reason: effectiveReason, expiresAt: Date.now() + (minTTL * 1000)
            });
          }
        } catch {
          // Ignore non-critical background caching errors
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
          upstream_url: rawUpstreamUrl.startsWith('sdns://') ? `${rawUpstreamUrl} (${diagTarget})` : diagTarget,
          method: diagMethod,
          status: 200,
          status_text: "OK"
        }
      };
    } catch (e: any) {
      let status = 0;
      let statusText: string | undefined;
      let errorDetail = e?.message || String(e);
      let responseBodySnippet: string | undefined;
      let cfRay: string | undefined;

      if (e instanceof UpstreamHttpError) {
        status = e.status;
        statusText = e.statusText || undefined;
        responseBodySnippet = e.responseBodySnippet || undefined;
        cfRay = e.cfRay;
      } else if (e?.cause) {
        const causeMsg = typeof e.cause === 'object' && e.cause ? (e.cause.message || String(e.cause)) : String(e.cause);
        errorDetail += ` (Cause: ${causeMsg})`;
      }

      const failReason = status > 0
        ? `Upstream HTTP ${status}${statusText ? ` ${statusText}` : ''}`
        : `Upstream Error: ${errorDetail}`;

      // 异步持久化解析失败日志，便于在管理面板“查询日志”中排查上游故障
      context.ctx.waitUntil((async () => {
        try {
          const clientIp = request.headers.get("CF-Connecting-IP") || "127.0.0.1";
          enqueueLog({
            profile_id: context.profileId,
            access_point_id: context.accessPointId,
            timestamp: Math.floor(Date.now() / 1000),
            client_ip: clientIp,
            geo_country: (request as any).cf?.country || request.headers.get("CF-IPCountry") || "UN",
            domain: query.name,
            record_type: query.type,
            action: "FAIL",
            reason: failReason,
            answer: "",
            dest_geoip: "",
            upstream: rawUpstreamUrl,
            latency: Date.now() - context.startTime,
            ecs
          }, settings, context.env, context.ctx);
        } catch {
          // Ignore background logging failures
        }
      })());

      return { 
        answer: new Uint8Array(), 
        ttl: 0, 
        action: "FAIL", 
        reason: failReason,
        latency: Date.now() - context.startTime,
        diagnostics: {
          upstream_url: rawUpstreamUrl.startsWith('sdns://') ? `${rawUpstreamUrl} (${diagTarget})` : diagTarget,
          method: diagMethod,
          status,
          status_text: statusText,
          error_detail: errorDetail,
          response_body: responseBodySnippet,
          cf_ray: cfRay
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
    context.ctx.waitUntil((async () => {
      try {
        enqueueLog({
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
        }, settings, context.env, context.ctx);
      } catch {
        // Ignore non-critical background logging errors
      }
    })());

    return { answer, ttl: 3600, action, reason, latency };
  }
};
