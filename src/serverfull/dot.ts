/**
 * @file dot.ts
 * @description DNS over TLS (DoT - RFC 7858) server with TLS SNI Profile routing for Serverfull mode.
 */

import fs from 'node:fs';
import tls from 'node:tls';
import { Buffer } from 'node:buffer';
import { Env, Context, ExecutionContext } from '../types';
import { parseDNSQueryFromRaw } from '../utils/dns';
import { pipeline } from '../pipeline';
import { resolveDefaultProfile, resolveProfileByKey } from '../api/doh';
import { ACCESS_KEY_REGEX } from '../utils/validator';

export interface DotServerOptions {
  port: number;
  host: string;
  tlsKeyPath: string;
  tlsCertPath: string;
  defaultProfileKey?: string;
  env: Env;
}

export class DotDnsServer {
  private server: tls.Server | null = null;
  private isRunning: boolean = false;

  constructor(private options: DotServerOptions) {}

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const { tlsKeyPath, tlsCertPath, port, host } = this.options;

      if (!tlsKeyPath || !tlsCertPath) {
        console.warn('[DoT] TLS key or certificate path not configured. Skipping DoT server start.');
        console.warn('[DoT] Set SERVERFULL_TLS_KEY_PATH and SERVERFULL_TLS_CERT_PATH to enable DoT.');
        resolve();
        return;
      }

      if (!fs.existsSync(tlsKeyPath) || !fs.existsSync(tlsCertPath)) {
        console.warn(`[DoT] TLS files not found:\n  Key: ${tlsKeyPath}\n  Cert: ${tlsCertPath}\nSkipping DoT server.`);
        resolve();
        return;
      }

      try {
        const tlsOptions: tls.TlsOptions = {
          key: fs.readFileSync(tlsKeyPath),
          cert: fs.readFileSync(tlsCertPath),
          ALPNProtocols: ['dot']
        };

        this.server = tls.createServer(tlsOptions, (socket: tls.TLSSocket) => {
          this.handleConnection(socket);
        });

        this.server.on('error', (err: Error) => {
          console.error('[DoT] Server error:', err);
        });

        this.server.listen(port, host, () => {
          this.isRunning = true;
          console.log(`[DoT] DNS over TLS listening on tls://${host}:${port}`);
          resolve();
        });
      } catch (err) {
        console.error('[DoT] Failed to initialize TLS server:', err);
        reject(err);
      }
    });
  }

  private handleConnection(socket: tls.TLSSocket): void {
    const remoteIp = socket.remoteAddress?.replace(/^::ffff:/, '') || '127.0.0.1';
    let buffer = Buffer.alloc(0);

    // Extract profile key from TLS SNI (e.g. "k7d9w2.dns.example.com" -> "k7d9w2")
    const serverName = socket.servername || '';
    let candidateKey = '';
    if (serverName) {
      const firstPart = serverName.split('.')[0];
      if (ACCESS_KEY_REGEX.test(firstPart)) {
        candidateKey = firstPart;
      }
    }

    socket.on('error', (err: Error) => {
      // Common client disconnection / reset
      if ((err as any).code !== 'ECONNRESET') {
        console.warn(`[DoT] Socket error from ${remoteIp}:`, err.message);
      }
    });

    socket.on('data', async (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);

      while (buffer.length >= 2) {
        const msgLen = buffer.readUInt16BE(0);
        if (buffer.length < 2 + msgLen) {
          // Incomplete message frame, wait for more data
          break;
        }

        const msgPayload = buffer.subarray(2, 2 + msgLen);
        buffer = buffer.subarray(2 + msgLen);

        await this.processQuery(socket, msgPayload, remoteIp, candidateKey);
      }
    });
  }

  private async processQuery(
    socket: tls.TLSSocket,
    rawMsg: Uint8Array,
    remoteIp: string,
    sniKey: string
  ): Promise<void> {
    try {
      const query = parseDNSQueryFromRaw(rawMsg);
      if (!query) return;

      const env = this.options.env;
      const ctx: ExecutionContext = {
        waitUntil(promise: Promise<any>) {
          promise.catch((err) => console.error('[DoT Background Task Error]:', err));
        },
        passThroughOnException() {}
      } as any;

      // Profile selection:
      // 1. Matched SNI Profile Key (Android Private DNS standard)
      // 2. Default Profile Key from config
      // 3. Fallback default profile from database
      let profile = null;
      if (sniKey) {
        profile = await resolveProfileByKey(sniKey, env, ctx);
      }
      if (!profile && this.options.defaultProfileKey) {
        profile = await resolveProfileByKey(this.options.defaultProfileKey, env, ctx);
      }
      if (!profile) {
        profile = await resolveDefaultProfile(env, ctx);
      }
      if (!profile) return;

      const context: Context = {
        profileId: profile.id,
        accessPointId: profile.access_point_id,
        accessPointName: profile.access_point_name,
        startTime: Date.now(),
        env,
        ctx
      };

      const request = new Request(`http://${remoteIp}/dns-query`, {
        headers: {
          'CF-Connecting-IP': remoteIp,
          'Accept': 'application/dns-message',
          'Content-Type': 'application/dns-message'
        }
      });

      const result = await pipeline.process(request, query, context);
      if (!result || !result.answer || result.answer.length === 0) return;

      if (!socket.destroyed && socket.writable) {
        const answer = result.answer;
        const responseBuf = Buffer.allocUnsafe(2 + answer.length);
        responseBuf.writeUInt16BE(answer.length, 0);
        responseBuf.set(answer, 2);
        socket.write(responseBuf);
      }
    } catch (err) {
      console.error('[DoT] Query processing exception:', err);
    }
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server && this.isRunning) {
        this.server.close(() => {
          this.isRunning = false;
          console.log('[DoT] Service stopped.');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}
