/**
 * @file http.ts
 * @description Node.js HTTP & HTTPS servers hosting Web UI, REST API, and DoH endpoints for Serverfull mode.
 * Re-exports static asset handler, client IP utilities, and request adapter.
 */

import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import { Env } from '../types';
import { formatPortError } from './format';
import { attachStaticAssetHandler } from './http/assets';
import { createHttpRequestHandler } from './http/handler';

export * from './http/assets';
export * from './http/clientIp';
export * from './http/handler';

export interface HttpServerOptions {
  port: number;
  host: string;
  staticDir?: string;
  env: Env;
  httpsRedirect?: {
    enabled: boolean;
    httpsPort: number;
  };
}

export interface HttpsServerOptions {
  port: number;
  host: string;
  certPath: string;
  keyPath: string;
  staticDir?: string;
  env: Env;
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
      const { port, host, env, httpsRedirect } = this.options;
      const handler = createHttpRequestHandler(env, 'http', host, port, httpsRedirect);

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
        const redirectNotice = httpsRedirect?.enabled
          ? ` (Auto-redirecting to HTTPS on port ${httpsRedirect.httpsPort})`
          : '';
        console.log(`[HTTP Server] Web Dashboard & DoH listening on http://${host}:${port}${redirectNotice}`);
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
