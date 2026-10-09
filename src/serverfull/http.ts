/**
 * @file http.ts
 * @description Node.js HTTP & HTTPS servers hosting Web UI, REST API, and DoH endpoints for Serverfull mode.
 */

import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { Buffer } from 'node:buffer';
import worker from '../index';
import { Env, ExecutionContext } from '../types';
import { getPackageRoot } from './config';
import { formatPortError } from './format';

export interface HttpServerOptions {
  port: number;
  host: string;
  staticDir?: string;
  env: Env;
}

export interface HttpsServerOptions {
  port: number;
  host: string;
  certPath: string;
  keyPath: string;
  staticDir?: string;
  env: Env;
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm'
};

/**
 * Attaches the static asset file-serving handler to the worker Env if not already attached.
 *
 * @param env - The Cloudflare/Serverfull Env object.
 * @param staticDir - Optional path to the directory containing static frontend files.
 */
export function attachStaticAssetHandler(env: Env, staticDir?: string): void {
  if (env.ASSETS) return;

  const targetDir = staticDir || path.join(getPackageRoot(), 'static');

  env.ASSETS = {
    fetch: async (req: Request): Promise<Response> => {
      try {
        const url = new URL(req.url);
        let pathname = decodeURIComponent(url.pathname);
        if (pathname === '/' || pathname === '') {
          pathname = '/index.html';
        }

        const safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
        const filePath = path.join(targetDir, safePath);

        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
          const ext = path.extname(filePath).toLowerCase();
          const contentType = MIME_TYPES[ext] || 'application/octet-stream';
          const fileContent = fs.readFileSync(filePath);

          return new Response(fileContent, {
            status: 200,
            headers: {
              'Content-Type': contentType,
              'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
              'Cross-Origin-Opener-Policy': 'same-origin',
              'Cross-Origin-Embedder-Policy': 'credentialless',
              'Cross-Origin-Resource-Policy': 'same-origin'
            }
          });
        }

        return new Response('Not Found', { status: 404 });
      } catch {
        return new Response('Asset Error', { status: 500 });
      }
    }
  };
}

/**
 * Creates a shared request dispatch handler for Node.js http and https servers.
 *
 * @param env - Application Env bindings.
 * @param defaultProto - Default protocol ('http' or 'https').
 * @param host - Bound host address.
 * @param port - Bound port number.
 * @returns Request handler callback for http/https.createServer.
 */
export function createHttpRequestHandler(
  env: Env,
  defaultProto: 'http' | 'https',
  host: string,
  port: number
): (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void> {
  return async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
    try {
      const proto = (req.headers['x-forwarded-proto'] as string) || defaultProto;
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

      // Populate remote IP if not set
      if (!headers.has('CF-Connecting-IP')) {
        const remoteIp = req.socket.remoteAddress?.replace(/^::ffff:/, '') || '127.0.0.1';
        headers.set('CF-Connecting-IP', remoteIp);
      }

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

/**
 * Plain HTTP Server hosting Web UI and DoH (default port: 10080).
 */
export class HttpServer {
  private server: http.Server | null = null;
  private isRunning: boolean = false;

  constructor(private options: HttpServerOptions) {
    attachStaticAssetHandler(this.options.env, this.options.staticDir);
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const { port, host, env } = this.options;
      const handler = createHttpRequestHandler(env, 'http', host, port);

      this.server = http.createServer(handler);

      // Optimize HTTP keepalive timeouts and disable Nagle's algorithm for low-latency DoH
      this.server.keepAliveTimeout = 65000;
      this.server.headersTimeout = 66000;
      this.server.on('connection', (socket) => {
        socket.setNoDelay(true);
      });

      const startupErrorHandler = (err: any) => {
        this.server = null;

        console.error(formatPortError({
          serviceName: 'Web Dashboard & DoH (HTTP)',
          protocol: 'HTTP',
          port,
          err,
          alternateOption: `--http-port <port> (e.g. --http-port ${port + 1})`
        }));

        reject(err);
      };

      this.server.once('error', startupErrorHandler);

      this.server.listen(port, host, () => {
        this.server?.removeListener('error', startupErrorHandler);
        this.server?.on('error', (err: Error) => {
          console.error('[HTTP Server] Runtime error:', err);
        });
        this.isRunning = true;
        console.log(`[HTTP Server] Web Dashboard & DoH listening on http://${host}:${port}`);
        resolve();
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server && this.isRunning) {
        this.server.close(() => {
          this.isRunning = false;
          console.log('[HTTP Server] Service stopped.');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}

/**
 * Secure HTTPS Server hosting Web UI and DoH (default port: 10443).
 * Activated only when valid TLS certificates are provided.
 */
export class HttpsServer {
  private server: https.Server | null = null;
  private isRunning: boolean = false;

  constructor(private options: HttpsServerOptions) {
    attachStaticAssetHandler(this.options.env, this.options.staticDir);
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const { port, host, certPath, keyPath, env } = this.options;

      try {
        const cert = fs.readFileSync(certPath);
        const key = fs.readFileSync(keyPath);

        const handler = createHttpRequestHandler(env, 'https', host, port);
        this.server = https.createServer({ cert, key }, handler);

        this.server.keepAliveTimeout = 65000;
        this.server.headersTimeout = 66000;
        this.server.on('connection', (socket) => {
          socket.setNoDelay(true);
        });

        const startupErrorHandler = (err: any) => {
          this.server = null;

          console.error(formatPortError({
            serviceName: 'Web Dashboard & DoH (HTTPS)',
            protocol: 'HTTPS',
            port,
            err,
            alternateOption: `--https-port <port> (e.g. --https-port ${port + 1})`
          }));

          reject(err);
        };

        this.server.once('error', startupErrorHandler);

        this.server.listen(port, host, () => {
          this.server?.removeListener('error', startupErrorHandler);
          this.server?.on('error', (err: Error) => {
            console.error('[HTTPS Server] Runtime error:', err);
          });
          this.isRunning = true;
          console.log(`[HTTPS Server] Web Dashboard & DoH listening on https://${host}:${port}`);
          resolve();
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server && this.isRunning) {
        this.server.close(() => {
          this.isRunning = false;
          console.log('[HTTPS Server] Service stopped.');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}
