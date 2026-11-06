import { Context, DNSQuery, ProfileSettings, ResolutionResult } from "../../types";
import { parseDNSAnswer } from "../../utils/dns";
import { isSafeUrl } from "../../utils/validator";
import {
  fetchFromUpstream,
  resolveUpstreamEndpoint,
  UpstreamEndpointInfo
} from "./transport";
import { applyEcs } from "./ecs";
import { processBestEffortEch } from "./ech";
import { handleBlockOrRedirect } from "./block";
import { recordSuccessAndCache, recordFailure } from "./observability";
import { getDefaultUpstreamUrl } from "../../constants/presets";

export * from "./types";
export * from "./transport";
export * from "./ecs";
export * from "./ech";
export * from "./block";
export * from "./observability";

/**
 * High-level DNS resolution coordinator for the DNS Worker pipeline.
 *
 * Orchestrates:
 * - Upstream URL safety validation
 * - RFC 7871 EDNS Client Subnet (ECS) application
 * - Multi-protocol upstream transmission (DoH, DoT, TCP, DNS Stamps)
 * - Best-effort Cloudflare ECH injection
 * - Success/Failure asynchronous observability and memory caching
 * - Synthesis of Block and Redirect responses
 */
export const pipelineResolver = {
  /**
   * Resolves a DNS query against the configured upstream server.
   *
   * @param request - Inbound HTTP Request.
   * @param query - Parsed incoming DNS query.
   * @param context - Request context containing DB, timings, and credentials.
   * @param settings - Current profile settings.
   * @param action - Action status ('PASS').
   * @param reason - Optional rule explanation.
   * @returns ResolutionResult containing answer wire bytes, TTL, timings, and diagnostics.
   */
  async resolve(
    request: Request,
    query: DNSQuery,
    context: Context,
    settings: ProfileSettings,
    action: "PASS",
    reason?: string
  ): Promise<ResolutionResult> {
    const rawUpstreamUrl =
      settings.upstream[0] || getDefaultUpstreamUrl(context.env);

    if (!isSafeUrl(rawUpstreamUrl)) {
      return {
        answer: new Uint8Array(),
        ttl: 0,
        action: "FAIL",
        reason: "Unsafe upstream URL",
        diagnostics: {
          upstream_url: rawUpstreamUrl,
          method: "BLOCKED",
          status: 0
        },
        latency: Date.now() - context.startTime
      };
    }

    const { queryRaw, ecs } = applyEcs(request, query, settings);

    let endpoint: UpstreamEndpointInfo | undefined;
    try {
      endpoint = resolveUpstreamEndpoint(rawUpstreamUrl);
      const transportRes = await fetchFromUpstream(endpoint, queryRaw);

      const initialParsedAnswers = parseDNSAnswer(transportRes.answer);

      const echRes = await processBestEffortEch(
        query,
        initialParsedAnswers,
        transportRes.answer,
        context,
        settings,
        request,
        pipelineResolver.resolve,
        reason
      );

      const answer = echRes.answer;
      const parsedAnswers = echRes.parsedAnswers;
      const effectiveReason = echRes.effectiveReason;

      const minTTL =
        parsedAnswers.length > 0
          ? Math.max(10, Math.min(...parsedAnswers.map((a) => a.ttl)))
          : 60;

      recordSuccessAndCache(
        request,
        query,
        context,
        settings,
        action,
        effectiveReason,
        parsedAnswers,
        answer,
        minTTL,
        rawUpstreamUrl,
        ecs
      );

      return {
        answer,
        ttl: minTTL,
        action,
        reason: effectiveReason,
        latency: Date.now() - context.startTime,
        timings: { upstream_fetch: transportRes.latency },
        diagnostics: {
          upstream_url: rawUpstreamUrl.startsWith("sdns://")
            ? `${rawUpstreamUrl} (${transportRes.diagTarget})`
            : transportRes.diagTarget,
          method: transportRes.diagMethod,
          status: 200,
          status_text: "OK"
        }
      };
    } catch (e: unknown) {
      return recordFailure(
        request,
        query,
        context,
        settings,
        rawUpstreamUrl,
        e,
        ecs,
        endpoint?.diagTarget,
        endpoint?.diagMethod
      );
    }
  },

  /**
   * Synthesizes DNS responses for blocked or redirected queries.
   *
   * @param request - Inbound HTTP Request.
   * @param query - The incoming DNS query.
   * @param context - Request context.
   * @param settings - Current profile settings.
   * @param action - Action status ('BLOCK' | 'REDIRECT').
   * @param reason - Explanation for the action.
   * @param customAnswer - Optional custom answer payload (IP or CNAME domain).
   * @param responseType - Optional DNS record type for the answer.
   * @returns ResolutionResult.
   */
  async block(
    request: Request,
    query: DNSQuery,
    context: Context,
    settings: ProfileSettings,
    action: "BLOCK" | "REDIRECT",
    reason: string,
    customAnswer?: string,
    responseType?: string
  ): Promise<ResolutionResult> {
    return handleBlockOrRedirect(
      request,
      query,
      context,
      settings,
      action,
      reason,
      customAnswer,
      responseType,
      pipelineResolver.resolve
    );
  }
};
