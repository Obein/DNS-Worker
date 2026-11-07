import { Env, ExecutionContext } from "../../types";
import { ProfileModel } from "../../models/profile";
import { ListModel } from "../../models/list";
import { ProfileBloomModel } from "../../models/profileBloom";
import { ListBloomModel } from "../../models/listBloom";
import { combineAndPromote } from "./combine";
import { syncSingleList, syncGlobalList } from "./singleListSync";

/**
 * 正在执行的同步任务描述
 */
interface InFlightSync {
  type: "all" | "next" | "single" | "rebuild";
  listId?: number;
  promise: Promise<void>;
}

/**
 * 内存级 Profile 同步并发互斥锁（按 profileId 隔离）。
 * 彻底防止多协程导致的大列表重复拉取、内存飙升与 D1 SQLite 数据库写锁冲突。
 */
const inFlightSyncs = new Map<string, InFlightSync>();

/**
 * 检查指定 profile 是否正在进行同步（供监控或测试使用）
 */
export function isProfileSyncing(profileId: string): boolean {
  return inFlightSyncs.has(profileId);
}

/**
 * 仅供测试套件重置互斥锁状态
 */
export function _resetInFlightSyncsForTesting(): void {
  inFlightSyncs.clear();
}

/**
 * 【Cron / 系统侧统一更新专用】
 * 周期性扫描全系统活跃的唯一订阅列表 URL，挑选最陈旧的一个进行网络同步与布隆编译。
 * 若上游列表内容发生实质变动，自动触发所有订阅该列表的 Profile 进行合并晋升。
 * 若上游命中 304 Not Modified，0 重新编译与 0 Profile 级合并消耗。
 */
export async function syncNextGlobalList(
  env: Env,
  ctx: ExecutionContext
): Promise<boolean> {
  const listModel = new ListModel(env.DB);
  const listBloomModel = new ListBloomModel(env.DB);
  const profileBloomModel = new ProfileBloomModel(env.DB);
  const profileModel = new ProfileModel(env.DB);
  const now = Math.floor(Date.now() / 1000);

  const syncIntervalSec = Number(env.SYNC_PROFILE_INTERVAL_SEC) || 86400;
  const cutoffTime = now - syncIntervalSec;

  const staleUrls = await listModel.getDistinctActiveUrls(cutoffTime, 1);
  if (staleUrls.length === 0) {
    return false;
  }

  const targetUrl = staleUrls[0];
  console.log(`[Sync System] Checking unified update for global list: ${targetUrl}`);

  try {
    const { notModified, syncError } = await syncGlobalList(targetUrl, env, listModel, listBloomModel, now);

    if (!notModified && !syncError) {
      // 列表内容发生变动：查找所有订阅此 URL 的已启用 Profile，批量重新合并其布隆过滤器
      const affectedProfiles = await listModel.getProfilesSubscribingToUrl(targetUrl);
      console.log(`[Sync System] List updated: recompiling filters for ${affectedProfiles.length} affected profile(s).`);

      const maxDomains = Number(env.MAX_SYNC_DOMAINS) || 1000000;
      const falsePositiveRate = Number(env.BLOOM_FALSE_POSITIVE_RATE) || 0.0001;

      for (const profileId of affectedProfiles) {
        try {
          await combineAndPromote(
            profileId,
            listModel,
            listBloomModel,
            profileBloomModel,
            profileModel,
            ctx,
            now,
            maxDomains,
            falsePositiveRate,
            env
          );
        } catch (combErr) {
          console.error(`[Sync System] Failed to recombine profile ${profileId}:`, combErr);
        }
      }
    } else if (notModified) {
      console.log(`[Sync System] List ${targetUrl} 304 Not Modified: 0 profiles need recombine.`);
    }

    return true;
  } catch (err) {
    console.error(`[Sync System] Error updating global list ${targetUrl}:`, err);
    return false;
  }
}

/**
 * 【Cron 专用】每次触发时处理指定 Profile 下单个最旧的订阅列表。
 */
export async function syncNextListForProfile(
  profileId: string,
  env: Env,
  ctx: ExecutionContext
): Promise<void> {
  const activeSync = inFlightSyncs.get(profileId);
  if (activeSync) {
    console.log(
      `[Sync] Profile ${profileId}: another sync (${activeSync.type}) is already in-flight. Skipping cron sync pass.`
    );
    return;
  }

  const syncPromise = (async () => {
    try {
      await _executeSyncNextListForProfile(profileId, env, ctx);
    } finally {
      inFlightSyncs.delete(profileId);
    }
  })();

  inFlightSyncs.set(profileId, { type: "next", promise: syncPromise });
  return syncPromise;
}

