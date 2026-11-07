/**
 * @file http2Client.ts
 * @description Native HTTP/2 client session pool for high-performance DoH queries (RFC 8484).
 * Supports connection multiplexing, automatic reconnects, and idle session cleanup.
 */

import type { ClientHttp2Session } from 'node:http2';
import { getAppUserAgent } from '../constants/version';

/**
 * Result returned by an HTTP/2 query.
 */
export interface Http2Response {
  /** HTTP response status code (e.g. 200). */
  status: number;
  /** Binary response payload (DNS wireformat). */
  answer: Uint8Array;
  /** Response headers. */
  headers: Record<string, string | string[] | undefined>;
}

/**
 * Determines whether HTTP/2 is natively supported in the current runtime.
 * Evaluates Node.js runtime and ensures cloudflare:sockets / stub environments are safely bypassed.
 *
 * @returns boolean True if native node:http2 client is available.
 */
export function isHttp2Supported(): boolean {
  const isCloudflare =
    (typeof navigator !== 'undefined' && navigator.userAgent === 'Cloudflare-Workers') ||
    typeof WebSocketPair !== 'undefined';
  const isNode = !isCloudflare && typeof process !== 'undefined' && !!process.versions?.node;
  return isNode;
}

/**
 * Connection pool managing active ClientHttp2Session instances per origin.
 */
export class Http2SessionPool {
  private sessions = new Map<string, ClientHttp2Session>();
  private http2Module: typeof import('node:http2') | null = null;

  /**
   * Lazily loads the node:http2 module in Node.js environments.
   */
  private async getHttp2Module(): Promise<typeof import('node:http2')> {
    if (!this.http2Module) {
      this.http2Module = await import('node:http2');
    }
    return this.http2Module;
  }

  /**
   * Retrieves an active HTTP/2 session for the given origin or establishes a new one.
   *
   * @param origin - Target origin string (e.g. 'https://dns.quad9.net').
   * @returns Active ClientHttp2Session.
   */
  public async getSession(origin: string): Promise<ClientHttp2Session> {
    const existing = this.sessions.get(origin);
    if (existing && !existing.closed && !existing.destroyed) {
      return existing;
    }

    const http2 = await this.getHttp2Module();
    const session = http2.connect(origin);

    session.on('error', (err: Error) => {
      // Evict session from pool on error
      this.sessions.delete(origin);
    });

    session.on('close', () => {
      this.sessions.delete(origin);
    });

    // Unref socket so it does not prevent Node process termination
    if (typeof session.unref === 'function') {
      session.unref();
    }

    this.sessions.set(origin, session);
    return session;
  }

  /**
   * Sends a DNS query over HTTP/2 using RFC 8484 POST framing.
   *
   * @param url - Parsed target DoH URL.
   * @param queryRaw - Wire-format DNS query packet.
   * @param timeoutMs - Request timeout in milliseconds (default 5000).
   * @returns Promise resolving to the HTTP/2 response.
   */
  public async request(url: URL, queryRaw: Uint8Array, timeoutMs = 5000): Promise<Http2Response> {
    const http2 = await this.getHttp2Module();
    const session = await this.getSession(url.origin);

    return new Promise<Http2Response>((resolve, reject) => {
      let isSettled = false;

      const timer = setTimeout(() => {
        if (!isSettled) {
          isSettled = true;
          try {
            req.destroy(new Error(`HTTP/2 Request Timeout (${timeoutMs}ms)`));
          } catch {}
          reject(new Error(`HTTP/2 Request Timeout (${timeoutMs}ms)`));
        }
      }, timeoutMs);

      const req = session.request({
        [http2.constants.HTTP2_HEADER_METHOD]: 'POST',
        [http2.constants.HTTP2_HEADER_PATH]: url.pathname + url.search,
        [http2.constants.HTTP2_HEADER_SCHEME]: url.protocol.replace(':', ''),
        'accept': 'application/dns-message',
        'content-type': 'application/dns-message',
        'content-length': String(queryRaw.length),
        'user-agent': getAppUserAgent()
      });

      let status = 0;
      const chunks: Buffer[] = [];
      let responseHeaders: Record<string, string | string[] | undefined> = {};

      req.on('response', (headers) => {
        status = Number(headers[http2.constants.HTTP2_HEADER_STATUS]) || 0;
        responseHeaders = headers;
      });

      req.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });

      req.on('end', () => {
        if (!isSettled) {
          isSettled = true;
          clearTimeout(timer);
          const body = Buffer.concat(chunks);
          resolve({
            status,
            answer: new Uint8Array(body.buffer, body.byteOffset, body.byteLength),
            headers: responseHeaders
          });
        }
      });

      req.on('error', (err: Error) => {
        if (!isSettled) {
          isSettled = true;
          clearTimeout(timer);
          // If session is unhealthy, remove it from pool
          this.sessions.delete(url.origin);
          reject(err);
        }
      });

      req.write(Buffer.from(queryRaw));
      req.end();
    });
  }

  /**
   * Closes all active HTTP/2 sessions in the pool.
   */
  public closeAll(): void {
    for (const [origin, session] of this.sessions.entries()) {
      try {
        if (!session.closed && !session.destroyed) {
          session.close();
        }
      } catch {}
      this.sessions.delete(origin);
    }
  }
}

/**
 * Global shared HTTP/2 session pool singleton.
 */
export const http2SessionPool = new Http2SessionPool();
