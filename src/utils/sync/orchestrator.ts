import { Env, ExecutionContext } from "../../types";
import { ProfileModel } from "../../models/profile";
import { ListModel } from "../../models/list";
import { ProfileBloomModel } from "../../models/profileBloom";
import { ListBloomModel } from "../../models/listBloom";
import { combineAndPromote } from "./combine";
import { syncSingleList } from "./singleListSync";

/**
 * 【Cron 专用】每次触发时处理**单个**最旧的订阅列表。
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

    // 依次同步所有列表
    for (const list of activeLists) {
      await syncSingleList(profileId, list, env, listModel, listBloomModel, now);
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
      falsePositiveRate
    );
    console.log(`[Sync] Profile ${profileId}: manual sync cycle complete.`);
  } catch (e) {
    console.error(`[Sync] Critical failure in manual sync for Profile ${profileId}:`, e);
    // 防止单点故障永久阻塞
    await profileModel.updateListUpdatedAt(profileId, now);
  }
}
