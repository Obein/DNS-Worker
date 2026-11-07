import { isSafeUrlWithDnsCheck } from "./validator";
import { getListFetcherUserAgent } from "../constants/version";
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
  /** 是否命中了 HTTP 304 Not Modified 协商缓存 */
  notModified?: boolean;
  /** 上游返回的最新 ETag */
  etag?: string | null;
  /** 上游返回的最新 Last-Modified（Unix 秒级时间戳整数） */
  lastModified?: number | null;
}

/** 列表拉取的协商缓存选项 */
export interface FetchListOptions {
  etag?: string | null;
  lastModified?: number | null;
}

/**
 * 将 RFC 7231 / RFC 2616 HTTP-date 时间文本（如 "Wed, 21 Oct 2015 07:28:00 GMT"）
 * 解析为系统统一规范的 Unix 秒级时间戳整数。解析失败或为空时返回 null。
 */
export function parseHttpDateToUnix(headerVal: string | null | undefined): number | null {
  if (!headerVal) return null;
  const parsed = Date.parse(headerVal);
  return isNaN(parsed) ? null : Math.floor(parsed / 1000);
}

/** 回调函数：支持同步返回 void（绝大多数场景），仅在出让 CPU 时返回 Promise */
export type DomainConsumer = (rule: ParsedAdGuardRule) => void | Promise<void>;

/** 瞬态 HTTP 错误状态码，适合自动退避重试 (包含 Cloudflare 525 等边缘错误) */
const TRANSIENT_HTTP_STATUSES = new Set([
  429, // Too Many Requests
  502, // Bad Gateway
  503, // Service Unavailable
  504, // Gateway Timeout
  520, // Cloudflare: Web Server Returned an Unknown Error
  521, // Cloudflare: Web Server Is Down
  522, // Cloudflare: Connection Timed Out
  523, // Cloudflare: Origin Is Unreachable
  524, // Cloudflare: A Timeout Occurred
  525, // Cloudflare: SSL Handshake Failed
  526, // Cloudflare: Invalid SSL Certificate
]);

/** 默认请求头：携带规范的 User-Agent、Accept 与 Accept-Encoding，启用压缩并规避上游防爬虫/限流误杀 */
const DEFAULT_FETCH_HEADERS: HeadersInit = {
  "User-Agent": getListFetcherUserAgent(),
  Accept: "text/plain, text/*, */*",
  "Accept-Encoding": "gzip, deflate, br",
};

const MAX_RETRIES = 2; // 最多重试 2 次（共 3 次请求）
const BASE_RETRY_DELAY_MS = 1000; // 基础退避延迟（1s -> 2s）

/**
 * 已知因源站 TLS 配置（如启用 TLS 重新协商、握手超时或证书链缺陷）导致 Cloudflare Workers
 * 边缘网络抛出 HTTP 525 (SSL Handshake Failed) 的订阅列表与官方 GitHub 镜像映射表。
 * 当请求源站持续 525 时，透明回退至该源的官方 GitHub 镜像，确保零维护开箱即用。
 */
export const KNOWN_TLS_MIRROR_FALLBACKS: Record<string, string> = {
  "https://big.oisd.nl": "https://raw.githubusercontent.com/sjhgvr/oisd/main/abp_big.txt",
  "https://big.oisd.nl/domainswild2": "https://raw.githubusercontent.com/sjhgvr/oisd/main/domainswild2_big.txt",
  "https://small.oisd.nl": "https://raw.githubusercontent.com/sjhgvr/oisd/main/abp_small.txt",
  "https://small.oisd.nl/domainswild2": "https://raw.githubusercontent.com/sjhgvr/oisd/main/domainswild2_small.txt",
};

