import { Env, List, ExecutionContext } from "../types";
import { parseList } from "./parser";
import { BloomFilter } from "./bloom";
import { pipelineCache } from "../pipeline/cache";

/**
 * 纯 R2 同步逻辑：不再依赖 profiles 表中的 list_bloom 字段
 */
export async function syncProfileLists(profileId: string, env: Env, ctx: ExecutionContext): Promise<void> {
  const { results: lists } = await env.DB.prepare("SELECT id, url FROM lists WHERE profile_id = ?").bind(profileId).all<List>();
  
  if (lists.length === 0) {
    // 如果没有订阅列表，清理旧数据
    await env.DB.prepare("DELETE FROM profile_blooms WHERE profile_id = ?").bind(profileId).run();
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  const allDomains = new Set<string>();

  for (const list of lists) {
    let success = false;
    try {
      const response = await fetch(list.url, { signal: AbortSignal.timeout(30000) });
      if (response.ok) {
        const domains = parseList(await response.text());
        if (domains.length > 0) {
          domains.forEach(d => allDomains.add(d));
          success = true;
        }
      }
    } catch (e) {
      console.error(`[Sync] Failed to fetch ${list.url}:`, e);
    }

    // 更新各列表的同步时间和状态 (如果失败或列表为空则设为未启用)
    await env.DB.prepare("UPDATE lists SET last_synced_at = ?, enabled = ? WHERE id = ?").bind(now, success ? 1 : 0, list.id).run();
  }

  const domainArray = Array.from(allDomains);

  if (domainArray.length > 0) {
    // 构建高精度布隆过滤器 (10^-3)
    const falsePositiveRate = 0.001;
    const bloom = BloomFilter.create(domainArray.length, falsePositiveRate);
    domainArray.forEach(d => bloom.add(d));
    const binary = bloom.toUint8Array();

    // 存储至 D1
    await env.DB.prepare(
      "INSERT INTO profile_blooms (profile_id, bloom_filter, updated_at) VALUES (?, ?, ?) ON CONFLICT(profile_id) DO UPDATE SET bloom_filter = excluded.bloom_filter, updated_at = excluded.updated_at"
    ).bind(profileId, binary.buffer, now).run();

    // 异步清理缓存
    if (ctx && typeof ctx.waitUntil === 'function') {
      ctx.waitUntil(pipelineCache.clear(profileId));
    }

    console.log(`[Sync] Profile ${profileId}: ${domainArray.length} domains synced to D1.`);
  }
}
