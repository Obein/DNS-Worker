/**
 * @file index.ts
 * @description Master entry point for DNS Worker Serverfull mode.
 * Boots and coordinates UDP DNS, DoT (DNS over TLS), HTTP/HTTPS Web Dashboard & DoH,
 * cluster multi-worker concurrency, and scheduled database maintenance jobs.
 */

import path from 'node:path';
import { initNodeGlobals } from './cache';
import { getPackageVersion, getServerfullConfig } from './config';
import { initServerfullDb } from './db';
import { createTursoClient, maskDatabaseUrl } from '../lib/turso';
import { runTursoMigrations } from '../lib/turso/migrate';
import { UdpDnsServer } from './udp';
import { DotDnsServer } from './dot';
import { HttpServer, HttpsServer } from './http';
import { inspectTlsCertificate, getCertbotDiagnosticOptions } from './cert';
import { flushLogBatch } from '../pipeline/logBatcher';
import worker from '../index';
import { ExecutionContext } from '../types';
import { isUsableJwtSecret, isStrongJwtSecret } from '../lib/jwt';
import { formatBanner, formatDiagnostic, formatKeyValueSection } from './format';
import { checkNodeVersion, parseCli, getActiveRuntimeDescription } from './cli';
import { tuneV8Engine } from './v8';
import { getClusterInfo, forkClusterWorkers, shutdownClusterWorkers } from './cluster';

export * from './cli';

