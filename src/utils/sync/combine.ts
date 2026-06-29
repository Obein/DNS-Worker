import { ExecutionContext } from "../../types";
import { BloomFilter } from "../bloom";
import { pipelineCache } from "../../pipeline/cache";
import { ProfileModel } from "../../models/profile";
import { ListModel } from "../../models/list";
import { ProfileBloomModel } from "../../models/profileBloom";
import { ListBloomModel } from "../../models/listBloom";

/**
 * 汇总并合并所有已启用列表的 Bloom Filter，并将其原子更新为 Profile 的 active Bloom。
 * 
 * 性能优化：不再一次性通过 JOIN 从 D1 加载所有列表的所有 Chunks，
 * 而是依次（分步）单独加载每个列表的完整 Bloom Filter，并在内存中进行按位或合并。
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
  falsePositiveRate: number
): Promise<void> {
  const lists = await listModel.getLists(profileId);
  const activeLists = lists.filter((l) => !!l.enabled);

  if (activeLists.length === 0) {
    // 若没有已同步的列表，清空 profile_blooms
    await profileBloomModel.clearProfileBlooms(profileId);
  } else {
    // 重建并按位或 (OR) 合并所有列表级布隆过滤器
    const merged = BloomFilter.create(maxDomains, falsePositiveRate);
    let hasMergedAny = false;

    for (const list of activeLists) {
      try {
        // 单个列表的 Bloom Filter 反序列化，内存开销上限恒定为 ~2.4MB
        const buf = await listBloomModel.getListBloom(list.id);
        if (buf) {
          const filter = BloomFilter.fromUint8Array(new Uint8Array(buf));
          merged.merge(filter);
          hasMergedAny = true;
        }
      } catch (err) {
        console.error(`[Sync] Failed to load/merge list bloom for list #${list.id}:`, err);
      }
    }

    if (hasMergedAny) {
      const binary = merged.toUint8Array();
      await profileBloomModel.upsertProfileBloom(profileId, binary.buffer as ArrayBuffer, now);
    } else {
      await profileBloomModel.clearProfileBlooms(profileId);
    }
  }

  // 二次确认更新 Profile 主表的时间戳（即使前置步骤已防范性地写入过）
  await profileModel.updateListUpdatedAt(profileId, now);

  if (ctx && typeof ctx.waitUntil === "function") {
    ctx.waitUntil(pipelineCache.clear(profileId));
  }
}
