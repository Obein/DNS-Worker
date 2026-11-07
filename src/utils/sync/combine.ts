import { Env, ExecutionContext } from "../../types";
import { BloomFilter } from "../bloom";
import { pipelineCache } from "../../pipeline/cache";
import { ProfileModel } from "../../models/profile";
import { ListModel } from "../../models/list";
import { ProfileBloomModel } from "../../models/profileBloom";
import { ListBloomModel } from "../../models/listBloom";
import { AdguardRulesModel } from "../../models/adguardRules";
import { AdGuardPayload } from "../../lib/adguard/types";

/**
 * 汇总并合并所有已启用列表的 Bloom Filter 与 AdGuard 扩展规则，并原子更新为 Profile 的 active 状态。
 * 
 * 性能优化：依次单独加载每个列表的 Bloom Filter 在内存中进行按位或合并，
 * 并将所有 AdGuard 扩展规则（例外、重写、正则池）汇总存入 profile_adguard_rules。
 */
export async function combineAndPromote(
  profileId: string,
  listModel: ListModel,
  listBloomModel: ListBloomModel,
  profileBloomModel: ProfileBloomModel,
  profileModel: ProfileModel,
  ctx: ExecutionContext,
  now: number,
  maxDomains: number,
  falsePositiveRate: number,
  env?: Env
): Promise<void> {
  const lists = await listModel.getLists(profileId);
  const activeLists = lists.filter((l) => !!l.enabled);
  const adguardRulesModel = env?.DB ? new AdguardRulesModel(env.DB) : null;

  if (activeLists.length === 0) {
    // 若没有已同步的列表，清空 profile_blooms 与 profile_adguard_rules
    await Promise.all([
      profileBloomModel.clearProfileBlooms(profileId),
      adguardRulesModel?.clearProfileRules(profileId)
    ]);
  } else if (activeLists.length === 1) {
    // 性能优化：单列表短路晋升 (Single-List Direct Promotion)
    // 仅有 1 个列表时直接复用其全局 Bloom 与规则，彻底跳过内存重建与循环合并开销
    const single = activeLists[0];
    const [buf, listRules] = await Promise.all([
      listBloomModel.getListBloom(single.url),
      adguardRulesModel ? adguardRulesModel.getListRules(single.url) : Promise.resolve(null)
    ]);

    const saveOps: Promise<any>[] = [];
    if (buf) {
      saveOps.push(profileBloomModel.upsertProfileBloom(profileId, buf, now));
    } else {
      saveOps.push(profileBloomModel.clearProfileBlooms(profileId));
    }
    if (adguardRulesModel) {
      const payload: AdGuardPayload = listRules || { exceptions: [], rewrites: {}, patterns: [] };
      saveOps.push(adguardRulesModel.upsertProfileRules(profileId, payload, now));
    }
    await Promise.all(saveOps);
  } else {
    // 重建并按位或 (OR) 合并所有列表级布隆过滤器，并汇总 AdGuard 规则
    const merged = BloomFilter.create(maxDomains, falsePositiveRate);
    let hasMergedAny = false;

    const mergedAdguard: AdGuardPayload = {
      exceptions: [],
      rewrites: {},
      patterns: []
    };
    const maxRegexRules = Number(env?.MAX_REGEX_RULES) || 1000;
    const seenExceptions = new Set<string>();

    for (const list of activeLists) {
      try {
        // 1. Bloom Filter 单列表合并
        const buf = await listBloomModel.getListBloom(list.url);
        if (buf) {
          const filter = BloomFilter.fromUint8Array(new Uint8Array(buf));
          merged.merge(filter);
          hasMergedAny = true;
        }

        // 2. AdGuard 扩展规则合并
        if (adguardRulesModel) {
          const listRules = await adguardRulesModel.getListRules(list.url);
          if (listRules) {
            if (Array.isArray(listRules.exceptions)) {
              for (const exc of listRules.exceptions) {
                const key = `${exc.domain}:${exc.includeSubdomains ? 1 : 0}`;
                if (!seenExceptions.has(key)) {
                  seenExceptions.add(key);
                  mergedAdguard.exceptions.push(exc);
                }
              }
            }
            if (listRules.rewrites && typeof listRules.rewrites === "object") {
              Object.assign(mergedAdguard.rewrites, listRules.rewrites);
            }
            if (Array.isArray(listRules.patterns)) {
              for (const pat of listRules.patterns) {
                if (mergedAdguard.patterns.length < maxRegexRules) {
                  mergedAdguard.patterns.push(pat);
                }
              }
            }
          }
        }
      } catch (err) {
        console.error(`[Sync] Failed to load/merge rules for list #${list.id}:`, err);
      }
    }

    if (hasMergedAny) {
      const binary = merged.toUint8Array();
      await profileBloomModel.upsertProfileBloom(profileId, binary.buffer as ArrayBuffer, now);
    } else {
      await profileBloomModel.clearProfileBlooms(profileId);
    }

    if (adguardRulesModel) {
      await adguardRulesModel.upsertProfileRules(profileId, mergedAdguard, now);
    }
  }

  // 二次确认更新 Profile 主表的时间戳（即使前置步骤已防范性地写入过）
  await profileModel.updateListUpdatedAt(profileId, now);

  if (ctx && typeof ctx.waitUntil === "function") {
    ctx.waitUntil(pipelineCache.clear(profileId, true, env));
  }
}
