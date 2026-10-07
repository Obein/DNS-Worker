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
import { formatHelpMenu } from './help';

function checkNodeVersion(): void {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 5)) {
    console.error('\n[DNS Worker] Error: Node.js >= 22.5.0 is required (found v' + process.versions.node + ').');
    console.error('Please upgrade Node.js to version 22.5.0 or higher to use built-in SQLite (node:sqlite).\n');
    process.exit(1);
  }
}

function printHelp(cliArgs?: ServerfullCliArgs): void {
  const version = getPackageVersion();
  const { config } = getServerfullConfig(cliArgs);

  const udpStatus = config.disableUdp ? 'Disabled' : String(config.udpPort);
  const dotStatus = config.disableDot ? 'Disabled' : String(config.dotPort);
  const httpStatus = String(config.httpPort);

  const menu = formatHelpMenu({
    name: `DNS Worker v${version} (Serverfull Mode)`,
    description: 'Privacy-first DNS & DoH Resolver',
    usage: [
      'dns-worker [options]',
      'npx dns-worker [options]'
    ],
    options: [
      { label: '-p, --port <number>', desc: `Web Dashboard & DoH HTTP port (current: ${httpStatus}, default: 3000)` },
      { label: '--dns-port <number>', desc: `Classic UDP DNS port (current: ${udpStatus}, default: 53)` },
      { label: '--dot-port <number>', desc: `DoT (DNS over TLS) port (current: ${dotStatus}, default: 853)` },
      { label: '-h, --host <address>', desc: `Network address to bind (current: ${config.host}, default: 0.0.0.0)` },
      { label: '--db <path>', desc: `SQLite database file path (current: ${config.dbPath})` },
      { label: '--default-profile <key>', desc: 'Default Profile Key or Access Point Token for standard queries' },
      { label: '--disable-udp', desc: `Disable Classic UDP DNS server (current: ${config.disableUdp})` },
      { label: '--disable-dot', desc: `Disable DoT server (current: ${config.disableDot})` },
      { label: '-v, --version', desc: 'Display version number' },
      { label: '--help', desc: 'Display this help message' }
    ],
    services: [
      { label: '• Web Dashboard & DoH (HTTP)', desc: `http://${config.host}:${httpStatus}` },
      { label: '• Classic UDP DNS', desc: config.disableUdp ? 'Disabled' : `udp://${config.host}:${udpStatus}` },
      { label: '• DNS over TLS (DoT)', desc: config.disableDot ? 'Disabled' : `tls://${config.host}:${dotStatus}` }
    ],
    envVars: [
      { label: 'PORT / SERVERFULL_HTTP_PORT', desc: 'Web Dashboard & DoH port' },
      { label: 'DNS_PORT / SERVERFULL_UDP_PORT', desc: 'Classic UDP DNS port' },
      { label: 'DOT_PORT / SERVERFULL_DOT_PORT', desc: 'DoT port' },
      { label: 'DB_PATH / SERVERFULL_DB_PATH', desc: 'SQLite database file path' },
      { label: 'JWT_SECRET', desc: 'JWT secret key (recommended >= 32 characters)' },
      { label: 'SERVERFULL_TLS_KEY_PATH', desc: 'Path to TLS private key for DoT' },
      { label: 'SERVERFULL_TLS_CERT_PATH', desc: 'Path to TLS certificate for DoT' }
    ]
  });

  console.log(menu);
}

function parseCli(): ServerfullCliArgs {
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
        help: { type: 'boolean' },
        version: { type: 'boolean', short: 'v' }
      },
      allowPositionals: true
    });

    if (values.help || positionals[0]?.toLowerCase() === 'help') {
      printHelp(values as ServerfullCliArgs);
      process.exit(0);
    }

    if (values.version) {
      console.log(`dns-worker v${getPackageVersion()}`);
      process.exit(0);
    }

    if (positionals.length > 0) {
      console.error(`\n[DNS Worker] CLI Argument Error: Unrecognized command or argument "${positionals.join(' ')}".`);
      printHelp(values as ServerfullCliArgs);
      process.exit(1);
    }

    return values as ServerfullCliArgs;
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`\n[DNS Worker] CLI Argument Error: ${errorMsg}`);
    printHelp();
    process.exit(1);
  }
}

async function bootstrap(): Promise<void> {
  checkNodeVersion();
  const cliArgs = parseCli();

  console.log('------------------------------------------------------');
  console.log(`       Initializing DNS Worker v${getPackageVersion()} (Serverfull)   `);
  console.log('------------------------------------------------------');

  // 1. Initialize in-memory Web Cache and HTMLRewriter polyfills
  initNodeGlobals();

  // 2. Load environment variables & configurations
  const { config, env } = getServerfullConfig(cliArgs);

  console.log('[Services] Configured Ports & Transports:');
  console.log(`  • Web Dashboard & DoH: http://${config.host}:${config.httpPort}`);
  console.log(`  • Classic UDP DNS:     ${config.disableUdp ? 'Disabled' : `udp://${config.host}:${config.udpPort}`}`);
  console.log(`  • DNS over TLS (DoT):  ${config.disableDot ? 'Disabled' : `tls://${config.host}:${config.dotPort}`}`);

  // Non-blocking security check for legacy short JWT_SECRET
  if (isUsableJwtSecret(env.JWT_SECRET) && !isStrongJwtSecret(env.JWT_SECRET)) {
    console.warn('\n[SECURITY WARNING] JWT_SECRET is shorter than 32 characters.');
    console.warn('  Please configure KEK_v1 in your environment before rotating JWT_SECRET');
    console.warn('  to prevent existing encrypted credentials from becoming unrecoverable.\n');
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

  console.log('======================================================');
  console.log('   DNS Worker (Serverfull Mode) Started Successfully  ');
  console.log('======================================================');
  if (udpServer) {
    console.log(`  * Classic UDP DNS :  udp://${config.host}:${config.udpPort}`);
  } else {
    console.log(`  * Classic UDP DNS :  Disabled (--disable-udp)`);
  }
  if (dotServer && config.tlsKeyPath && config.tlsCertPath) {
    console.log(`  * DoT (TLS DNS)   :  tls://${config.host}:${config.dotPort}`);
  } else {
    console.log(`  * DoT (TLS DNS)   :  Disabled / Not Configured`);
  }
  console.log(`  * Web UI & DoH    :  http://${config.host}:${config.httpPort}`);
  console.log(`  * SQLite Database :  ${config.dbPath}`);
  console.log('======================================================');

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
  console.error('[Serverfull] Fatal startup error:', err.message || err);
  process.exit(1);
});
