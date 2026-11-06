/**
 * @file filter.ts
 * @description Multi-tier DNS filtering pipeline combining local custom rules,
 * AdGuard exceptions, DNS rewrites, dual-state Bloom filter, and complex regex patterns.
 */

import { Context, DNSQuery, ResolutionResult, ProfileSettings, Rule } from "../types";
import { DNSFilter } from "../lib/filtering";
import { BloomFilter } from "../utils/bloom";
import { AdGuardProfileEngine } from "../lib/adguard";
import { pipelineResolver } from "./resolver";

export const pipelineFilter = {
  async match(
    request: Request,
    query: DNSQuery,
    context: Context,
    settings: ProfileSettings,
    rules: Rule[],
    bloom: BloomFilter | undefined,
    track: (name: string) => void,
    adguard?: AdGuardProfileEngine
  ): Promise<ResolutionResult | null> {
    const domainLower = query.name.toLowerCase();

    // ── 阶段 1：本地自定义规则 (Local Rules) ──────────────────────────────────
    // 1.1 本地白名单
    const whitelist = rules.filter(r => r.type === 'ALLOW');
    if (DNSFilter.findMatch(query.name, whitelist)) {
      track('local_rules');
      return pipelineResolver.resolve(request, query, context, settings, "PASS", "Whitelist");
    }

    // 1.2 本地重定向
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

    // 1.3 本地黑名单
    const blacklist = rules.filter(r => r.type === 'BLOCK');
    const blockRule = DNSFilter.findMatch(query.name, blacklist);
    if (blockRule) {
      track('local_rules');
      return pipelineResolver.block(request, query, context, settings, "BLOCK", `Blacklist: ${blockRule.pattern}`);
    }
    track('local_rules');

    // ── 阶段 2：外部列表白名单例外 (@@) ────────────────────────────────────
    if (adguard?.testException(domainLower)) {
      track('adguard_whitelist');
      return pipelineResolver.resolve(request, query, context, settings, "PASS", "External List: Exception");
    }

    // ── 阶段 3：外部列表 DNS 重写 ($dnsrewrite) ────────────────────────────
    const rewrite = adguard?.matchRewrite(domainLower);
    if (rewrite) {
      track('adguard_rewrite');
      if (rewrite.type === 'A' || rewrite.type === 'AAAA') {
        if (query.type === rewrite.type || query.type === 'HTTPS' || query.type === 'SVCB') {
          return pipelineResolver.block(request, query, context, settings, "REDIRECT", "External List: DNS Rewrite", rewrite.value, rewrite.type);
        }
        // 反向类型无记录时返回 NODATA / 空阻断
        return pipelineResolver.block(request, query, context, settings, "BLOCK", "External List: DNS Rewrite (NoData)");
      }
      if (rewrite.type === 'CNAME') {
        return pipelineResolver.block(request, query, context, settings, "REDIRECT", "External List: DNS Rewrite", rewrite.value, "CNAME");
      }
      if (rewrite.type === 'NXDOMAIN') {
        return pipelineResolver.block(request, query, context, settings, "BLOCK", "External List: DNS Rewrite (NXDOMAIN)");
      }
      if (rewrite.type === 'REFUSED') {
        return pipelineResolver.block(request, query, context, settings, "BLOCK", "External List: DNS Rewrite (REFUSED)");
      }
    }

    // ── 阶段 4：Bloom 过滤器双态前缀防线 (海量静态黑名单 ~90%) ────────────────
    if (bloom) {
      let currentDomain = domainLower;
      let isSelf = true;
      while (currentDomain) {
        if (isSelf) {
          // 精确自身测试：匹配单域名黑名单 或 带有 || 的自身
          if (bloom.test(currentDomain) || bloom.test(`||${currentDomain}`)) {
            track('bloom_check');
            return pipelineResolver.block(request, query, context, settings, "BLOCK", `External List: ${currentDomain}`);
          }
          isSelf = false;
        } else {
          // 父级子域测试：仅当父域名是以 || 前缀注册时才拦截子域！
          if (bloom.test(`||${currentDomain}`)) {
            track('bloom_check');
            return pipelineResolver.block(request, query, context, settings, "BLOCK", `External List: ||${currentDomain}`);
          }
        }
        const firstDot = currentDomain.indexOf('.');
        if (firstDot === -1) break;
        currentDomain = currentDomain.substring(firstDot + 1);
      }
      track('bloom_check');
    }

    // ── 阶段 5：外部列表正则与复杂通配符池 (Regex / Wildcard Pool) ─────────
    if (adguard?.matchPattern(domainLower)) {
      track('adguard_pattern');
      return pipelineResolver.block(request, query, context, settings, "BLOCK", "External List: Pattern");
    }

    return null;
  }
};