async function _executeSyncNextListForProfile(
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
      const maxDomains = Number(env.MAX_SYNC_DOMAINS) || 1000000;
      const falsePositiveRate = Number(env.BLOOM_FALSE_POSITIVE_RATE) || 0.0001;

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
        falsePositiveRate,
        env
      );
      return;
    }

    // ── 同步全局列表 ──────────────────────────────────────────────────────────
    const list = pendingLists[0];
    await syncSingleList(profileId, list, env, listModel, listBloomModel, now);

    // ── 检查本周期是否全部完成 ────────────────────────────────────────────────
    const updatedLists = await listModel.getLists(profileId);
    const activeUpdatedLists = updatedLists.filter((l) => !!l.enabled);
    const allDone = activeUpdatedLists.every((l) => (l.last_synced_at ?? 0) > lastFullSync);

    if (allDone) {
      const maxDomains = Number(env.MAX_SYNC_DOMAINS) || 1000000;
      const falsePositiveRate = Number(env.BLOOM_FALSE_POSITIVE_RATE) || 0.0001;

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
        falsePositiveRate,
        env
      );
      console.log(
        `[Sync] Profile ${profileId}: all ${activeUpdatedLists.length} list(s) processed — ` +
          `combined Bloom filter promoted to active.`
      );
    }
  } catch (e) {
    console.error(`[Sync] Critical failure in sync pass for Profile ${profileId}:`, e);
    await profileModel.updateListUpdatedAt(profileId, now);
  }
}

/**
 * 【用户侧 / Profile 手动触发全量合并专用】
 * 用户侧仅合并系统侧已存储编译的过滤器，不向外部源发起冗余的网络请求。
 * 若列表尚未在系统全局编译过，则按需同步一次。
 */
export async function syncAllListsForProfile(
  profileId: string,
  env: Env,
  ctx: ExecutionContext
): Promise<void> {
  const activeSync = inFlightSyncs.get(profileId);
  if (activeSync) {
    if (activeSync.type === "all") {
      console.log(
        `[Sync] Profile ${profileId}: manual sync already in-flight. Joining active promise.`
      );
      return activeSync.promise;
    }
    console.log(
      `[Sync] Profile ${profileId}: waiting for in-flight ${activeSync.type} sync to finish before running manual sync.`
    );
    await activeSync.promise.catch(() => {});
  }

  const postWaitSync = inFlightSyncs.get(profileId);
  if (postWaitSync && postWaitSync.type === "all") {
    return postWaitSync.promise;
  }

  const syncPromise = (async () => {
    try {
      await _executeSyncAllListsForProfile(profileId, env, ctx);
    } finally {
      inFlightSyncs.delete(profileId);
    }
  })();

  inFlightSyncs.set(profileId, { type: "all", promise: syncPromise });
  return syncPromise;
}

async function _executeSyncAllListsForProfile(
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

    // 用户侧仅合并系统侧存储的过滤器：确保缺失全局布隆的个别列表被系统初始化编译一次
    for (const list of activeLists) {
      const hasBloom = await listBloomModel.hasListBloom(list.url);
      if (!hasBloom) {
        await syncGlobalList(list.url, env, listModel, listBloomModel, now);
      }
    }

    await profileModel.updateListUpdatedAt(profileId, now);

    const maxDomains = Number(env.MAX_SYNC_DOMAINS) || 1000000;
    const falsePositiveRate = Number(env.BLOOM_FALSE_POSITIVE_RATE) || 0.0001;

    // 从系统侧全局存储中高速本地合并并晋升
    await combineAndPromote(
      profileId,
      listModel,
      listBloomModel,
      profileBloomModel,
      profileModel,
      ctx,
      now,
      maxDomains,
      falsePositiveRate,
      env
    );
    console.log(`[Sync] Profile ${profileId}: manual recombine cycle complete.`);
  } catch (e) {
    console.error(`[Sync] Critical failure in manual sync for Profile ${profileId}:`, e);
    await profileModel.updateListUpdatedAt(profileId, now);
  }
}

/**
 * 【用户侧 / 单个列表手动触发合并专用】
 * 用户侧仅合并系统侧存储的过滤器，快速重构 Profile 的布隆过滤器与扩展规则。
 */
export async function syncSingleListForProfile(
  profileId: string,
  listId: number,
  env: Env,
  ctx: ExecutionContext
): Promise<void> {
  const activeSync = inFlightSyncs.get(profileId);
  if (activeSync) {
    if (activeSync.type === "single" && activeSync.listId === listId) {
      console.log(
        `[Sync] Profile ${profileId}: sync for list #${listId} already in-flight. Joining active promise.`
      );
      return activeSync.promise;
    }
    if (activeSync.type === "all") {
      console.log(
        `[Sync] Profile ${profileId}: full sync in-flight (covers list #${listId}). Joining active promise.`
      );
      return activeSync.promise;
    }
    console.log(
      `[Sync] Profile ${profileId}: waiting for in-flight ${activeSync.type} sync to finish before syncing list #${listId}.`
    );
    await activeSync.promise.catch(() => {});
  }

  const postWaitSync = inFlightSyncs.get(profileId);
  if (postWaitSync) {
    if (postWaitSync.type === "single" && postWaitSync.listId === listId) {
      return postWaitSync.promise;
    }
    if (postWaitSync.type === "all") {
      return postWaitSync.promise;
    }
  }

  const syncPromise = (async () => {
    try {
      await _executeSyncSingleListForProfile(profileId, listId, env, ctx);
    } finally {
      inFlightSyncs.delete(profileId);
    }
  })();

  inFlightSyncs.set(profileId, { type: "single", listId, promise: syncPromise });
  return syncPromise;
}

