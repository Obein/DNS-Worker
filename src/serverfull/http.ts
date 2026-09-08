/**
 * @file http.ts
 * @description Node.js HTTP server hosting Web UI, REST API, and DoH endpoints for Serverfull mode.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { Buffer } from 'node:buffer';
import worker from '../index';
import { Env, ExecutionContext } from '../types';

export interface HttpServerOptions {
  port: number;
  host: string;
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
  '.webmanifest': 'application/manifest+json'
};

export class HttpServer {
  private server: http.Server | null = null;
  private isRunning: boolean = false;

  constructor(private options: HttpServerOptions) {
    const staticDir = options.staticDir || path.join(process.cwd(), 'static');

    // Attach static asset provider to env.ASSETS
    this.options.env.ASSETS = {
      fetch: async (req: Request): Promise<Response> => {
        try {
          const url = new URL(req.url);
          let pathname = decodeURIComponent(url.pathname);
          if (pathname === '/' || pathname === '') {
            pathname = '/index.html';
          }

          const safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
          const filePath = path.join(staticDir, safePath);

          if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            const ext = path.extname(filePath).toLowerCase();
            const contentType = MIME_TYPES[ext] || 'application/octet-stream';
            const fileContent = fs.readFileSync(filePath);

            return new Response(fileContent, {
              status: 200,
              headers: {
                'Content-Type': contentType,
                'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable'
              }
            });
          }

          return new Response('Not Found', { status: 404 });
        } catch (err) {
          return new Response('Asset Error', { status: 500 });
        }
      }
    };
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const { port, host } = this.options;

      this.server = http.createServer(async (req: http.IncomingMessage, res: http.ServerResponse) => {
        await this.handleHttpRequest(req, res);
      });

      this.server.on('error', (err: Error) => {
        console.error('[HTTP Server] Error:', err);
      });

      this.server.listen(port, host, () => {
        this.isRunning = true;
        console.log(`[HTTP Server] Web Dashboard & DoH listening on http://${host}:${port}`);
        resolve();
      });
    });
  }

  private async handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      const proto = (req.headers['x-forwarded-proto'] as string) || 'http';
      const host = req.headers.host || `${this.options.host}:${this.options.port}`;
      const fullUrl = new URL(req.url || '/', `${proto}://${host}`);

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
          promise.catch((err) => console.error('[HTTP Background Task Error]:', err));
        },
        passThroughOnException() {}
      } as any;

      const response = await worker.fetch(request, this.options.env, ctx);

      res.statusCode = response.status;
      res.statusMessage = response.statusText;

      response.headers.forEach((val, key) => {
        res.setHeader(key, val);
      });

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
      console.error('[HTTP Server] Request processing failed:', err);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Internal Server Error', message: err.message }));
      }
    }
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
