import { isSafeUrl } from "./validator";
import { parseLine } from "./parser";

/** 单个列表的拉取结果 */
export interface FetchListResult {
  /** 成功解析并由回调接收的域名总数 */
  count: number;
  /** 错误信息；成功时为 null */
  error: string | null;
}

/**
 * 流式拉取单个订阅列表并逐行解析域名。
 *
 * 性能优化：不再将完整的网络流存入大二进制缓冲区、解码为大字符串并拆分大数组。
 * 而是流式（chunk-by-chunk）进行 UTF-8 文本解码与行切分，对每个域名触发异步回调。
 * 这将内存开销由 40MB+ 降为 <1MB，并将大列表 CPU 运行时间完全打散，从根本上防止 exceeded CPU limit。
 *
 * @param url - 订阅列表的 HTTP(S) URL
 * @param maxBytes - 单个列表的字节数上限（软截断，超出后停止读取）
 * @param timeoutMs - 请求超时时间（毫秒）
 * @param onDomain - 当提取出有效域名时的异步回调函数
 * @returns 解析的域名数量与错误信息
 */
export async function fetchListContent(
  url: string,
  maxBytes: number,
  timeoutMs: number,
  onDomain: (domain: string) => Promise<void>
): Promise<FetchListResult> {
  if (!isSafeUrl(url)) {
    return {
      count: 0,
      error: "Invalid list URL. Private networks and localhosts are not allowed.",
    };
  }

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });

    if (!response.ok) {
      return {
        count: 0,
        error: `HTTP error! Status: ${response.status} ${response.statusText}`,
      };
    }

    // 通过 Content-Length 快速拒绝明显超限的列表
    const contentLength = response.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > maxBytes) {
      return {
        count: 0,
        error: `List too large (${(parseInt(contentLength, 10) / 1024 / 1024).toFixed(2)} MB), limit is ${(maxBytes / 1024 / 1024).toFixed(0)} MB`,
      };
    }

    const reader = response.body?.getReader();
    if (!reader) {
      return { count: 0, error: "Failed to get stream reader from response" };
    }

    const decoder = new TextDecoder("utf-8", { fatal: false, ignoreBOM: true });
    let buffer = "";
    let count = 0;
    let totalBytes = 0;
    let truncated = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        totalBytes += value.length;
        if (totalBytes > maxBytes) {
          await reader.cancel();
          truncated = true;
          break;
        }

        // 流式解码 UTF-8，处理边界字符
        const chunkText = decoder.decode(value, { stream: true });
        buffer += chunkText;

        // 快速切分出完整行
        const lines = buffer.split("\n");
        // 最后一个元素若没有换行符则为未完结的行碎片，留到下一次迭代拼接
        buffer = lines.pop() || "";

        for (const line of lines) {
          const domain = parseLine(line);
          if (domain) {
            await onDomain(domain);
            count++;
          }
        }
      }
    }

    // 处理流完结后残留的尾行数据
    if (buffer) {
      const domain = parseLine(buffer);
      if (domain) {
        await onDomain(domain);
        count++;
      }
    }

    if (truncated) {
      console.warn(`[Fetcher] List truncated at ${(maxBytes / 1024 / 1024).toFixed(0)} MB: ${url}`);
    }

    return { count, error: null };
  } catch (e: any) {
    return { count: 0, error: e.message || String(e) };
  }
}