async function _executeSyncSingleListForProfile(
  profileId: string,
  listId: number,
  env: Env,
  ctx: ExecutionContext
): Promise<void> {
  const listModel = new ListModel(env.DB);
  const listBloomModel = new ListBloomModel(env.DB);
  const profileBloomModel = new ProfileBloomModel(env.DB);
  const profileModel = new ProfileModel(env.DB);
  const now = Math.floor(Date.now() / 1000);

  try {
    const list = await listModel.getListById(listId, profileId);
    if (!list) {
      console.error(`[Sync] List ${listId} not found in profile ${profileId}`);
      return;
    }

    // 检查系统全局存储中是否已有编译产物，若缺失则补充拉取一次
    const hasBloom = await listBloomModel.hasListBloom(list.url);
    if (!hasBloom) {
      await syncGlobalList(list.url, env, listModel, listBloomModel, now);
    }

    // 用户侧仅合并系统侧存储的过滤器
    if (list.enabled) {
      await profileModel.updateListUpdatedAt(profileId, now);
      await combineAndPromote(
        profileId,
        listModel,
        listBloomModel,
        profileBloomModel,
        profileModel,
        ctx,
        now,
        Number(env.MAX_SYNC_DOMAINS) || 1000000,
        Number(env.BLOOM_FALSE_POSITIVE_RATE) || 0.0001,
        env
      );
    }
    console.log(`[Sync] Profile ${profileId}: list #${listId} merged from system storage.`);
  } catch (e) {
    console.error(`[Sync] Critical failure in single list merge for Profile ${profileId}, list ${listId}:`, e);
  }
}

/**
 * 快速重构并合并 Profile 的布隆过滤器（纯内存合并，不触发外部网络下载）。
 * 适用场景：删除规则列表、切换列表启用/禁用状态等仅改变参与合并的集合、而不改变列表本身内容的场景。
 */
export async function rebuildProfileBloom(
  profileId: string,
  env: Env,
  ctx: ExecutionContext
): Promise<void> {
  const activeSync = inFlightSyncs.get(profileId);
  if (activeSync) {
    console.log(
      `[Sync] Profile ${profileId}: waiting for in-flight ${activeSync.type} sync before rebuilding bloom.`
    );
    await activeSync.promise.catch(() => {});
  }

  const syncPromise = (async () => {
    try {
      await _executeRebuildProfileBloom(profileId, env, ctx);
    } finally {
      inFlightSyncs.delete(profileId);
    }
  })();

  inFlightSyncs.set(profileId, { type: "rebuild", promise: syncPromise });
  return syncPromise;
}

async function _executeRebuildProfileBloom(
  profileId: string,
  env: Env,
  ctx: ExecutionContext
): Promise<void> {
  const listModel = new ListModel(env.DB);
  const listBloomModel = new ListBloomModel(env.DB);
  const profileBloomModel = new ProfileBloomModel(env.DB);
  const profileModel = new ProfileModel(env.DB);

  const profile = await profileModel.getById(profileId);
  const priorListUpdatedAt = profile?.list_updated_at ?? 0;

  const activeLists = (await listModel.getLists(profileId)).filter((l) => !!l.enabled);
  const presence = await Promise.all(
    activeLists.map((l) =>
      listBloomModel
        .hasListBloom(l.url)
        .catch(() => true)
    )
  );

  const missingIndex = presence.findIndex((present) => !present);
  if (missingIndex !== -1) {
    const missing = activeLists[missingIndex];
    try {
      await syncGlobalList(
        missing.url,
        env,
        listModel,
        listBloomModel,
        Math.floor(Date.now() / 1000)
      );
    } catch (e) {
      console.error(`[Sync] fetch of list ${missing.url} during rebuild failed:`, e);
    }
  }

  await combineAndPromote(
    profileId,
    listModel,
    listBloomModel,
    profileBloomModel,
    profileModel,
    ctx,
    Math.floor(Date.now() / 1000),
    Number(env.MAX_SYNC_DOMAINS) || 1000000,
    Number(env.BLOOM_FALSE_POSITIVE_RATE) || 0.0001,
    env
  );

  await profileModel.updateListUpdatedAt(profileId, priorListUpdatedAt);
}
