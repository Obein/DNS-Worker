import { Env } from "../../types";
import { BloomFilter } from "../bloom";
import { fetchListContent } from "../listFetcher";
import { ListModel } from "../../models/list";
import { ListBloomModel } from "../../models/listBloom";

const MAX_LIST_BYTES = 5 * 1024 * 1024;

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
  const timeoutMs = Number(env.SYNC_TIMEOUT_MS) || 30000;
  const maxListDomains = Number(env.MAX_LIST_DOMAINS) || 500000;
  const maxDomains = Number(env.MAX_SYNC_DOMAINS) || 1000000;
  const falsePositiveRate = Number(env.BLOOM_FALSE_POSITIVE_RATE) || 0.0001;

  // 创建对应的列表布隆过滤器
  const listBloom = BloomFilter.create(maxDomains, falsePositiveRate);
  let count = 0;

  // 流式下载并按行解析域名，直接往布隆过滤器里塞
  const { error: fetchError } = await fetchListContent(
    list.url,
    MAX_LIST_BYTES,
    timeoutMs,
    async (domain) => {
      if (count < maxListDomains) {
        listBloom.add(domain);
        count++;

        // 每处理 50k 个域名让出一次 CPU 喘息时间，平摊高能 CPU 负载
        if (count % 50000 === 0) {
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }
    }
  );

  let syncError: string | null = fetchError;

  if (!fetchError) {
    // 写入列表级布隆过滤器到数据库
    await listBloomModel.upsertListBloom(list.id, listBloom.toUint8Array().buffer as ArrayBuffer, now);
    console.log(
      `[Sync] Profile ${profileId}: successfully updated list #${list.id} with ${count} domains.`
    );
  } else {
    // 拉取失败：跳过，并沿用原有列表缓存，记录错误原因，保持启用状态
    console.warn(
      `[Sync] Profile ${profileId}: failed to fetch/parse list #${list.id}. ` +
        `Skipping and keeping old bloom. Error: ${fetchError}`
    );
  }

  // 无论成功还是失败，都更新 last_synced_at 并保持 enabled 开启
  await listModel.updateListSyncStatus(list.id, now, 1, syncError);
  return syncError;
}
