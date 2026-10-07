/**
 * @file index.ts
 * @description Master entry point for DNS Worker Serverfull mode.
 * Starts Classic UDP DNS, DoT (DNS over TLS), HTTP Web Dashboard & DoH, and scheduled cron jobs.
 */

import { parseArgs } from 'node:util';
import { initNodeGlobals } from './cache';
import { getPackageVersion, getServerfullConfig, ServerfullCliArgs } from './config';
import { initServerfullDb } from './db';
import { UdpDnsServer } from './udp';
import { DotDnsServer } from './dot';
import { HttpServer } from './http';
import { flushLogBatch } from '../pipeline/logBatcher';
import worker from '../index';
import { ExecutionContext } from '../types';
import { isUsableJwtSecret, isStrongJwtSecret } from '../lib/jwt';
import {
  formatBanner,
  formatDiagnostic,
  formatHelpMenu,
  formatKeyValueSection
} from './format';
import { showServerfullStatus } from './status';
import { handleServiceAction } from './service';

function checkNodeVersion(): void {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 5)) {
    console.error(formatDiagnostic({
      level: 'error',
      title: 'DNS Worker - Environment Error',
      message: `Node.js >= 22.5.0 is required (found v${process.versions.node}).`,
      solutions: [
        'Please upgrade Node.js to version 22.5.0 or higher to use built-in SQLite (node:sqlite).'
      ]
    }));
    process.exit(1);
  }
}

function printHelp(): void {
  const version = getPackageVersion();

  const menu = formatHelpMenu({
    name: `DNS Worker v${version} (Serverfull Mode)`,
    description: 'Privacy-first DNS & DoH Resolver',
    usage: [
      'dns-worker [options]',
      'dns-worker status [options]',
      'dns-worker service <action>',
      'npx dns-worker [options]'
    ],
    commands: [
      { label: 'status', desc: 'Inspect service runtime status and database health' },
      { label: 'service <action>', desc: 'Manage Linux systemd service (install, start, stop, restart, status, logs, uninstall)' }
    ],
    options: [
      { label: '-s, --status', desc: 'Display service and database runtime status' },
      { label: '-p, --port <number>', desc: 'Web Dashboard & DoH HTTP port (default: 3000)' },
      { label: '--dns-port <number>', desc: 'Classic UDP DNS port (default: 53)' },
      { label: '--dot-port <number>', desc: 'DoT (DNS over TLS) port (default: 853)' },
      { label: '-h, --host <address>', desc: 'Network address to bind (default: 0.0.0.0)' },
      { label: '--db <path>', desc: 'SQLite database file path (default: ./data/dns_worker.sqlite)' },
      { label: '--default-profile <key>', desc: 'Default Profile Key or Access Point Token for standard queries' },
      { label: '--disable-udp', desc: 'Disable Classic UDP DNS server' },
      { label: '--disable-dot', desc: 'Disable DoT server' },
      { label: '-v, --version', desc: 'Display version number' },
      { label: '--help', desc: 'Display this help message' }
    ],
    envVars: [
      { label: 'PORT / SERVERFULL_HTTP_PORT', desc: 'Web Dashboard & DoH port' },
      { label: 'DNS_PORT / SERVERFULL_UDP_PORT', desc: 'Classic UDP DNS port' },
      { label: 'DOT_PORT / SERVERFULL_DOT_PORT', desc: 'DoT port' },
      { label: 'DB_PATH / SERVERFULL_DB_PATH', desc: 'SQLite database file path' },
      { label: 'JWT_SECRET', desc: 'JWT secret key (recommended >= 32 characters)' },
      { label: 'SERVERFULL_TLS_KEY_PATH', desc: 'Path to TLS private key for DoT' },
      { label: 'SERVERFULL_TLS_CERT_PATH', desc: 'Path to TLS certificate for DoT' }
    ],
    tip: [
      "Run 'dns-worker status' to inspect active runtime status, port availability, and database health.",
      "Run 'sudo dns-worker service install' to run as a persistent background Linux systemd service."
    ]
  });

  console.log(menu);
}