/**
 * 流式拉取单个订阅列表并逐行解析域名。
 *
 * 性能优化：不再将完整的网络流存入大二进制缓冲区、解码为大字符串并拆分大数组。
 * 而是流式（chunk-by-chunk）进行 UTF-8 文本解码与行切分，对每个域名触发回调。
 * 回调支持同步优先，彻底消除 30 万次 Promise 分配与微任务入队，并将大列表 CPU 运行时间完全打散。
 *
 * 健壮性：内置规范请求头及针对 525/5xx 等瞬态网络抖动的退避重试机制。
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
  onDomain: DomainConsumer,
  options?: FetchListOptions
): Promise<FetchListResult> {
  const deadline = Date.now() + timeoutMs;
  const MAX_REDIRECTS = 5;
  let lastError: string | null = null;
  let activeUrl = url;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    // 若为重试轮次，先等待指数退避时间（需确保剩余总超时预算充足）
    if (attempt > 0) {
      const backoffMs = BASE_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
      const remainingBeforeBackoff = deadline - Date.now();
      if (remainingBeforeBackoff <= backoffMs + 1000) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }

    let currentUrl = activeUrl;
    let redirectCount = 0;
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

        const requestHeaders: Record<string, string> = {
          "User-Agent": getListFetcherUserAgent(),
          Accept: "text/plain, text/*, */*",
          "Accept-Encoding": "gzip, deflate, br",
        };
        // 协商缓存：若已有 ETag 或 Last-Modified，附带条件请求头
        if (options?.etag) {
          requestHeaders["If-None-Match"] = options.etag;
        }
        if (options?.lastModified !== undefined && options?.lastModified !== null) {
          // 将系统统一存储的 Unix 秒级时间戳转换回 RFC 7231 / RFC 2616 HTTP-date 标准协议格式
          const httpDate = typeof options.lastModified === 'number'
            ? new Date(options.lastModified * 1000).toUTCString()
            : String(options.lastModified);
          requestHeaders["If-Modified-Since"] = httpDate;
        }

        response = await fetch(currentUrl, {
          redirect: "manual",
          signal: AbortSignal.timeout(remainingTimeout),
          headers: requestHeaders,
        });

        // Handle HTTP 304 Not Modified conditional response (RFC 7232 / RFC 9110)
        if (response.status === 304) {
          const respEtag = response.headers.get("etag") || options?.etag || null;
          const respLastModified = parseHttpDateToUnix(response.headers.get("last-modified")) ?? options?.lastModified ?? null;
          return {
            count: 0,
            error: null,
            truncated: false,
            notModified: true,
            etag: respEtag,
            lastModified: respLastModified,
          };
        }

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
        // 若遇到 525 (SSL Handshake Failed)，且源站属于已知 Cloudflare TLS 重协商冲突站点，透明回退至官方镜像
        if (response.status === 525) {
          const normalized = currentUrl.replace(/\/+$/, "").toLowerCase();
          const fallback = KNOWN_TLS_MIRROR_FALLBACKS[normalized];
          if (fallback && currentUrl !== fallback) {
            console.warn(
              `[Fetcher] Origin ${currentUrl} failed with HTTP 525 (TLS renegotiation). Falling back to official mirror: ${fallback}`
            );
            activeUrl = fallback;
            currentUrl = fallback;
            continue;
          }
        }

        const statusText = response.statusText || (response.status === 525 ? "SSL Handshake Failed" : "<none>");
        lastError = `HTTP error! Status: ${response.status} ${statusText}`;

        // 若命中瞬态错误码且尚有重试机会与充足超时预算，进入下一轮退避重试
        if (TRANSIENT_HTTP_STATUSES.has(response.status) && attempt < MAX_RETRIES && deadline - Date.now() > 2000) {
          console.warn(
            `[Fetcher] Transient HTTP ${response.status} for ${url}. Retrying attempt ${attempt + 1}/${MAX_RETRIES}...`
          );
          continue;
        }

        return {
          count: 0,
          error: lastError,
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

          // 指针式行扫描：使用 indexOf 遍历换行符，避免为整个缓冲区分配中间数组与大量字符串对象
          let lineStart = 0;
          let newlineIdx: number;
          while ((newlineIdx = buffer.indexOf("\n", lineStart)) !== -1) {
            let lineEnd = newlineIdx;
            // 剥除 Windows CRLF 换行符的 '\r'
            if (lineEnd > lineStart && buffer.charCodeAt(lineEnd - 1) === 13) {
              lineEnd--;
            }
            const line = buffer.slice(lineStart, lineEnd);
            lineStart = newlineIdx + 1;

            const rule = parseAdGuardLine(line);
            if (rule && rule.kind !== AdGuardRuleKind.COMMENT && rule.kind !== AdGuardRuleKind.UNSUPPORTED) {
              const res = onDomain(rule);
              if (res instanceof Promise) {
                await res;
              }
              count++;
            }
          }

          // 仅在当前 chunk 扫描完毕后，对 buffer 进行一次性截取，保留未完结的行碎片
          buffer = lineStart > 0 ? buffer.slice(lineStart) : buffer;
        }
      }

      // 处理流完结后残留的尾行数据
      if (buffer) {
        let line = buffer;
        if (line.charCodeAt(line.length - 1) === 13) {
          line = line.slice(0, -1);
        }
        const rule = parseAdGuardLine(line);
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

      const respEtag = response.headers.get("etag") || null;
      const respLastModified = parseHttpDateToUnix(response.headers.get("last-modified"));

      return {
        count,
        error: null,
        truncated,
        totalBytes,
        notModified: false,
        etag: respEtag,
        lastModified: respLastModified,
      };
    } catch (e: any) {
      lastError = e.message || String(e);
      // 若抛出网络层 TLS 握手异常，同样尝试已知官方镜像回退
      const normalized = currentUrl.replace(/\/+$/, "").toLowerCase();
      const fallback = KNOWN_TLS_MIRROR_FALLBACKS[normalized];
      if (fallback && currentUrl !== fallback) {
        console.warn(
          `[Fetcher] Connection error for ${currentUrl} (${lastError}). Falling back to official mirror: ${fallback}`
        );
        activeUrl = fallback;
        currentUrl = fallback;
        continue;
      }

      if (attempt < MAX_RETRIES && deadline - Date.now() > 2000) {
        console.warn(
          `[Fetcher] Transient network error for ${url}: ${lastError}. Retrying attempt ${attempt + 1}/${MAX_RETRIES}...`
        );
        continue;
      }
      return { count: 0, error: lastError, truncated: false };
    }
  }

  return { count: 0, error: lastError || "Failed to fetch list after retries", truncated: false };
}
