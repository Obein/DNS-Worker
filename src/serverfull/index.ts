/**
 * @file index.ts
 * @description Master entry point for DNS Worker Serverfull mode.
 * Starts Classic UDP DNS, DoT (DNS over TLS), HTTP Web Dashboard & DoH, and scheduled cron jobs.
 */

import { initNodeGlobals } from './cache';
import { getServerfullConfig } from './config';
import { initServerfullDb } from './db';
import { UdpDnsServer } from './udp';
import { DotDnsServer } from './dot';
import { HttpServer } from './http';
import { flushLogBatch } from '../pipeline/logBatcher';
import worker from '../index';
import { ExecutionContext } from '../types';

async function bootstrap(): Promise<void> {
  console.log('------------------------------------------------------');
  console.log('       Initializing DNS Worker (Serverfull Mode)      ');
  console.log('------------------------------------------------------');

  // 1. Initialize in-memory Web Cache and HTMLRewriter polyfills
  initNodeGlobals();

  // 2. Load environment variables & configurations
  const { config, env } = getServerfullConfig();

  // 3. Initialize SQLite D1 adapter and execute schema migrations
  const db = initServerfullDb(config.dbPath);
  env.DB = db;

  // 4. Initialize servers
  const udpServer = new UdpDnsServer({
    port: config.udpPort,
    host: config.host,
    defaultProfileKey: config.defaultProfileKey,
    env
  });

  const dotServer = new DotDnsServer({
    port: config.dotPort,
    host: config.host,
    tlsKeyPath: config.tlsKeyPath,
    tlsCertPath: config.tlsCertPath,
    defaultProfileKey: config.defaultProfileKey,
    env
  });

  const httpServer = new HttpServer({
    port: config.httpPort,
    host: config.host,
    env
  });

  // 5. Start all server transports
  await udpServer.start();
  await dotServer.start();
  await httpServer.start();

  // 6. Start scheduled cron jobs (every 60 seconds)
  const cronTimer = setInterval(async () => {
    try {
      const scheduledEvent = {
        cron: '* * * * *',
        scheduledTime: Date.now(),
        type: 'scheduled' as const,
        noRetry() {}
      };
      const ctx: ExecutionContext = {
        waitUntil(promise: Promise<any>) {
          promise.catch((err) => console.error('[Cron Task Error]:', err));
        },
        passThroughOnException() {}
      } as any;

      await worker.scheduled(scheduledEvent as any, env, ctx);
    } catch (err) {
      console.error('[Cron Scheduler Error]:', err);
    }
  }, 60000);

  console.log('======================================================');
  console.log('   DNS Worker (Serverfull Mode) Started Successfully  ');
  console.log('======================================================');
  console.log(`  * Classic UDP DNS :  udp://${config.host}:${config.udpPort}`);
  console.log(`  * DoT (TLS DNS)   :  tls://${config.host}:${config.dotPort}`);
  console.log(`  * Web UI & DoH    :  http://${config.host}:${config.httpPort}`);
  console.log(`  * SQLite Database :  ${config.dbPath}`);
  console.log('======================================================');

  // 7. Handle graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\n[Serverfull] Received ${signal}. Shutting down gracefully...`);
    clearInterval(cronTimer);

    await Promise.all([
      udpServer.stop(),
      dotServer.stop(),
      httpServer.stop()
    ]);

    try {
      await flushLogBatch(env);
    } catch {
      /* ignore */
    }

    try {
      db.rawDb.close();
      console.log('[Serverfull] Database connection closed.');
    } catch (e) {
      /* ignore */
    }

    console.log('[Serverfull] All services stopped. Goodbye.');
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

bootstrap().catch((err) => {
  console.error('[Serverfull] Fatal startup error:', err);
  process.exit(1);
});
