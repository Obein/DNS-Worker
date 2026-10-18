/**
 * @file index.ts
 * @description Master entry point for DNS Worker Serverfull mode.
 * Boots and coordinates UDP DNS, DoT (DNS over TLS), HTTP/HTTPS Web Dashboard & DoH, and cron jobs.
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
import { checkNodeVersion, parseCli } from './cli';

export * from './cli';

async function bootstrap(): Promise<void> {
  checkNodeVersion();
  const cliArgs = await parseCli();

  console.log(formatBanner({
    title: `Initializing DNS Worker v${getPackageVersion()} (Serverfull)`,
    borderChar: '-'
  }));

  // 1. Initialize in-memory Web Cache and HTMLRewriter polyfills
  initNodeGlobals();

  // 2. Load environment variables & configurations
  const { config, env } = getServerfullConfig(cliArgs);

  // 3. Inspect TLS certificate and determine HTTPS / DoT availability
  const certInfo = inspectTlsCertificate(config.tlsCertPath, config.tlsKeyPath);
  const canStartHttps = certInfo.configured && certInfo.filesExist && !config.disableHttps;
  const canStartDot = !config.disableDot && certInfo.configured && certInfo.filesExist && certInfo.isWildcard;

  // Print Certbot diagnostic guidance if certificate is not configured or not wildcard
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

  // 4. Initialize Database adapter based on DATABASE_SERVICE (File | Turso | D1)
  let localSqliteDb: { rawDb: { close(): void } } | null = null;

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
    console.log(`[Database] Using Turso Database: ${maskDatabaseUrl(config.tursoDatabaseUrl)}`);
    const tursoDb = createTursoClient(config.tursoDatabaseUrl, config.tursoAuthToken);
    const migrationsDir = path.join(config.packageRoot, 'migrations');
    await runTursoMigrations(tursoDb, migrationsDir);
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
    // Default: 'File' (Local SQLite)
    const db = initServerfullDb(config.dbPath);
    localSqliteDb = db;
    env.DB = db;
  }

  // 5. Initialize servers
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

  // 6. Start all server transports
  if (udpServer) await udpServer.start();
  if (dotServer) await dotServer.start();
  await httpServer.start();
  if (httpsServer) await httpsServer.start();

  // 7. Start scheduled cron jobs (every 60 seconds)
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

  const hasTls = !!(certInfo.configured && certInfo.filesExist);
  console.log(formatBanner({
    title: 'DNS Worker (Serverfull Mode) Started Successfully',
    borderChar: '=',
    bullet: '• ',
    items: [
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

  // 8. Handle graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\n[Serverfull] Received ${signal}. Shutting down gracefully...`);
    clearInterval(cronTimer);

    await Promise.all([
      udpServer?.stop(),
      dotServer?.stop(),
      httpServer.stop(),
      httpsServer?.stop()
    ]);

    try {
      await flushLogBatch(env);
    } catch {
      /* ignore */
    }

    if (localSqliteDb) {
      try {
        localSqliteDb.rawDb.close();
        console.log('[Serverfull] Database connection closed.');
      } catch {
        /* ignore */
      }
    }

    console.log('[Serverfull] All services stopped. Goodbye.');
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

bootstrap().catch((err: unknown) => {
  const errCode = (err as { code?: string })?.code;
  // If already displayed as a formatted port diagnostic error by udp/dot/http, avoid duplicate error box
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