async function bootstrap(): Promise<void> {
  // 1. Optimize V8 engine (Fast API calls) and validate active engine requirements
  tuneV8Engine();
  checkNodeVersion();
  const cliArgs = await parseCli();

  // 2. Initialize in-memory Web Cache and HTMLRewriter polyfills
  initNodeGlobals();

  // 3. Load environment variables & configurations
  const { config, env } = getServerfullConfig(cliArgs);
  const clusterInfo = getClusterInfo(config.workers);

  // 4. Primary Process setup and diagnostics
  if (clusterInfo.isPrimary) {
    console.log(formatBanner({
      title: `Initializing DNS Worker v${getPackageVersion()} (Serverfull)`,
      borderChar: '-'
    }));

    // Inspect TLS certificate and determine HTTPS / DoT availability
    const certInfo = inspectTlsCertificate(config.tlsCertPath, config.tlsKeyPath);
    const canStartHttps = certInfo.configured && certInfo.filesExist && !config.disableHttps;

    if (!certInfo.configured) {
      console.log(formatDiagnostic(getCertbotDiagnosticOptions('missing', config.dotDomain)));
    } else if (!certInfo.filesExist) {
      console.log(formatDiagnostic({
        level: 'warning',
        title: 'TLS Certificate Files Inaccessible',
        message: certInfo.error || 'Configured TLS certificate or private key files could not be read on disk.',
        details: [
          `Cert path configured: ${config.tlsCertPath ? 'yes' : 'no'}`,
          `Key path configured : ${config.tlsKeyPath ? 'yes' : 'no'}`,
          'Running user details are omitted for security.'
        ],
        solutions: [
          'Check that the paths configured in .env exist and are accessible.',
          'If using Let\'s Encrypt (/etc/letsencrypt/), grant read permissions to the service user (e.g. chmod 755 /etc/letsencrypt/{live,archive} and chmod 644 on keys).'
        ]
      }));
    } else if (!certInfo.isWildcard) {
      console.log(formatDiagnostic(getCertbotDiagnosticOptions('non_wildcard', config.dotDomain)));
    }

    const httpsDisplay = config.disableHttps
      ? 'Disabled (--disable-https)'
      : canStartHttps
        ? `https://${config.host}:${config.httpsPort}`
        : !certInfo.configured
          ? 'Disabled (TLS Certificates Not Configured)'
          : `Disabled (Files Inaccessible: ${certInfo.error || 'Check Permissions'})`;

    const dotDisplay = config.disableDot
      ? 'Disabled (--disable-dot)'
      : !certInfo.configured
        ? 'Disabled (TLS Certificates Not Configured)'
        : !certInfo.filesExist
          ? `Disabled (Files Inaccessible: ${certInfo.error || 'Check Permissions'})`
          : !certInfo.isWildcard
            ? 'Paused (Requires Wildcard Certificate *.domain)'
            : `tls://${config.host}:${config.dotPort}`;

    console.log(formatKeyValueSection({
      title: '[Services] Configured Ports & Transports:',
      items: [
        {
          label: 'Web Dashboard & DoH (HTTP)',
          value: canStartHttps
            ? `http://${config.host}:${config.httpPort} (Redirects to HTTPS)`
            : `http://${config.host}:${config.httpPort}`
        },
        { label: 'Web Dashboard & DoH (HTTPS)', value: httpsDisplay },
        { label: 'Classic UDP DNS', value: config.disableUdp ? 'Disabled' : `udp://${config.host}:${config.udpPort}` },
        { label: 'DNS over TLS (DoT)', value: dotDisplay }
      ]
    }));

    // Non-blocking security check for legacy short JWT_SECRET
    if (isUsableJwtSecret(env.JWT_SECRET) && !isStrongJwtSecret(env.JWT_SECRET)) {
      console.warn(formatDiagnostic({
        level: 'warning',
        title: 'SECURITY WARNING',
        message: 'JWT_SECRET is shorter than 32 characters.',
        solutions: [
          'Please configure KEK_v1 in your environment before rotating JWT_SECRET to prevent existing encrypted credentials from becoming unrecoverable.'
        ]
      }));
    }
  }

  // 5. Initialize Database adapter (Run schema migrations on primary process only)
  let localSqliteDb: { rawDb: { close(): void }; checkpoint?(mode?: string): void; optimize?(): void } | null = null;

  if (config.databaseService === 'Turso') {
    if (!config.tursoDatabaseUrl || !config.tursoAuthToken) {
      console.error(formatDiagnostic({
        level: 'error',
        title: 'Database Configuration Error',
        message: "DATABASE_SERVICE is set to 'Turso', but TURSO_DATABASE_URL or TURSO_AUTH_TOKEN is missing.",
        solutions: [
          'Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN in .env or via CLI arguments (--turso-url, --turso-token).',
          "Alternatively, set DATABASE_SERVICE='File' to use local SQLite."
        ]
      }));
      process.exit(1);
    }
    const tursoDb = createTursoClient(config.tursoDatabaseUrl, config.tursoAuthToken);
    if (clusterInfo.isPrimary) {
      console.log(`[Database] Using Turso Database: ${maskDatabaseUrl(config.tursoDatabaseUrl)}`);
      const migrationsDir = path.join(config.packageRoot, 'migrations');
      await runTursoMigrations(tursoDb, migrationsDir);
    }
    env.DB = tursoDb;
  } else if (config.databaseService === 'D1') {
    console.error(formatDiagnostic({
      level: 'error',
      title: 'Database Configuration Error',
      message: "DATABASE_SERVICE='D1' is designed for Cloudflare Workers environments with D1 bindings.",
      solutions: [
        "In Serverfull mode, please set DATABASE_SERVICE='File' (default local SQLite) or DATABASE_SERVICE='Turso'."
      ]
    }));
    process.exit(1);
  } else {
    // Default: 'File' (Local SQLite with WAL mode)
    const skipMigrations = !clusterInfo.isPrimary;
    const db = initServerfullDb(config.dbPath, config.packageRoot, skipMigrations);
    localSqliteDb = db;
    env.DB = db;
  }

  // 6. Cluster Primary Process: Fork workers and coordinate background cron
  if (clusterInfo.isPrimary && clusterInfo.workersCount > 1) {
    const certInfo = inspectTlsCertificate(config.tlsCertPath, config.tlsKeyPath);
    const hasTls = !!(certInfo.configured && certInfo.filesExist);

    console.log(formatBanner({
      title: 'DNS Worker (Serverfull Master) Started Successfully',
      borderChar: '=',
      bullet: '• ',
      items: [
        { label: 'Runtime Engine', value: getActiveRuntimeDescription() },
        { label: 'Multi-Core Concurrency', value: `${clusterInfo.workersCount} Workers (Cluster Mode)` },
        { label: 'In-Memory DNS Cache', value: `${config.dnsCacheSize.toLocaleString()} entries` },
        {
          label: 'Classic UDP DNS',
          value: !config.disableUdp ? `udp://${config.host}:${config.udpPort}` : 'Disabled'
        },
        {
          label: 'DoT (TLS DNS)',
          value: (!config.disableDot && hasTls) ? `tls://${config.dotDomain || config.host}:${config.dotPort}` : 'Disabled'
        },
        {
          label: 'Web UI & DoH (HTTP)',
          value: `http://${config.host}:${config.httpPort}`
        },
        {
          label: 'Web UI & DoH (HTTPS)',
          value: (hasTls && !config.disableHttps) ? `https://${config.dotDomain || config.host}:${config.httpsPort}` : 'Disabled'
        },
        {
          label: 'Database Engine',
          value: config.databaseService === 'Turso' ? `Turso (${maskDatabaseUrl(config.tursoDatabaseUrl)})` : `SQLite (${config.dbPath})`
        }
      ]
    }));

    // Start background cron on Primary process (every 60s)
    let cronCounter = 0;
    const cronTimer = setInterval(async () => {
      try {
        cronCounter++;
        // Periodic non-blocking WAL checkpoint every 10 minutes
        if (localSqliteDb?.checkpoint && cronCounter % 10 === 0) {
          localSqliteDb.checkpoint('PASSIVE');
        }
        // Periodic PRAGMA optimize every 6 hours
        if (localSqliteDb?.optimize && cronCounter % 360 === 0) {
          localSqliteDb.optimize();
        }

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

    // Fork worker processes
    forkClusterWorkers(clusterInfo.workersCount);

    const shutdownPrimary = async (signal: string) => {
      console.log(`\n[Serverfull Master] Received ${signal}. Shutting down cluster...`);
      clearInterval(cronTimer);
      await shutdownClusterWorkers();

      try {
        await flushLogBatch(env);
      } catch {}

      if (localSqliteDb) {
        try {
          localSqliteDb.checkpoint?.('TRUNCATE');
          localSqliteDb.rawDb.close();
          console.log('[Serverfull Master] Database connection closed.');
        } catch {}
      }

      console.log('[Serverfull Master] Cluster shutdown complete. Goodbye.');
      process.exit(0);
    };

    process.on('SIGINT', () => shutdownPrimary('SIGINT'));
    process.on('SIGTERM', () => shutdownPrimary('SIGTERM'));
    return;
  }

  // 7. Worker Process (or Single Process Mode): Initialize and start network servers
  const certInfo = inspectTlsCertificate(config.tlsCertPath, config.tlsKeyPath);
  const canStartHttps = certInfo.configured && certInfo.filesExist && !config.disableHttps;
  const canStartDot = !config.disableDot && certInfo.configured && certInfo.filesExist && certInfo.isWildcard;

  const udpServer = !config.disableUdp ? new UdpDnsServer({
    port: config.udpPort,
    host: config.host,
    defaultProfileKey: config.defaultProfileKey,
    env
  }) : null;

  const dotServer = canStartDot ? new DotDnsServer({
    port: config.dotPort,
    host: config.host,
    tlsKeyPath: config.tlsKeyPath,
    tlsCertPath: config.tlsCertPath,
    dotDomain: config.dotDomain,
    defaultProfileKey: config.defaultProfileKey,
    env
  }) : null;

  const httpServer = new HttpServer({
    port: config.httpPort,
    host: config.host,
    env,
    httpsRedirect: canStartHttps ? {
      enabled: true,
      httpsPort: config.httpsPort
    } : undefined
  });

  const httpsServer = canStartHttps ? new HttpsServer({
    port: config.httpsPort,
    host: config.host,
    certPath: config.tlsCertPath,
    keyPath: config.tlsKeyPath,
    env
  }) : null;

  // Start all server transports
  if (udpServer) await udpServer.start();
  if (dotServer) await dotServer.start();
  await httpServer.start();
  if (httpsServer) await httpsServer.start();

  // If running in single-process mode (workers === 1), start background cron
  let cronTimer: NodeJS.Timeout | null = null;
  if (clusterInfo.workersCount === 1) {
    let cronCounter = 0;
    cronTimer = setInterval(async () => {
      try {
        cronCounter++;
        // Periodic non-blocking WAL checkpoint every 10 minutes
        if (localSqliteDb?.checkpoint && cronCounter % 10 === 0) {
          localSqliteDb.checkpoint('PASSIVE');
        }
        // Periodic PRAGMA optimize every 6 hours
        if (localSqliteDb?.optimize && cronCounter % 360 === 0) {
          localSqliteDb.optimize();
        }

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

    const hasTls = !!(certInfo.configured && certInfo.filesExist);
    console.log(formatBanner({
      title: 'DNS Worker (Serverfull Mode) Started Successfully',
      borderChar: '=',
      bullet: '• ',
      items: [
        { label: 'Runtime Engine', value: getActiveRuntimeDescription() },
        { label: 'Concurrency', value: 'Single Process' },
        { label: 'In-Memory DNS Cache', value: `${config.dnsCacheSize.toLocaleString()} entries` },
        {
          label: 'Classic UDP DNS',
          value: udpServer ? `udp://${config.host}:${config.udpPort}` : 'Disabled (--disable-udp)'
        },
        {
          label: 'DoT (TLS DNS)',
          value: (dotServer && hasTls)
            ? `tls://${config.dotDomain || config.host}:${config.dotPort}`
            : (!certInfo.configured)
              ? 'Disabled / Not Configured'
              : (!certInfo.filesExist)
                ? `Disabled (Files Inaccessible: ${certInfo.error || 'Check Permissions'})`
                : (!certInfo.isWildcard)
                  ? 'Paused (Requires Wildcard Certificate *.domain)'
                  : 'Disabled'
        },
        {
          label: 'Web UI & DoH (HTTP)',
          value: `http://${config.host}:${config.httpPort}`
        },
        {
          label: 'Web UI & DoH (HTTPS)',
          value: httpsServer
            ? `https://${config.dotDomain || config.host}:${config.httpsPort}`
            : (!certInfo.configured)
              ? 'Disabled / Not Configured'
              : (!certInfo.filesExist)
                ? `Disabled (Files Inaccessible: ${certInfo.error || 'Check Permissions'})`
                : 'Disabled'
        },
        {
          label: 'Database Engine',
          value: config.databaseService === 'Turso' ? `Turso (${maskDatabaseUrl(config.tursoDatabaseUrl)})` : `SQLite (${config.dbPath})`
        }
      ]
    }));
  } else {
    const workerTag = `Worker #${clusterInfo.workerId || 1}`;
    console.log(`[${workerTag}] All server transports bound and listening.`);
  }

  // 8. Graceful shutdown handler
  const shutdown = async (signal: string) => {
    const prefix = clusterInfo.workersCount > 1 ? `[Worker #${clusterInfo.workerId || 1}]` : '[Serverfull]';
    console.log(`\n${prefix} Received ${signal}. Shutting down gracefully...`);
    if (cronTimer) clearInterval(cronTimer);

    await Promise.all([
      udpServer?.stop(),
      dotServer?.stop(),
      httpServer.stop(),
      httpsServer?.stop()
    ]);

    try {
      await flushLogBatch(env);
    } catch {}

    if (localSqliteDb) {
      try {
        if (clusterInfo.workersCount === 1) {
          localSqliteDb.checkpoint?.('TRUNCATE');
        }
        localSqliteDb.rawDb.close();
        console.log(`${prefix} Database connection closed.`);
      } catch {}
    }

    console.log(`${prefix} Services stopped. Goodbye.`);
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

bootstrap().catch((err: unknown) => {
  const errCode = (err as { code?: string })?.code;
  if (errCode !== 'EACCES' && errCode !== 'EADDRINUSE') {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(formatDiagnostic({
      level: 'error',
      title: 'Serverfull - Fatal Startup Error',
      message: errorMsg
    }));
  }
  process.exit(1);
});
