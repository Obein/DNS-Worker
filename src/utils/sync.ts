import { Env, ExecutionContext } from "../types";
import { BloomFilter } from "./bloom";
import { fetchListContent } from "./listFetcher";
import { pipelineCache } from "../pipeline/cache";
import { ProfileModel } from "../models/profile";
import { ListModel } from "../models/list";
import { ProfileBloomModel } from "../models/profileBloom";
import { ListBloomModel } from "../models/listBloom";

// ─── 常量 ─────────────────────────────────────────────────────────────────────

/** 单个列表的字节数上限（5 MB）。超出后软截断，已读部分仍可使用。 */
const MAX_LIST_BYTES = 5 * 1024 * 1024;

// ─── 内部工具 ─────────────────────────────────────────────────────────────────

/**
 * 汇总并合并所有已启用列表的 Bloom Filter，并将其原子更新为 Profile 的 active Bloom。
 * 
 * 性能优化：不再一次性通过 JOIN 从 D1 加载所有列表的所有 Chunks（极大降低单次 D1 payload 导致的 OOM 或反序列化卡顿），
 * 而是依次（分步）单独加载每个列表的完整 Bloom Filter，并在内存中进行按位或合并。
 */
async function combineAndPromote(
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

// ─── 公开 API ─────────────────────────────────────────────────────────────────

/**
 * 【Cron 专用】每次触发时处理**单个**最旧的订阅列表。
 *
 * ## 新增列表级 Bloom 缓存设计 (A/B OR 合并策略)
 *
 * 1. **跳过拉取与旧列表沿用**：当下载/拉取某个列表失败时，跳过该列表的处理，
 *    直接沿用数据库 `list_blooms` 中缓存的该列表上一次成功同步的 Bloom 过滤器，
 *    同时通过 `sync_error` 字段在 D1 中更新记录失败原因，保持列表 `enabled` 不变。
 * 2. **原子按位或合并**：列表处理完成后，重新计算已启用列表的同步状态。
 *    若本周期所有列表处理完毕，则将 `list_blooms` 表中该 profile 的所有最新/沿用的 Bloom Filter
 *    取出并进行按位或 (OR) 合并，最后原子级存入 `profile_blooms` 作为解析过滤的主数据。
 */
export async function syncNextListForProfile(
  profileId: string,
  env: Env,
  ctx: ExecutionContext
): Promise<void> {
  const profileModel = new ProfileModel(env.DB);
  const listModel = new ListModel(env.DB);
  const profileBloomModel = new ProfileBloomModel(env.DB);
  const listBloomModel = new ListBloomModel(env.DB);
  const now = Math.floor(Date.now() / 1000);

  try {
    const profile = await profileModel.getById(profileId);
    if (!profile) {
      console.error(`[Sync] Profile ${profileId} not found.`);
      return;
    }

    const lastFullSync: number = profile.list_updated_at ?? 0;
    const lists = await listModel.getLists(profileId);
    const activeLists = lists.filter((l) => !!l.enabled);

    if (activeLists.length === 0) {
      await profileBloomModel.clearProfileBlooms(profileId);
      await profileModel.updateListUpdatedAt(profileId, now);
      return;
    }

    // ── 新周期检测 ────────────────────────────────────────────────────────────
    const isNewCycle = !activeLists.some((l) => (l.last_synced_at ?? 0) > lastFullSync);

    if (isNewCycle) {
      console.log(`[Sync] Profile ${profileId}: starting a new sync cycle.`);
    }

    // ── 选取下一个待同步列表 ──────────────────────────────────────────────────
    const pendingLists = activeLists
      .filter((l) => (l.last_synced_at ?? 0) <= lastFullSync)
      .sort((a, b) => (a.last_synced_at ?? 0) - (b.last_synced_at ?? 0));

    if (pendingLists.length === 0) {
      // 逻辑重入边际情况：所有列表已完成，进行合并
      const maxDomains = Number(env.MAX_SYNC_DOMAINS) || 1000000;
      const falsePositiveRate = Number(env.BLOOM_FALSE_POSITIVE_RATE) || 0.0001;

      // 【熔断器】在进入高能 CPU 运算前，抢先将时间戳标记为当前时间。
      // 避免万一合并阶段超时崩掉，导致该 Profile 下次仍处于 stale 态，从而陷入每分钟无限重试超时的死循环。
      await profileModel.updateListUpdatedAt(profileId, now);

      await combineAndPromote(
        profileId,
        listModel,
        listBloomModel,
        profileBloomModel,
        profileModel,
        ctx,
        now,
        maxDomains,
        falsePositiveRate
      );
      return;
    }

    // ── 处理单个列表 ──────────────────────────────────────────────────────────
    const list = pendingLists[0];
    const timeoutMs = Number(env.SYNC_TIMEOUT_MS) || 30000;

    const { domains, error: fetchError } = await fetchListContent(
      list.url,
      MAX_LIST_BYTES,
      timeoutMs
    );

    const maxListDomains = Number(env.MAX_LIST_DOMAINS) || 150000;
    const maxDomains = Number(env.MAX_SYNC_DOMAINS) || 1000000;
    const falsePositiveRate = Number(env.BLOOM_FALSE_POSITIVE_RATE) || 0.0001;

    let syncError: string | null = fetchError;

    if (!fetchError) {
      // 创建对应此列表的独立布隆过滤器
      const listBloom = BloomFilter.create(maxDomains, falsePositiveRate);
      const limit = Math.min(domains.length, maxListDomains);
      if (domains.length > maxListDomains) {
        console.warn(
          `[Sync] Domain list truncated to ${maxListDomains} (was ${domains.length}).`
        );
      }

      for (let i = 0; i < limit; i++) {
        listBloom.add(domains[i]);
      }

      // 写入列表级布隆过滤器到数据库
      await listBloomModel.upsertListBloom(list.id, listBloom.toUint8Array().buffer as ArrayBuffer, now);
      console.log(
        `[Sync] Profile ${profileId}: successfully updated list #${list.id} with ${limit} domains.`
      );
    } else {
      // 拉取失败：跳过，并沿用原有列表缓存，记录错误原因，保持启用状态
      console.warn(
        `[Sync] Profile ${profileId}: failed to fetch list #${list.id}. ` +
          `Skipping and keeping old bloom. Error: ${fetchError}`
      );
    }

    // 无论成功还是失败，都更新 last_synced_at 并保持 enabled 开启
    await listModel.updateListSyncStatus(list.id, now, 1, syncError);

    // ── 检查本周期是否全部完成 ────────────────────────────────────────────────
    const updatedLists = await listModel.getLists(profileId);
    const activeUpdatedLists = updatedLists.filter((l) => !!l.enabled);
    const allDone = activeUpdatedLists.every((l) => (l.last_synced_at ?? 0) > lastFullSync);

    if (allDone) {
      // 【熔断器】先标记该 Profile 为 Fresh 态，以防 combineAndPromote 超时 crash 造成死循环重试
      await profileModel.updateListUpdatedAt(profileId, now);

      await combineAndPromote(
        profileId,
        listModel,
        listBloomModel,
        profileBloomModel,
        profileModel,
        ctx,
        now,
        maxDomains,
        falsePositiveRate
      );
      console.log(
        `[Sync] Profile ${profileId}: all ${activeUpdatedLists.length} list(s) processed — ` +
          `promoted combined active bloom.`
      );
    } else {
      const remaining = activeUpdatedLists.filter(
        (l) => (l.last_synced_at ?? 0) <= lastFullSync
      ).length;
      console.log(
        `[Sync] Profile ${profileId}: ${remaining} active list(s) remaining in this cycle.`
      );
    }
  } catch (e) {
    console.error(`[Sync] Critical failure for Profile ${profileId}:`, e);
    // 防止单点故障永久阻塞
    await profileModel.updateListUpdatedAt(profileId, now);
  }
}

/**
 * 【手动/全量同步专用】同步该 Profile 下的所有已启用订阅列表。
 *
 * 用于用户在后台点击“同步所有列表”等手动触发操作。
 * 在单个任务中，按顺序依次同步所有已启用列表，避免 incremental-sync 等待分钟级 Cron。
 */
export async function syncAllListsForProfile(
  profileId: string,
  env: Env,
  ctx: ExecutionContext
): Promise<void> {
  const profileModel = new ProfileModel(env.DB);
  const listModel = new ListModel(env.DB);
  const profileBloomModel = new ProfileBloomModel(env.DB);
  const listBloomModel = new ListBloomModel(env.DB);
  const now = Math.floor(Date.now() / 1000);

  try {
    const profile = await profileModel.getById(profileId);
    if (!profile) {
      console.error(`[Sync] Profile ${profileId} not found.`);
      return;
    }

    const lists = await listModel.getLists(profileId);
    const activeLists = lists.filter((l) => !!l.enabled);

    if (activeLists.length === 0) {
      await profileBloomModel.clearProfileBlooms(profileId);
      await profileModel.updateListUpdatedAt(profileId, now);
      return;
    }

    const maxListDomains = Number(env.MAX_LIST_DOMAINS) || 150000;
    const maxDomains = Number(env.MAX_SYNC_DOMAINS) || 1000000;
    const falsePositiveRate = Number(env.BLOOM_FALSE_POSITIVE_RATE) || 0.0001;
    const timeoutMs = Number(env.SYNC_TIMEOUT_MS) || 30000;

    for (const list of activeLists) {
      const { domains, error: fetchError } = await fetchListContent(
        list.url,
        MAX_LIST_BYTES,
        timeoutMs
      );

      let syncError: string | null = fetchError;

      if (!fetchError) {
        const listBloom = BloomFilter.create(maxDomains, falsePositiveRate);
        const limit = Math.min(domains.length, maxListDomains);
        if (domains.length > maxListDomains) {
          console.warn(
            `[Sync] Domain list truncated to ${maxListDomains} (was ${domains.length}).`
          );
        }

        for (let i = 0; i < limit; i++) {
          listBloom.add(domains[i]);
        }

        await listBloomModel.upsertListBloom(list.id, listBloom.toUint8Array().buffer as ArrayBuffer, now);
        console.log(
          `[Sync] Profile ${profileId} (Manual): successfully updated list #${list.id} with ${limit} domains.`
        );
      } else {
        console.warn(
          `[Sync] Profile ${profileId} (Manual): failed to fetch list #${list.id}. ` +
            `Skipping and keeping old bloom. Error: ${fetchError}`
        );
      }

      await listModel.updateListSyncStatus(list.id, now, 1, syncError);
    }

    // 【熔断器】先更新主表时间，以防合并过程中崩溃导致无限重试
    await profileModel.updateListUpdatedAt(profileId, now);

    // 全部同步完毕后，执行合并和晋升操作
    await combineAndPromote(
      profileId,
      listModel,
      listBloomModel,
      profileBloomModel,
      profileModel,
      ctx,
      now,
      maxDomains,
      falsePositiveRate
    );
    console.log(`[Sync] Profile ${profileId}: manual sync cycle complete.`);
  } catch (e) {
    console.error(`[Sync] Critical failure in manual sync for Profile ${profileId}:`, e);
    // 防止单点故障永久阻塞
    await profileModel.updateListUpdatedAt(profileId, now);
  }
}