async function parseCli(): Promise<ServerfullCliArgs> {
  try {
    const { values, positionals } = parseArgs({
      options: {
        port: { type: 'string', short: 'p' },
        'dns-port': { type: 'string' },
        'dot-port': { type: 'string' },
        host: { type: 'string', short: 'h' },
        db: { type: 'string' },
        'default-profile': { type: 'string' },
        'disable-udp': { type: 'boolean' },
        'disable-dot': { type: 'boolean' },
        status: { type: 'boolean', short: 's' },
        help: { type: 'boolean' },
        version: { type: 'boolean', short: 'v' }
      },
      allowPositionals: true
    });

    if (values.help || positionals[0]?.toLowerCase() === 'help') {
      printHelp();
      process.exit(0);
    }

    if (values.version) {
      console.log(`dns-worker v${getPackageVersion()}`);
      process.exit(0);
    }

    if (values.status || positionals[0]?.toLowerCase() === 'status') {
      const { config, env } = getServerfullConfig(values as ServerfullCliArgs);
      await showServerfullStatus(config, env.JWT_SECRET);
      process.exit(0);
    }

    if (positionals[0]?.toLowerCase() === 'service') {
      const action = positionals[1]?.toLowerCase() || 'status';
      await handleServiceAction(action);
      process.exit(0);
    }

    if (positionals.length > 0) {
      console.error(formatDiagnostic({
        level: 'error',
        title: 'DNS Worker - CLI Argument Error',
        message: `Unrecognized command or argument "${positionals.join(' ')}".`,
        solutions: [
          "Run 'dns-worker status' to view runtime status.",
          "Run 'sudo dns-worker service install' to install as a Linux systemd service.",
          "Run 'dns-worker --help' to inspect supported options and usage."
        ]
      }));
      printHelp();
      process.exit(1);
    }

    return values as ServerfullCliArgs;
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(formatDiagnostic({
      level: 'error',
      title: 'DNS Worker - CLI Argument Error',
      message: errorMsg,
      solutions: [
        "Run 'dns-worker status' to view runtime status.",
        "Run 'sudo dns-worker service install' to install as a Linux systemd service.",
        "Run 'dns-worker --help' to inspect supported options and usage."
      ]
    }));
    printHelp();
    process.exit(1);
  }
}

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

  console.log(formatKeyValueSection({
    title: '[Services] Configured Ports & Transports:',
    items: [
      { label: 'Web Dashboard & DoH', value: `http://${config.host}:${config.httpPort}` },
      { label: 'Classic UDP DNS', value: config.disableUdp ? 'Disabled' : `udp://${config.host}:${config.udpPort}` },
      { label: 'DNS over TLS (DoT)', value: config.disableDot ? 'Disabled' : `tls://${config.host}:${config.dotPort}` }
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

  // 3. Initialize SQLite D1 adapter and execute schema migrations
  const db = initServerfullDb(config.dbPath);
  env.DB = db;

  // 4. Initialize servers
  const udpServer = !config.disableUdp ? new UdpDnsServer({
    port: config.udpPort,
    host: config.host,
    defaultProfileKey: config.defaultProfileKey,
    env
  }) : null;

  const dotServer = !config.disableDot ? new DotDnsServer({
    port: config.dotPort,
    host: config.host,
    tlsKeyPath: config.tlsKeyPath,
    tlsCertPath: config.tlsCertPath,
    defaultProfileKey: config.defaultProfileKey,
    env
  }) : null;

  const httpServer = new HttpServer({
    port: config.httpPort,
    host: config.host,
    env
  });

  // 5. Start all server transports
  if (udpServer) await udpServer.start();
  if (dotServer) await dotServer.start();
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

  const hasTls = !!(dotServer && config.tlsKeyPath && config.tlsCertPath);
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
        value: hasTls ? `tls://${config.host}:${config.dotPort}` : 'Disabled / Not Configured'
      },
      {
        label: 'Web UI & DoH',
        value: `http://${config.host}:${config.httpPort}`
      },
      {
        label: 'SQLite Database',
        value: config.dbPath
      }
    ]
  }));

  // 7. Handle graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\n[Serverfull] Received ${signal}. Shutting down gracefully...`);
    clearInterval(cronTimer);

    await Promise.all([
      udpServer?.stop(),
      dotServer?.stop(),
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
  console.error(formatDiagnostic({
    level: 'error',
    title: 'Serverfull - Fatal Startup Error',
    message: err?.message || String(err)
  }));
  process.exit(1);
});
