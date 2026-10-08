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
import { resolveUpstreamEndpoint, fetchFromUpstream } from '../pipeline/resolver/transport';
import { ACCESS_KEY_REGEX } from '../utils/validator';
import { formatDiagnostic, formatPortError } from './format';

export interface DotServerOptions {
  port: number;
  host: string;
  tlsKeyPath: string;
  tlsCertPath: string;
  defaultProfileKey?: string;
  dotDomain?: string;
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
        console.warn(formatDiagnostic({
          level: 'warning',
          title: 'DoT - TLS Not Configured',
          message: 'TLS key or certificate path not provided. Skipping DoT server startup.',
          solutions: [
            'Set SERVERFULL_TLS_KEY_PATH and SERVERFULL_TLS_CERT_PATH to enable DNS over TLS (DoT).'
          ]
        }));
        resolve();
        return;
      }

      if (!fs.existsSync(tlsKeyPath) || !fs.existsSync(tlsCertPath)) {
        console.warn(formatDiagnostic({
          level: 'warning',
          title: 'DoT - TLS Files Missing',
          message: 'Configured TLS key or certificate files were not found on disk. Skipping DoT server startup.',
          details: [
            `Key path  : ${tlsKeyPath}`,
            `Cert path : ${tlsCertPath}`
          ],
          solutions: [
            'Verify the file paths or generate TLS certificates before enabling DoT.'
          ]
        }));
        resolve();
        return;
      }

      try {
        const tlsOptions: tls.TlsOptions = {
          key: fs.readFileSync(tlsKeyPath),
          cert: fs.readFileSync(tlsCertPath),
          ALPNProtocols: ['dot'],
          sessionIdContext: 'dns-worker-dot'
        };

        this.server = tls.createServer(tlsOptions, (socket: tls.TLSSocket) => {
          this.handleConnection(socket);
        });

        const startupErrorHandler = (err: any) => {
          this.server = null;

          console.error(formatPortError({
            serviceName: 'DNS over TLS (DoT)',
            protocol: 'DoT',
            port,
            err,
            alternateOption: '--dot-port <port> (e.g. --dot-port 8853)',
            disableOption: '--disable-dot'
          }));

          reject(err);
        };

        this.server.once('error', startupErrorHandler);

        this.server.listen(port, host, () => {
          this.server?.removeListener('error', startupErrorHandler);
          this.server?.on('error', (err: Error) => {
            console.error('[DoT] Runtime error:', err);
          });
          this.isRunning = true;
          const domainInfo = this.options.dotDomain ? ` (${this.options.dotDomain})` : '';
          console.log(`[DoT] DNS over TLS listening on tls://${host}:${port}${domainInfo}`);
          resolve();
        });
      } catch (err) {
        console.error('[DoT] Failed to initialize TLS server:', err);
        reject(err);
      }
    });
  }

  private handleConnection(socket: tls.TLSSocket): void {
    // Disable Nagle's algorithm (RFC 7858) and enable TCP keepalive
    socket.setNoDelay(true);
    socket.setKeepAlive(true, 60000);

    const remoteIp = socket.remoteAddress?.replace(/^::ffff:/, '') || '127.0.0.1';
    let buffer = Buffer.alloc(0);

    // Extract profile key from TLS SNI (e.g. "k7d9w2.dns.example.com" -> "k7d9w2")
    const serverName = (socket.servername || '').toLowerCase().trim();
    let candidateKey = '';

    const baseDomain = this.options.dotDomain?.toLowerCase().trim().replace(/^\*\./, '');
    if (baseDomain && serverName) {
      if (serverName === baseDomain) {
        // Direct connection to base domain (single-domain cert or base domain client)
        candidateKey = '';
      } else if (serverName.endsWith('.' + baseDomain)) {
        // Subdomain of base domain: e.g. "k7d9w2.dns.example.com" or "k7d9w2.sub.dns.example.com"
        const prefix = serverName.slice(0, -(baseDomain.length + 1));
        const firstPart = prefix.split('.')[0];
        if (ACCESS_KEY_REGEX.test(firstPart)) {
          candidateKey = firstPart;
        } else if (ACCESS_KEY_REGEX.test(prefix)) {
          candidateKey = prefix;
        }
      }
    }

    if (!candidateKey && serverName) {
      const firstPart = serverName.split('.')[0];
      if (ACCESS_KEY_REGEX.test(firstPart)) {
        candidateKey = firstPart;
      }
    }

    socket.setTimeout(30000, () => {
      socket.destroy();
    });

    socket.on('error', (err: Error) => {
      // Common client disconnection / reset
      if ((err as any).code !== 'ECONNRESET') {
        console.warn(`[DoT] Socket error from ${remoteIp}:`, err.message);
      }
    });

    const MAX_DOT_BUFFER = 65537; // 2-byte length prefix + 65535 max DNS packet (RFC 7858)
    socket.on('data', async (chunk: Buffer) => {
      if (buffer.length + chunk.length > MAX_DOT_BUFFER) {
        socket.destroy();
        return;
      }
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

      const host = remoteIp.includes(':') ? `[${remoteIp}]` : remoteIp;
      const request = new Request(`http://${host}/dns-query`, {
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
      try {
        const failOpenUpstream = this.options.env.FAIL_OPEN_UPSTREAM || 'https://freedns.controld.com/no-ads-malware-typo';
        const endpoint = resolveUpstreamEndpoint(failOpenUpstream);
        const transportRes = await fetchFromUpstream(endpoint, rawMsg);
        if (!socket.destroyed && socket.writable) {
          const answer = transportRes.answer;
          const responseBuf = Buffer.allocUnsafe(2 + answer.length);
          responseBuf.writeUInt16BE(answer.length, 0);
          responseBuf.set(answer, 2);
          socket.write(responseBuf);
        }
      } catch (fallbackErr) {
        console.error('[DoT] Fail-open upstream fallback failed:', fallbackErr);
      }
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
