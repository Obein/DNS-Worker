import { Env } from "../../types";
import { BloomFilter } from "../bloom";
import { fetchListContent } from "../listFetcher";
import { ListModel } from "../../models/list";
import { ListBloomModel } from "../../models/listBloom";
import { AdguardRulesModel } from "../../models/adguardRules";
import { AdGuardRuleKind, AdGuardPayload, ParsedAdGuardRule } from "../../lib/adguard";

const DEFAULT_MAX_LIST_BYTES = 20 * 1024 * 1024; // 20 MB default limit (streaming line parsing has low memory footprint)

/**
 * 同步单个订阅列表的通用业务逻辑。
 * 
 * 性能优化：使用流式下载与行解析，直接在下载过程中动态将域名填入布隆过滤器。
 * 极大减少内存分配（不再需要保存庞大的 domains 数组），并每 50,000 个域名主动出让 CPU 喘息，规避 CPU 超载。
 * 
 * @returns 最终的同步错误信息 (若成功则为 null)
 */
export async function syncSingleList(
  profileId: string,
  list: { id: number; url: string },
  env: Env,
  listModel: ListModel,
  listBloomModel: ListBloomModel,
  now: number
): Promise<string | null> {
  const timeoutMs = Number(env.SYNC_TIMEOUT_MS) || 90000;
  const maxListDomains = Number(env.MAX_LIST_DOMAINS) || 500000;
  const maxDomains = Number(env.MAX_SYNC_DOMAINS) || 1000000;
  const maxListBytes = Number(env.MAX_LIST_BYTES) || DEFAULT_MAX_LIST_BYTES;
  const falsePositiveRate = Number(env.BLOOM_FALSE_POSITIVE_RATE) || 0.0001;
  const maxRegexRules = Number(env.MAX_REGEX_RULES) || 1000;

  // 协作式调度参数：降低单次持续计算量，适度平摊 CPU 峰值
  const yieldBatchSize = Number(env.SYNC_YIELD_BATCH_SIZE) || 5000;
  const yieldSleepMs = Number(env.SYNC_YIELD_SLEEP_MS) || 10;

  // 创建对应的列表布隆过滤器与扩展规则载荷
  const listBloom = BloomFilter.create(maxDomains, falsePositiveRate);
  const adguardPayload: AdGuardPayload = {
    exceptions: [],
    rewrites: {},
    patterns: []
  };

  let count = 0;
  let domainsSinceYield = 0;

  // 流式下载并按行解析规则，分流分类存储
  const { error: fetchError, truncated } = await fetchListContent(
    list.url,
    maxListBytes,
    timeoutMs,
    (rule: ParsedAdGuardRule) => {
      if (count < maxListDomains) {
        if (rule.kind === AdGuardRuleKind.BLOOM_DOMAIN && rule.domain) {
          listBloom.add(rule.domain);
          if (rule.includeSubdomains) {
            listBloom.add(`||${rule.domain}`);
          }
          count++;
        } else if (rule.kind === AdGuardRuleKind.EXCEPTION && rule.domain) {
          adguardPayload.exceptions.push({
            domain: rule.domain,
            includeSubdomains: Boolean(rule.includeSubdomains),
            raw: rule.raw
          });
          count++;
        } else if (rule.kind === AdGuardRuleKind.DNS_REWRITE && rule.domain && rule.rewrite) {
          adguardPayload.rewrites[rule.domain] = {
            ...rule.rewrite,
            includeSubdomains: Boolean(rule.includeSubdomains),
            raw: rule.raw
          };
          count++;
        } else if (rule.kind === AdGuardRuleKind.COMPLEX_PATTERN && rule.patternRegex) {
          if (adguardPayload.patterns.length < maxRegexRules) {
            adguardPayload.patterns.push({
              pattern: rule.patternRegex,
              apexIndex: rule.apexIndex,
              raw: rule.raw
            });
            count++;
          }
        }

        domainsSinceYield++;

        // 协作式调度：每处理 yieldBatchSize 个规则让出事件循环，注入喘息延迟平摊 CPU 负载
        if (domainsSinceYield >= yieldBatchSize) {
          domainsSinceYield = 0;
          return new Promise<void>((resolve) => setTimeout(resolve, yieldSleepMs));
        }
      }
    }
  );

  let syncError: string | null = fetchError;

  if (!fetchError) {
    if (truncated) {
      syncError = `List truncated at ${(maxListBytes / 1024 / 1024).toFixed(0)} MB: Maximum list size reached. Excess rules were omitted.`;
      console.warn(
        `[Sync] Profile ${profileId}: list #${list.id} truncated at ${(maxListBytes / 1024 / 1024).toFixed(0)} MB with ${count} rules. Warning: ${syncError}`
      );
    }
    // 写入列表级布隆过滤器和扩展规则到数据库
    const saveOps: Promise<any>[] = [
      listBloomModel.upsertListBloom(list.id, listBloom.toUint8Array().buffer as ArrayBuffer, now)
    ];
    if (env?.DB) {
      saveOps.push(new AdguardRulesModel(env.DB).upsertListRules(list.id, adguardPayload, now));
    }
    await Promise.all(saveOps);
    if (!truncated) {
      console.log(
        `[Sync] Profile ${profileId}: successfully updated list #${list.id} with ${count} rules.`
      );
    }
  } else {
    // 拉取失败：跳过，并沿用原有列表缓存，记录错误原因，保持启用状态
    console.warn(
      `[Sync] Profile ${profileId}: failed to fetch/parse list #${list.id}. ` +
        `Skipping and keeping old bloom. Error: ${fetchError}`
    );
  }

  // 无论成功还是失败，都更新 last_synced_at 并记录 syncError，保持列表原有的 enabled 状态（避免并发切换为禁用后被强制覆盖）
  await listModel.updateListSyncStatus(list.id, now, null, syncError);
  return syncError;
}
