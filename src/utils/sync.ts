import { Env, List, ExecutionContext } from "../types";
import { parseList } from "./parser";
import { BloomFilter } from "./bloom";
import { pipelineCache } from "../pipeline/cache";
import { ProfileModel } from "../models/profile";
import { isSafeUrl } from "./validator";

/**
 * 同步并更新 Profile 关联的规则列表，生成布隆过滤器。
 * 
 * 该函数会拉取所有启用的订阅列表，合并并解析其中的域名，
 * 然后生成高精度的布隆过滤器二进制数据存储在 D1 (profile_blooms 表) 中。
 * 
 * @param profileId - 需要同步的目标 Profile 的 ID
 * @param env - Worker 环境变量，包含 D1 数据库实例等
 * @param ctx - 执行上下文，用于在后台执行缓存清理等异步操作
 */
export async function syncProfileLists(profileId: string, env: Env, ctx: ExecutionContext): Promise<void> {
  const profileModel = new ProfileModel(env.DB);
  const now = Math.floor(Date.now() / 1000);

  try {
    const lists = await profileModel.getLists(profileId);
    
    if (lists.length === 0) {
      // 如果当前 Profile 没有配置任何订阅列表，则清理旧的布隆过滤器数据
      await profileModel.clearProfileBlooms(profileId);
      return;
    }
    const allDomains = new Set<string>();

    // 逐个拉取所有列表的最新的规则文件
    for (const list of lists) {
      let success = false;
      try {
        if (!isSafeUrl(list.url)) {
          console.error(`[Sync] Blocked unsafe URL: ${list.url}`);
        } else {
          const syncTimeoutMs = Number(env.SYNC_TIMEOUT_MS) || 30000;
          const response = await fetch(list.url, { signal: AbortSignal.timeout(syncTimeoutMs) });
          if (response.ok) {
            const contentLength = response.headers.get('content-length');
            const MAX_BYTES = 20 * 1024 * 1024; // 20 MB limit
            if (contentLength && parseInt(contentLength, 10) > MAX_BYTES) {
              console.error(`[Sync] List too large, blocking: ${list.url}`);
            } else {
              const reader = response.body?.getReader();
              if (!reader) {
                console.error(`[Sync] Failed to get reader for: ${list.url}`);
              } else {
                let totalBytes = 0;
                const chunks: Uint8Array[] = [];

                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  if (value) {
                    totalBytes += value.length;
                    if (totalBytes > MAX_BYTES) {
                      throw new Error(`[Sync] Content exceeded maximum size of ${MAX_BYTES} bytes`);
                    }
                    chunks.push(value);
                  }
                }

                const concatenated = new Uint8Array(totalBytes);
                let offset = 0;
                for (const chunk of chunks) {
                  concatenated.set(chunk, offset);
                  offset += chunk.length;
                }
                const textContent = new TextDecoder().decode(concatenated);

                const domains = parseList(textContent);
                if (domains.length > 0) {
                  domains.forEach(d => allDomains.add(d));
                  success = true;
                }
              }
            }
          }
        }
      } catch (e) {
        console.error(`[Sync] Failed to fetch ${list.url}:`, e);
      }

      // 单个列表拉取完毕后更新其同步时间和可用状态
      await profileModel.updateListSyncStatus(list.id, now, success ? 1 : 0);
    }

    let domainArray = Array.from(allDomains);

    if (domainArray.length > 0) {
      // 内存安全上限：尽管 D1 存储通过分块突破了限制，但过大依然会引起 Worker 内存溢出
      if (domainArray.length > 5000000) {
        console.warn(`[Sync] Profile ${profileId} has too many domains (${domainArray.length}). Capping at 5,000,000 for memory safety.`);
        domainArray = domainArray.slice(0, 5000000);
      }

      // 根据提取到的所有拦截域名，构建假阳性率为 0.01% 的高精度布隆过滤器
      const falsePositiveRate = Number(env.BLOOM_FALSE_POSITIVE_RATE) || 0.0001;
      const bloom = BloomFilter.create(domainArray.length, falsePositiveRate);
      domainArray.forEach(d => bloom.add(d));
      const binary = bloom.toUint8Array();

      // 将序列化后的布隆过滤器二进制数据存储到 D1 数据库中
      await profileModel.upsertProfileBloom(profileId, binary.buffer as ArrayBuffer, now);

      // 通知缓存层异步清除此 Profile 的相关解析缓存，以使新规则立刻生效
      if (ctx && typeof ctx.waitUntil === 'function') {
        ctx.waitUntil(pipelineCache.clear(profileId));
      }

      console.log(`[Sync] Profile ${profileId}: ${domainArray.length} domains synced to D1.`);
    }
  } catch (e) {
    console.error(`[Sync] Critical failure for Profile ${profileId}:`, e);
  } finally {
    // 更新整个 Profile 级别的最后同步时间，作为 Cron 定时同步任务的判断依据
    // 放入 finally 确保无论成功失败都会更新时间，防止单个配置错误导致队列永久阻塞
    await profileModel.updateListUpdatedAt(profileId, now);
  }
}
