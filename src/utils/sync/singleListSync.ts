import { Env } from "../../types";
import { BloomFilter } from "../bloom";
import { fetchListContent } from "../listFetcher";
import { ListModel } from "../../models/list";
import { ListBloomModel } from "../../models/listBloom";
import { AdguardRulesModel } from "../../models/adguardRules";
import { AdGuardRuleKind, AdGuardPayload, ParsedAdGuardRule } from "../../lib/adguard";

const DEFAULT_MAX_LIST_BYTES = 20 * 1024 * 1024; // 20 MB default limit (streaming line parsing has low memory footprint)

export interface SingleListSyncResult {
  syncError: string | null;
  notModified: boolean;
}

/**
 * Synchronizes an external blocklist URL globally on the system side.
 *
 * Performance and Architectural Guarantees:
 * 1. Global Dedup: Any list URL subscribed to across multiple profiles is fetched and compiled ONLY ONCE globally.
 * 2. HTTP 304 Not Modified negotiation avoids unnecessary downstream compilation.
 * 3. Compiles Bloom filter chunks into `global_list_blooms` and extended rules into `global_list_adguard_rules`.
 * 4. Cooperative yielding during line scanning bounds event-loop latency.
 *
 * @returns Sync result containing error message and notModified flag.
 */
export async function syncGlobalList(
  url: string,
  env: Env,
  listModel: ListModel,
  listBloomModel: ListBloomModel,
  now: number
): Promise<SingleListSyncResult> {
  const canonicalUrl = ListModel.normalizeUrl(url);
  const timeoutMs = Number(env.SYNC_TIMEOUT_MS) || 90000;
  const maxListDomains = Number(env.MAX_LIST_DOMAINS) || 500000;
  const maxDomains = Number(env.MAX_SYNC_DOMAINS) || 1000000;
  const maxListBytes = Number(env.MAX_LIST_BYTES) || DEFAULT_MAX_LIST_BYTES;
  const falsePositiveRate = Number(env.BLOOM_FALSE_POSITIVE_RATE) || 0.0001;
  const maxRegexRules = Number(env.MAX_REGEX_RULES) || 1000;

  // Cooperative scheduling parameters
  const yieldBatchSize = Number(env.SYNC_YIELD_BATCH_SIZE) || 5000;
  const yieldSleepMs = Number(env.SYNC_YIELD_SLEEP_MS) || 10;

  const meta = await listModel.getGlobalListMetadata(canonicalUrl);

  const listBloom = BloomFilter.create(maxDomains, falsePositiveRate);
  const adguardPayload: AdGuardPayload = {
    exceptions: [],
    rewrites: {},
    patterns: []
  };

  let count = 0;
  let domainsSinceYield = 0;

  const { error: fetchError, truncated, notModified, etag, lastModified } = await fetchListContent(
    canonicalUrl,
    maxListBytes,
    timeoutMs,
    (rule: ParsedAdGuardRule) => {
      if (count < maxListDomains) {
        if (rule.kind === AdGuardRuleKind.BLOOM_DOMAIN && rule.domain) {
          listBloom.add(rule.domain);
          if (rule.includeSubdomains) {
            listBloom.addPipePipe(rule.domain);
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

        if (domainsSinceYield >= yieldBatchSize) {
          domainsSinceYield = 0;
          return new Promise<void>((resolve) => setTimeout(resolve, yieldSleepMs));
        }
      }
    },
    { etag: meta?.etag, lastModified: meta?.last_modified }
  );

  if (notModified) {
    console.log(`[Sync Global] URL ${canonicalUrl} 304 Not Modified (using cached global bloom).`);
    await listModel.updateGlobalListMetadata(
      canonicalUrl,
      now,
      etag ?? meta?.etag,
      lastModified ?? meta?.last_modified,
      null
    );
    return { syncError: null, notModified: true };
  }

  let syncError: string | null = fetchError;

  if (!fetchError) {
    if (truncated) {
      syncError = `List truncated at ${(maxListBytes / 1024 / 1024).toFixed(0)} MB: Maximum list size reached. Excess rules were omitted.`;
      console.warn(
        `[Sync Global] URL ${canonicalUrl} truncated at ${(maxListBytes / 1024 / 1024).toFixed(0)} MB with ${count} rules. Warning: ${syncError}`
      );
    }

    const saveOps: Promise<any>[] = [
      listBloomModel.upsertListBloom(canonicalUrl, listBloom.toUint8Array().buffer as ArrayBuffer, now)
    ];
    if (env?.DB) {
      saveOps.push(new AdguardRulesModel(env.DB).upsertListRules(canonicalUrl, adguardPayload, now));
    }
    await Promise.all(saveOps);
    if (!truncated) {
      console.log(
        `[Sync Global] successfully updated global list ${canonicalUrl} with ${count} rules.`
      );
    }
  } else {
    console.warn(
      `[Sync Global] failed to fetch/parse global list ${canonicalUrl}. ` +
        `Skipping and keeping old bloom. Error: ${fetchError}`
    );
  }

  await listModel.updateGlobalListMetadata(
    canonicalUrl,
    now,
    etag ?? meta?.etag,
    lastModified ?? meta?.last_modified,
    syncError
  );
  return { syncError, notModified: false };
}

/**
 * Backward-compatible adapter delegating per-profile list sync to the system-side global list synchronizer.
 */
export async function syncSingleList(
  _profileId: string,
  list: { id: number; url: string; etag?: string | null; last_modified?: number | string | null },
  env: Env,
  listModel: ListModel,
  listBloomModel: ListBloomModel,
  now: number
): Promise<SingleListSyncResult> {
  return await syncGlobalList(list.url, env, listModel, listBloomModel, now);
}
