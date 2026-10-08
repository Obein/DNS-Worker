import { Context, DNSQuery, ProfileSettings, ResolutionResult } from "../../types";
import { buildDNSQuery, buildResponse, parseDNSAnswer } from "../../utils/dns";
import {
  isCloudflareIp,
  buildCloudflareEchConfig,
  DEFAULT_ECH_FRONTING_DOMAIN,
  ensureCloudflareIpRangesLoaded
} from "../../utils/ech";
import { EchProcessResult, ParsedDNSAnswerRecord } from "./types";

/**
 * Resolver callback interface for probing A records during ECH checking.
 */
export type ProbeResolverFn = (
  request: Request,
  query: DNSQuery,
  context: Context,
  settings: ProfileSettings,
  action: "PASS"
) => Promise<ResolutionResult>;

/**
 * Evaluates and injects Best-effort Encrypted Client Hello (ECH) for Cloudflare-fronted domains.
 *
 * Applicable to Type 65 (HTTPS) or Type 64 (SVCB) queries when best_effort_ech is enabled.
 * If the target domain resolves to Cloudflare IP ranges, synthesizes an HTTPS/SVCB answer
 * containing a valid ECHConfig parameter.
 *
 * @param query - The incoming DNS query.
 * @param initialParsedAnswers - Answers parsed from the upstream response.
 * @param initialAnswer - Raw wire answer from upstream.
 * @param context - Request context containing DB and execution context.
 * @param settings - Current profile settings.
 * @param request - Inbound HTTP Request.
 * @param probeResolver - Function to probe A records if IP hints are missing.
 * @param initialReason - Initial resolution reason string.
 * @returns Object with effective wire answer, parsed answers, and effective reason.
 */
export async function processBestEffortEch(
  query: DNSQuery,
  initialParsedAnswers: ParsedDNSAnswerRecord[],
  initialAnswer: Uint8Array,
  context: Context,
  settings: ProfileSettings,
  request: Request,
  probeResolver: ProbeResolverFn,
  initialReason?: string
): Promise<EchProcessResult> {
  const isHttpsOrSvcb =
    query.type === "HTTPS" ||
    query.type === "SVCB" ||
    query.type === "TYPE65" ||
    query.type === "TYPE64";

  const echEnabled =
    typeof settings.best_effort_ech === "boolean"
      ? settings.best_effort_ech
      : Boolean(settings.best_effort_ech?.enabled);

  let answer = initialAnswer;
  let parsedAnswers = initialParsedAnswers;
  let effectiveReason = initialReason;

  if (isHttpsOrSvcb) {
    const serverDomain = (context.env.SERVERFULL_DOT_DOMAIN || context.env.DOT_DOMAIN || "").toLowerCase().trim();
    const queryLower = query.name.toLowerCase().trim();
    const isDdrQuery = queryLower.startsWith("_dns.") || Boolean(serverDomain && (queryLower === `_dns.${serverDomain}` || queryLower.endsWith(`._dns.${serverDomain}`)));
    const isServerDomainQuery = Boolean(serverDomain && (queryLower === serverDomain || queryLower.endsWith(`.${serverDomain}`)));

    if (isDdrQuery || isServerDomainQuery) {
      const frontingDomain =
        context.env.SERVERFULL_ECH_FRONTING_DOMAIN ||
        (typeof settings.best_effort_ech === "object" && settings.best_effort_ech?.fronting_domain) ||
        DEFAULT_ECH_FRONTING_DOMAIN;
      const echConfigBase64 = context.env.SERVERFULL_ECH_CONFIG || buildCloudflareEchConfig(frontingDomain);
      const httpsPort = context.env.SERVERFULL_HTTPS_PORT || context.env.HTTPS_PORT || 10443;
      const dotPort = context.env.SERVERFULL_DOT_PORT || context.env.DOT_PORT || 853;

      if (isDdrQuery) {
        // RFC 9460 Section 8: Discovery of Designated Resolvers (DDR) for DoQ (853), DoT (853), and DoH3 with ECH
        const targetType = query.type === "HTTPS" || query.type === "TYPE65" ? "HTTPS" : "SVCB";
        const ddrSvcb = `1 . alpn=doq,dot port=${dotPort} ech=${echConfigBase64}`;
        answer = buildResponse(query.raw, targetType, ddrSvcb, 300, 0);
        parsedAnswers = parseDNSAnswer(answer);
        effectiveReason = "DDR SVCB (DoQ/DoT/H3/ECH)";
        return { answer, parsedAnswers, effectiveReason };
      }

      if (isServerDomainQuery) {
        // RFC 9460 HTTPS Service Binding: Advertises HTTP/3 (alpn=h3,h2), port, and ECH
        const targetType = query.type === "SVCB" || query.type === "TYPE64" ? "SVCB" : "HTTPS";
        const serverHttps = `1 . alpn=h3,h2 port=${httpsPort} ech=${echConfigBase64}`;
        answer = buildResponse(query.raw, targetType, serverHttps, 300, 0);
        parsedAnswers = parseDNSAnswer(answer);
        effectiveReason = "Server HTTPS (H3/ECH)";
        return { answer, parsedAnswers, effectiveReason };
      }
    }

    if (echEnabled) {
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
      }
    }

    let isCf = existingIpv4s.some(isCloudflareIp) || existingIpv6s.some(isCloudflareIp);

    // If existing hints do not confirm Cloudflare proxying, probe A records
    if (!isCf) {
      try {
        const aQueryRaw = buildDNSQuery(query.name, "A");
        const aRes = await probeResolver(
          request,
          { name: query.name, type: "A", raw: aQueryRaw },
          context,
          settings,
          "PASS"
        );
        if (aRes.answer && aRes.answer.length > 0) {
          const aAnswers = parseDNSAnswer(aRes.answer);
          for (const ans of aAnswers) {
            if (ans.type === "A") {
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
      const frontingDomain =
        typeof settings.best_effort_ech === "object" && settings.best_effort_ech?.fronting_domain
          ? settings.best_effort_ech.fronting_domain
          : DEFAULT_ECH_FRONTING_DOMAIN;

      const echConfigBase64 = buildCloudflareEchConfig(frontingDomain, existingEch);
      const targetType =
        query.type === "SVCB" || query.type === "TYPE64" ? "SVCB" : "HTTPS";

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

  return { answer, parsedAnswers, effectiveReason };
}
