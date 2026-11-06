import { Env, ExecutionContext } from "../../types";
import { ProfileModel } from "../../models/profile";
import { ListModel } from "../../models/list";
import { ProfileBloomModel } from "../../models/profileBloom";
import { ListBloomModel } from "../../models/listBloom";
import { combineAndPromote } from "./combine";
import { syncSingleList } from "./singleListSync";

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
 * 彻底防止多协程（例如用户连续点击“同步全部”、Cron 定时任务并发触发、或多个列表同时同步）
 * 导致的大列表重复拉取、内存飙升与 D1 SQLite 数据库写锁冲突。
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
 * 【Cron 专用】每次触发时处理**单个**最旧的订阅列表。
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
        falsePositiveRate,
        env
      );
      return;
    }

    // ── 处理单个列表 ──────────────────────────────────────────────────────────
    const list = pendingLists[0];
    await syncSingleList(profileId, list, env, listModel, listBloomModel, now);

    // ── 检查本周期是否全部完成 ────────────────────────────────────────────────
    const updatedLists = await listModel.getLists(profileId);
    const activeUpdatedLists = updatedLists.filter((l) => !!l.enabled);
    const allDone = activeUpdatedLists.every((l) => (l.last_synced_at ?? 0) > lastFullSync);

    if (allDone) {
      const maxDomains = Number(env.MAX_SYNC_DOMAINS) || 1000000;
      const falsePositiveRate = Number(env.BLOOM_FALSE_POSITIVE_RATE) || 0.0001;

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
        falsePositiveRate,
        env
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
        `[Sync] Profile ${profileId}: full sync already in-flight. Joining active promise.`
      );
      return activeSync.promise;
    }
    console.log(
      `[Sync] Profile ${profileId}: waiting for in-flight ${activeSync.type} sync to complete before starting full sync.`
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

    // 依次串行同步所有列表，并在每个列表处理完成后相隔 1 秒，防范 CPU 激增与锁争用
    let anyListModified = false;
    for (let i = 0; i < activeLists.length; i++) {
      const list = activeLists[i];
      const res = await syncSingleList(profileId, list, env, listModel, listBloomModel, now);
      if (!res.notModified) {
        anyListModified = true;
      }
      if (i < activeLists.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    // 若全部列表均命中 304 协商缓存，已有合并布隆完全有效，直接跳过合并晋升阶段，零 CPU/DB 消耗
    if (!anyListModified) {
      await profileModel.updateListUpdatedAt(profileId, now);
      console.log(`[Sync] Profile ${profileId}: all ${activeLists.length} list(s) were 304 Not Modified — skipped combine.`);
      return;
    }

    // 【熔断器】先更新主表时间，以防合并过程中崩溃导致无限重试
    await profileModel.updateListUpdatedAt(profileId, now);

    const maxDomains = Number(env.MAX_SYNC_DOMAINS) || 1000000;
    const falsePositiveRate = Number(env.BLOOM_FALSE_POSITIVE_RATE) || 0.0001;

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
      falsePositiveRate,
      env
    );
    console.log(`[Sync] Profile ${profileId}: manual sync cycle complete.`);
  } catch (e) {
    console.error(`[Sync] Critical failure in manual sync for Profile ${profileId}:`, e);
    // 防止单点故障永久阻塞
    await profileModel.updateListUpdatedAt(profileId, now);
  }
}

/**
 * 【单个列表手动同步专用】针对指定 listId 进行单独同步并触发 Profile 布隆过滤器与 AdGuard 规则重构。
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

    // 1. 单独同步该列表
    const { notModified } = await syncSingleList(profileId, list, env, listModel, listBloomModel, now);

    // 2. 若列表处于启用状态且内容发生变动，触发该 Profile 整体布隆过滤器与 AdGuard 规则的重构合并
    if (list.enabled && !notModified) {
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
    } else if (list.enabled && notModified) {
      await profileModel.updateListUpdatedAt(profileId, now);
      console.log(`[Sync] Profile ${profileId}: single list #${listId} 304 Not Modified — skipped combine.`);
    }
    console.log(`[Sync] Profile ${profileId}: single list #${listId} sync complete.`);
  } catch (e) {
    console.error(`[Sync] Critical failure in single list sync for Profile ${profileId}, list ${listId}:`, e);
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

  // A list can be enabled while it has no bloom yet - added disabled in bulk, or
  // its last sync failed. combineAndPromote would skip it silently, so fetch it
  // first. hasListBloom is an existence probe: getListBloom would concatenate
  // every chunk of every list just to answer a boolean.
  const activeLists = (await listModel.getLists(profileId)).filter((l) => !!l.enabled);
  const presence = await Promise.all(
    activeLists.map((l) =>
      listBloomModel
        .hasListBloom(l.id)
        // Treat an unreadable row as present rather than downloading on a
        // transient D1 error; cron will catch it on its next pass.
        .catch(() => true)
    )
  );

  // Sync the list that is actually missing, rather than delegating to
  // syncNextListForProfile: a list whose sync errored carries a recent
  // last_synced_at, so that picker would fetch a healthy list ahead of it.
  // One per call keeps this bounded; cron handles any others.
  const missingIndex = presence.findIndex((present) => !present);
  if (missingIndex !== -1) {
    const missing = activeLists[missingIndex];
    try {
      await syncSingleList(
        profileId,
        missing,
        env,
        listModel,
        listBloomModel,
        Math.floor(Date.now() / 1000)
      );
    } catch (e) {
      console.error(`[Sync] fetch of list ${missing.id} during rebuild failed:`, e);
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

  // combineAndPromote 会将 list_updated_at 标记为当前时间戳（类似于完成了一个全量同步周期）。
  // 由于本次仅为列表删除后的本地重构合并，并未真正重新下载更新所有列表，因此需恢复先前的 list_updated_at；
  // 否则 Cron 定时任务会误认为刚刚完成了全量更新，从而推迟常规的周期性刷新。
  await profileModel.updateListUpdatedAt(profileId, priorListUpdatedAt);
}
