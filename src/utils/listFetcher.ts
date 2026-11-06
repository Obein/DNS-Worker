import { isSafeUrlWithDnsCheck } from "./validator";
import { parseAdGuardLine, AdGuardRuleKind, ParsedAdGuardRule } from "../lib/adguard";

/** 单个列表的拉取结果 */
export interface FetchListResult {
  /** 成功解析并由回调接收的有效规则总数 */
  count: number;
  /** 错误信息；成功时为 null */
  error: string | null;
  /** 是否因超出单列表最大字节数被截断 */
  truncated: boolean;
  /** 实际处理字节数 */
  totalBytes?: number;
}

/** 回调函数：支持同步返回 void（绝大多数场景），仅在出让 CPU 时返回 Promise */
export type DomainConsumer = (rule: ParsedAdGuardRule) => void | Promise<void>;

/**
 * 流式拉取单个订阅列表并逐行解析域名。
 *
 * 性能优化：不再将完整的网络流存入大二进制缓冲区、解码为大字符串并拆分大数组。
 * 而是流式（chunk-by-chunk）进行 UTF-8 文本解码与行切分，对每个域名触发回调。
 * 回调支持同步优先，彻底消除 30 万次 Promise 分配与微任务入队，并将大列表 CPU 运行时间完全打散。
 *
 * @param url - 订阅列表的 HTTP(S) URL
 * @param maxBytes - 单个列表的字节数上限（软截断，超出后停止读取）
 * @param timeoutMs - 请求超时时间（毫秒）
 * @param onDomain - 当提取出有效域名时的回调函数（支持同步与协作式出让 Promise）
 * @returns 解析的域名数量与错误信息
 */
export async function fetchListContent(
  url: string,
  maxBytes: number,
  timeoutMs: number,
  onDomain: DomainConsumer
): Promise<FetchListResult> {
  const deadline = Date.now() + timeoutMs;
  let currentUrl = url;
  let redirectCount = 0;
  const MAX_REDIRECTS = 5;
  let response: Response;

  try {
    while (true) {
      if (!(await isSafeUrlWithDnsCheck(currentUrl))) {
        return {
          count: 0,
          error: "Invalid list URL. Private networks, localhosts, and internal domains are not allowed.",
          truncated: false,
        };
      }

      const remainingTimeout = deadline - Date.now();
      if (remainingTimeout <= 0) {
        return { count: 0, error: "Request timed out", truncated: false };
      }

      response = await fetch(currentUrl, {
        redirect: "manual",
        signal: AbortSignal.timeout(remainingTimeout),
      });

      // Handle HTTP 3xx redirects securely (RFC 7231 / RFC 7538)
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) {
          return {
            count: 0,
            error: `Redirect status ${response.status} without Location header`,
            truncated: false,
          };
        }

        redirectCount++;
        if (redirectCount > MAX_REDIRECTS) {
          return {
            count: 0,
            error: `Too many redirects (max ${MAX_REDIRECTS})`,
            truncated: false,
          };
        }

        try {
          const nextUrl = new URL(location, currentUrl).toString();
          const nextProto = new URL(nextUrl).protocol;
          if (nextProto !== "http:" && nextProto !== "https:") {
            return {
              count: 0,
              error: `Invalid redirect protocol: ${nextProto}`,
              truncated: false,
            };
          }
          currentUrl = nextUrl;
          continue;
        } catch {
          return {
            count: 0,
            error: `Invalid redirect location: ${location}`,
            truncated: false,
          };
        }
      }

      break;
    }

    if (!response.ok) {
      return {
        count: 0,
        error: `HTTP error! Status: ${response.status} ${response.statusText}`,
        truncated: false,
      };
    }

    // 通过 Content-Length 快速拒绝明显超限的列表
    const contentLength = response.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > maxBytes) {
      return {
        count: 0,
        error: `List too large (${(parseInt(contentLength, 10) / 1024 / 1024).toFixed(2)} MB), limit is ${(maxBytes / 1024 / 1024).toFixed(0)} MB`,
        truncated: true,
      };
    }

    const reader = response.body?.getReader();
    if (!reader) {
      return { count: 0, error: "Failed to get stream reader from response", truncated: false };
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
          const rule = parseAdGuardLine(line);
          if (rule && rule.kind !== AdGuardRuleKind.COMMENT && rule.kind !== AdGuardRuleKind.UNSUPPORTED) {
            const res = onDomain(rule);
            if (res instanceof Promise) {
              await res;
            }
            count++;
          }
        }
      }
    }

    // 处理流完结后残留的尾行数据
    if (buffer) {
      const rule = parseAdGuardLine(buffer);
      if (rule && rule.kind !== AdGuardRuleKind.COMMENT && rule.kind !== AdGuardRuleKind.UNSUPPORTED) {
        const res = onDomain(rule);
        if (res instanceof Promise) {
          await res;
        }
        count++;
      }
    }

    if (truncated) {
      console.warn(`[Fetcher] List truncated at ${(maxBytes / 1024 / 1024).toFixed(0)} MB: ${url}`);
    }

    return { count, error: null, truncated, totalBytes };
  } catch (e: any) {
    return { count: 0, error: e.message || String(e), truncated: false };
  }
}
