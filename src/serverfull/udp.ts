/**
 * @file udp.ts
 * @description Classic UDP DNS server (RFC 1035 / RFC 6891) for Serverfull mode.
 */

import dgram from 'node:dgram';
import { Buffer } from 'node:buffer';
import { Env, Context, ExecutionContext } from '../types';
import { parseDNSQueryFromRaw } from '../utils/dns';
import { pipeline } from '../pipeline';
import { resolveDefaultProfile, resolveProfileByKey } from '../api/doh';

export interface UdpServerOptions {
  port: number;
  host: string;
  defaultProfileKey?: string;
  env: Env;
}

export class UdpDnsServer {
  private socket: dgram.Socket | null = null;
  private isRunning: boolean = false;

  constructor(private options: UdpServerOptions) {}

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.socket = dgram.createSocket('udp4');

        this.socket.on('error', (err: Error) => {
          console.error('[UDP DNS] Socket error:', err);
        });

        this.socket.on('message', async (msg: Buffer, rinfo: dgram.RemoteInfo) => {
          await this.handleMessage(msg, rinfo);
        });

        this.socket.bind(this.options.port, this.options.host, () => {
          this.isRunning = true;
          console.log(`[UDP DNS] Classic DNS listening on udp://${this.options.host}:${this.options.port}`);
          resolve();
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  private async handleMessage(msg: Buffer, rinfo: dgram.RemoteInfo): Promise<void> {
    try {
      const rawBytes = new Uint8Array(msg.buffer, msg.byteOffset, msg.byteLength);
      const query = parseDNSQueryFromRaw(rawBytes);
      if (!query) {
        return; // Drop invalid / malformed packets
      }

      const env = this.options.env;
      const ctx: ExecutionContext = {
        waitUntil(promise: Promise<any>) {
          promise.catch((err) => console.error('[UDP Background Task Error]:', err));
        },
        passThroughOnException() {}
      } as any;

      // Determine profile:
      // 1. Configured default profile key
      // 2. Database default / first profile fallback
      let profile = null;
      if (this.options.defaultProfileKey) {
        profile = await resolveProfileByKey(this.options.defaultProfileKey, env, ctx);
      }
      if (!profile) {
        profile = await resolveDefaultProfile(env, ctx);
      }
      if (!profile) {
        return;
      }

      const context: Context = {
        profileId: profile.id,
        accessPointId: profile.access_point_id,
        accessPointName: profile.access_point_name,
        startTime: Date.now(),
        env,
        ctx
      };

      const request = new Request(`http://${rinfo.address}/dns-query`, {
        headers: {
          'CF-Connecting-IP': rinfo.address,
          'Accept': 'application/dns-message',
          'Content-Type': 'application/dns-message'
        }
      });

      const result = await pipeline.process(request, query, context);
      if (!result || !result.answer || result.answer.length === 0) {
        return;
      }

      let answer = result.answer;

      // RFC 1035 UDP 512 bytes limit check (if no EDNS or response > 512, truncate)
      if (answer.length > 512) {
        const truncated = new Uint8Array(answer);
        // Set TC (Truncation) bit: flags byte 1 (offset 2) bit 1 (0x02)
        truncated[2] |= 0x02;
        answer = truncated.slice(0, 512);
      }

      this.socket?.send(answer, rinfo.port, rinfo.address, (err: Error | null) => {
        if (err) {
          console.warn(`[UDP DNS] Failed to send answer to ${rinfo.address}:${rinfo.port}:`, err.message);
        }
      });
    } catch (err) {
      console.error('[UDP DNS] Message handling exception:', err);
    }
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.socket && this.isRunning) {
        this.socket.close(() => {
          this.isRunning = false;
          console.log('[UDP DNS] Service stopped.');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}
