import { Context, DNSQuery, ResolutionResult, ProfileSettings, Rule } from "../types";
import { DNSFilter } from "../lib/filtering";
import { BloomFilter } from "../utils/bloom";
import { cacheUtils } from "../utils/cache";
import { buildResponse } from "../utils/dns";
import { pipelineResolver } from "./resolver";

export const pipelineFilter = {
  async match(
    request: Request,
    query: DNSQuery,
    context: Context,
    settings: ProfileSettings,
    rules: Rule[],
    bloom: BloomFilter | undefined,
    track: (name: string) => void
  ): Promise<ResolutionResult | null> {
    const domainLower = query.name.toLowerCase();

    // 本地白名单
    const whitelist = rules.filter(r => r.type === 'ALLOW');
    if (DNSFilter.findMatch(query.name, whitelist)) {
      track('local_rules');
      return pipelineResolver.resolve(request, query, context, settings, "PASS", "Whitelist");
    }

    // 本地重定向
    const redirections = rules.filter(r => r.type === 'REDIRECT');
    const redirectRule = DNSFilter.findMatch(query.name, redirections);
    if (redirectRule) {
      let val: string | undefined;
      let respType = query.type;

      if (query.type === 'A') {
        val = redirectRule.v_a;
        if (!val && redirectRule.v_cname) {
          val = redirectRule.v_cname;
          respType = 'CNAME';
        }
      } else if (query.type === 'AAAA') {
        val = redirectRule.v_aaaa;
        if (!val && redirectRule.v_cname) {
          val = redirectRule.v_cname;
          respType = 'CNAME';
        }
      } else if (query.type === 'TXT') {
        val = redirectRule.v_txt;
      } else if (query.type === 'CNAME') {
        val = redirectRule.v_cname;
      }

      if (val) {
        track('local_rules');
        const result = await pipelineResolver.block(request, query, context, settings, "REDIRECT", `Rule: ${redirectRule.pattern}`, val, respType);
        return result;
      }
    }

    // 本地黑名单
    const blacklist = rules.filter(r => r.type === 'BLOCK');
    const blockRule = DNSFilter.findMatch(query.name, blacklist);
    if (blockRule) {
      track('local_rules');
      return pipelineResolver.block(request, query, context, settings, "BLOCK", `Blacklist: ${blockRule.pattern}`);
    }
    track('local_rules');

    // 外部列表过滤 (精确匹配 + 子域名匹配)
    if (bloom) {
      let currentDomain = domainLower;
      while (currentDomain) {
        if (bloom.test(currentDomain)) {
          track('bloom_check');
          return pipelineResolver.block(request, query, context, settings, "BLOCK", `External List: ${currentDomain}`);
        }
        const firstDot = currentDomain.indexOf('.');
        if (firstDot === -1) break;
        currentDomain = currentDomain.substring(firstDot + 1);
      }
      track('bloom_check');
    }

    return null;
  }
};
