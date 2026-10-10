import { Context, DNSQuery, ProfileSettings, ResolutionResult } from "../../types";
import {
  buildResponse,
  buildResponseMulti,
  buildDNSQuery,
  parseDNSAnswer,
  DNSRecord
} from "../../utils/dns";
import { resolveClientGeoCountry } from "../../utils/geoip";
import { enqueueLog } from "../logBatcher";

/**
 * Resolver function type used for resolving CNAME targets during redirection.
 */
export type RecursiveResolverFn = (
  request: Request,
  query: DNSQuery,
  context: Context,
  settings: ProfileSettings,
  action: "PASS"
) => Promise<ResolutionResult>;

/**
 * Synthesizes DNS responses for blocked or redirected queries.
 *
 * For REDIRECT:
 * - If user queries A or AAAA and rule targets a CNAME domain, recursively resolves
 *   the target domain's IP addresses and constructs a multi-record response.
 * - Otherwise synthesizes a single record answer.
 *
 * For BLOCK:
 * - Supports NXDOMAIN (RCODE 3), NODATA (RCODE 0), CUSTOM_IP, or NULL_IP (0.0.0.0 / ::).
 *
 * Persists the block/redirect event asynchronously to the log batcher.
 *
 * @param request - Inbound HTTP Request.
 * @param query - The incoming DNS query.
 * @param context - Request context.
 * @param settings - Current profile settings.
 * @param action - Either 'BLOCK' or 'REDIRECT'.
 * @param reason - Explanation for the action (e.g., rule pattern or category).
 * @param customAnswer - Custom IP or CNAME target domain if redirecting.
 * @param responseType - Target DNS record type (e.g. 'A', 'AAAA', 'CNAME').
 * @param recursiveResolver - Resolver callback for recursive target domain lookups.
 * @returns Standard ResolutionResult.
 */
export async function handleBlockOrRedirect(
  request: Request,
  query: DNSQuery,
  context: Context,
  settings: ProfileSettings,
  action: "BLOCK" | "REDIRECT",
  reason: string,
  customAnswer?: string,
  responseType?: string,
  recursiveResolver?: RecursiveResolverFn
): Promise<ResolutionResult> {
  const clientIp = request.headers.get("CF-Connecting-IP") || "127.0.0.1";
  let answer: Uint8Array;
  let displayAnswer = customAnswer || "";

  if (action === "REDIRECT" && customAnswer) {
    if (
      responseType === "CNAME" &&
      (query.type === "A" || query.type === "AAAA") &&
      recursiveResolver
    ) {
      try {
        // If client requested A/AAAA but rule returns CNAME, resolve the target domain's A/AAAA
        const targetQueryRaw = buildDNSQuery(customAnswer, query.type);
        const targetQuery: DNSQuery = {
          name: customAnswer,
          type: query.type,
          raw: targetQueryRaw
        };
        const upstreamRes = await recursiveResolver(
          request,
          targetQuery,
          context,
          settings,
          "PASS"
        );

        if (upstreamRes.answer && upstreamRes.answer.length > 0) {
          const parsedTargetAnswers = parseDNSAnswer(upstreamRes.answer);
          const records: DNSRecord[] = [
            { type: "CNAME", value: customAnswer, ttl: 60 }
          ];

          for (const a of parsedTargetAnswers) {
            if (a.type === query.type || a.type === "CNAME") {
              records.push({
                name: a.name,
                type: a.type,
                value: a.data,
                ttl: a.ttl
              });
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
      answer = buildResponse(
        query.raw,
        responseType || query.type,
        customAnswer
      );
    }
  } else {
    // Handling BLOCK modes
    const mode = settings.block_mode || "NULL_IP";

    if (mode === "NXDOMAIN") {
      answer = buildResponse(query.raw, query.type, "", 3600, 3);
      displayAnswer = "NXDOMAIN";
    } else if (mode === "NODATA") {
      answer = buildResponse(query.raw, query.type, "", 3600, 0);
      displayAnswer = "NODATA";
    } else if (mode === "CUSTOM_IP") {
      const customIp =
        query.type === "AAAA"
          ? settings.custom_block_ipv6 || "::"
          : settings.custom_block_ipv4 || "0.0.0.0";
      answer = buildResponse(query.raw, query.type, customIp);
      displayAnswer = customIp;
    } else {
      const nullIp = query.type === "AAAA" ? "::" : "0.0.0.0";
      answer = buildResponse(query.raw, query.type, nullIp);
      displayAnswer = nullIp;
    }
  }

  const latency = Date.now() - context.startTime;

  context.ctx.waitUntil(
    (async () => {
      try {
        const clientCountry = await resolveClientGeoCountry(request, clientIp);
        enqueueLog(
          {
            profile_id: context.profileId,
            access_point_id: context.accessPointId,
            timestamp: Math.floor(Date.now() / 1000),
            client_ip: clientIp,
            geo_country: clientCountry,
            domain: query.name,
            record_type: query.type,
            action,
            reason,
            answer: displayAnswer,
            latency
          },
          settings,
          context.env,
          context.ctx
        );
      } catch {
        // Ignore non-critical background logging errors
      }
    })()
  );

  return { answer, ttl: 3600, action, reason, latency };
}
