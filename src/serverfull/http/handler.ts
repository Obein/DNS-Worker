/**
 * @file handler.ts
 * @description HTTP/HTTPS request dispatch handler adapting Node.js requests to Web Fetch standard.
 */

import http from 'node:http';
import { Buffer } from 'node:buffer';
import worker from '../../index';
import { Env, ExecutionContext } from '../../types';
import { extractClientIp } from './clientIp';

/**
 * Creates a shared request dispatch handler for Node.js http and https servers.
 *
 * @param env - Application Env bindings.
 * @param defaultProto - Default protocol ('http' or 'https').
 * @param host - Bound host address.
 * @param port - Bound port number.
 * @param httpsRedirect - Optional redirect settings to upgrade plain HTTP to HTTPS.
 * @returns Request handler callback for http/https.createServer.
 */
export function createHttpRequestHandler(
  env: Env,
  defaultProto: 'http' | 'https',
  host: string,
  port: number,
  httpsRedirect?: { enabled: boolean; httpsPort: number }
): (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void> {
  return async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
    try {
      const forwardedProto = (req.headers['x-forwarded-proto'] as string | undefined)?.toLowerCase();
      const proto = forwardedProto || defaultProto;

      // When TLS certificates are configured and HTTPS is active, automatically redirect plain HTTP requests to HTTPS
      if (defaultProto === 'http' && httpsRedirect?.enabled && forwardedProto !== 'https') {
        const hostHeader = (req.headers.host || `${host}:${port}`).trim();
        const hostname = hostHeader.replace(/:\d+$/, '');
        const targetPort = (httpsRedirect.httpsPort === 443 || httpsRedirect.httpsPort === 0) ? '' : `:${httpsRedirect.httpsPort}`;
        const targetUrl = `https://${hostname}${targetPort}${req.url || '/'}`;

        res.statusCode = (req.method === 'GET' || req.method === 'HEAD') ? 301 : 307;
        res.setHeader('Location', targetUrl);
        res.setHeader('Connection', 'close');
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end(`Redirecting to ${targetUrl}`);
        return;
      }

      const hostHeader = req.headers.host || `${host}:${port}`;
      const fullUrl = new URL(req.url || '/', `${proto}://${hostHeader}`);

      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (!v) continue;
        if (Array.isArray(v)) {
          v.forEach((val) => headers.append(k, val));
        } else {
          headers.set(k, String(v));
        }
      }

      // Populate remote client IP (supports direct connections, Cloudflare, Caddy, Nginx)
      const clientIp = extractClientIp(headers, req.socket.remoteAddress, env.TRUSTED_PROXIES);
      headers.set('CF-Connecting-IP', clientIp);

      // Populate fallback geolocation coordinates for serverfull environments without Cloudflare edge proxy
      const currentLatHeader = headers.get('CF-IPLatitude');
      if (!currentLatHeader || currentLatHeader.trim() === '') {
        headers.set('CF-IPLatitude', '0.0');
      }
      const currentLonHeader = headers.get('CF-IPLongitude');
      if (!currentLonHeader || currentLonHeader.trim() === '') {
        headers.set('CF-IPLongitude', '0.0');
      }

      let body: any = null;
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
        }
        body = Buffer.concat(chunks);
      }

      const request = new Request(fullUrl.toString(), {
        method: req.method,
        headers,
        body,
        // @ts-ignore
        duplex: 'half'
      });

      const ctx: ExecutionContext = {
        waitUntil(promise: Promise<any>) {
          promise.catch((err) => console.error(`[${defaultProto.toUpperCase()} Background Task Error]:`, err));
        },
        passThroughOnException() {}
      } as any;

      const response = await worker.fetch(request, env, ctx);

      res.statusCode = response.status;
      res.statusMessage = response.statusText;

      // Extract all Set-Cookie headers properly without Node.js res.setHeader overwriting
      let rawCookies: string[] = typeof (response.headers as any).getSetCookie === 'function'
        ? (response.headers as any).getSetCookie()
        : [];

      if (rawCookies.length === 0 && response.headers.has('set-cookie')) {
        const singleCookie = response.headers.get('set-cookie');
        if (singleCookie) {
          rawCookies = [singleCookie];
        }
      }

      response.headers.forEach((val, key) => {
        const lowerKey = key.toLowerCase();
        if (lowerKey === 'set-cookie') {
          // Handled separately below to support multiple Set-Cookie headers
          return;
        }
        if (defaultProto === 'https' && lowerKey === 'alt-svc') {
          res.setHeader('Alt-Svc', `h3=":${port}"; ma=86400, h3-29=":${port}"; ma=86400`);
        } else {
          res.setHeader(key, val);
        }
      });

      if (rawCookies.length > 0) {
        // Over plain HTTP (non-TLS), browsers reject cookies marked with 'Secure' (RFC 6265bis).
        // Adapt outgoing cookies by stripping '; Secure' when accessed over plain http.
        const isPlainHttp = proto === 'http';
        const adaptedCookies = isPlainHttp
          ? rawCookies.map((c) => c.replace(/;\s*Secure\b/gi, ''))
          : rawCookies;
        res.setHeader('Set-Cookie', adaptedCookies);
      }

      if (defaultProto === 'https' && !res.hasHeader('Alt-Svc')) {
        res.setHeader('Alt-Svc', `h3=":${port}"; ma=86400, h3-29=":${port}"; ma=86400`);
      }

      if (response.body) {
        const reader = response.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
      }
      res.end();
    } catch (err: any) {
      console.error(`[${defaultProto.toUpperCase()} Server] Request processing failed:`, err);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Internal Server Error' }));
      }
    }
  };
}
