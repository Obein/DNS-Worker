/**
 * @file index.ts
 * @description Master entry point for DNS Worker Serverfull mode.
 * Starts Classic UDP DNS, DoT (DNS over TLS), HTTP Web Dashboard & DoH, and scheduled cron jobs.
 */

import path from 'node:path';
import { parseArgs } from 'node:util';
import { initNodeGlobals } from './cache';
import {
  getPackageVersion,
  getServerfullConfig,
  getDefaultDbPath,
  getDefaultDataDir,
  getDefaultConfigDir,
  getDefaultConfigFilePath,
  ensurePersistentDirs,
  loadEnvFiles,
  getLoadedEnvFiles,
  ServerfullCliArgs
} from './config';
import { DEFAULT_ENV_SERVERFULL_TEMPLATE, writeDefaultConfigFile } from './defaults';
import { initServerfullDb } from './db';
import { UdpDnsServer } from './udp';
import { DotDnsServer } from './dot';
import { HttpServer, HttpsServer } from './http';
import { inspectTlsCertificate, getCertbotDiagnosticOptions } from './cert';
import { flushLogBatch } from '../pipeline/logBatcher';
import worker from '../index';
import { ExecutionContext } from '../types';
import { isUsableJwtSecret, isStrongJwtSecret } from '../lib/jwt';
import {
  formatBanner,
  formatDiagnostic,
  formatHelpMenu,
  formatKeyValueSection,
  formatTip
} from './format';
import { showServerfullStatus } from './status';
import { handleServiceAction } from './service';
import { buildCloudflareEchConfig } from '../utils/ech';

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

function handleConfigCommand(subAction: string, targetArg?: string): void {
  if (subAction === 'path') {
    console.log(getDefaultConfigFilePath());
    return;
  }

  if (subAction === 'template') {
    process.stdout.write(DEFAULT_ENV_SERVERFULL_TEMPLATE);
    return;
  }

  if (subAction === 'init') {
    const isForce = process.argv.includes('--force') || targetArg === '--force';
    const effectivePath = (targetArg && targetArg !== '--force') ? path.resolve(targetArg) : getDefaultConfigFilePath();
    const result = writeDefaultConfigFile(effectivePath, isForce);
    if (result.created) {
      console.log(formatDiagnostic({
        level: 'success',
        title: isForce ? 'Configuration File Overwritten' : 'Configuration File Initialized',
        message: `Successfully wrote default .env configuration template to: ${result.path}`,
        solutions: [
          'Edit this file to customize ports, TLS paths, and DNS settings.',
          "Run 'dns-worker status' to verify loaded configuration."
        ]
      }));
    } else {
      console.log(formatDiagnostic({
        level: 'warning',
        title: 'Configuration File Already Exists (Untouched)',
        message: `An existing configuration file was detected and preserved at: ${result.path}`,
        solutions: [
          'Your existing settings and secrets remain completely intact.',
          'Edit the existing file directly to modify options.',
          "To view the new version's full template, run: dns-worker config template",
          "To force overwrite with the latest default template, run: dns-worker config init --force"
        ]
      }));
    }
    return;
  }

  // Default: 'show'
  loadEnvFiles();
  const loaded = getLoadedEnvFiles();
  const loadedText = loaded.length > 0 ? loaded.join('\n    ') : 'None (Using built-in presets & defaults)';

  const banner = formatBanner({
    title: 'DNS Worker Configuration Summary',
    borderChar: '=',
    bullet: '• '
  });

  const section = formatKeyValueSection({
    title: '\nActive Configuration Paths:',
    items: [
      { label: 'Persistent Data Dir', value: getDefaultDataDir() },
      { label: 'Config Directory', value: getDefaultConfigDir() },
      { label: 'Default Config Path', value: getDefaultConfigFilePath() },
      { label: 'Default SQLite Path', value: getDefaultDbPath() },
      { label: 'Loaded Config Files', value: loadedText }
    ]
  });

  const tip = formatTip([
    "To generate a clean .env template file: dns-worker config init",
    "To print the configuration file path: dns-worker config path",
    "To view the raw template: dns-worker config template"
  ]);

  console.log([banner, section, tip].join('\n'));
}

function handleEchCommand(cliArgs?: ServerfullCliArgs): void {
  const { config } = getServerfullConfig(cliArgs);
  const frontingDomain = config.echFrontingDomain || 'cloudflare-ech.com';
  const echConfigBase64 = config.echConfig || buildCloudflareEchConfig(frontingDomain);
  const domain = config.dotDomain || 'dns.example.com';

  const banner = formatBanner({
    title: 'Encrypted Client Hello (ECH) & DNS Service Records',
    borderChar: '=',
    bullet: '• '
  });

  const section = formatKeyValueSection({
    title: '\nActive ECH Configuration & Outer SNI:',
    items: [
      { label: 'ECH Status', value: config.echEnabled ? 'Enabled (Active)' : 'Disabled' },
      { label: 'Fronting Domain (Outer SNI)', value: frontingDomain },
      { label: 'ECHConfigList (Base64)', value: echConfigBase64 },
      { label: 'Target Base Domain', value: domain },
      { label: 'HTTPS (H3) Port', value: String(config.httpsPort) },
      { label: 'DoT / DoQ Port', value: String(config.dotPort) }
    ]
  });

  const ddrRecord = `_dns.${domain}. 300 IN SVCB 1 . alpn="doq,dot" port=${config.dotPort} ech="${echConfigBase64}"`;
  const httpsRecord = `${domain}. 300 IN HTTPS 1 . alpn="h3,h2" port=${config.httpsPort} ech="${echConfigBase64}"`;

  const dnsSection = `\nStandard DNS Service Binding Records (RFC 9460 & RFC 9460 Section 8 DDR):
  • DDR SVCB Record (DoQ/DoT auto-discovery):
    ${ddrRecord}

  • HTTPS Service Record (HTTP/3 & ECH):
    ${httpsRecord}`;

  const tip = formatTip([
    'Publish the DDR SVCB record in your authoritative DNS zone to enable automatic DoQ & DoT discovery.',
    'Publish the HTTPS record to enable browser HTTP/3 (h3) and ECH negotiation without SNI leakage.',
    `Test client ECH support with: curl --ech true https://${domain}`
  ]);

  console.log([banner, section, dnsSection, tip].join('\n'));
}

function printHelp(): void {
  const version = getPackageVersion();

  const menu = formatHelpMenu({
    name: `DNS Worker v${version} (Serverfull Mode)`,
    description: 'Privacy-first DNS & DoH Resolver',
    usage: [
      'dns-worker [options]',
      'dns-worker status [options]',
      'dns-worker ech [options]',
      'dns-worker config [action]',
      'dns-worker service <action>',
      'npx dns-worker [options]'
    ],
    commands: [
      { label: 'status', desc: 'Inspect service runtime status and database health' },
      { label: 'ech', desc: 'Display active ECH configuration, outer SNI, and DNS RR records' },
      { label: 'config [action]', desc: 'Manage configuration (show, path, init, template)' },
      { label: 'service <action>', desc: 'Manage background service (install, start, stop, restart, status, logs, uninstall)' }
    ],
    options: [
      { label: '-s, --status', desc: 'Display service and database runtime status' },
      { label: '-p, --port, --http-port <number>', desc: 'Plain HTTP Web Dashboard & DoH port (default: 10080)' },
      { label: '--https-port <number>', desc: 'Secure HTTPS Web Dashboard & DoH port (default: 10443)' },
      { label: '--disable-https', desc: 'Disable HTTPS Web Dashboard server' },
      { label: '--dns-port <number>', desc: 'Classic UDP DNS port (default: 53)' },
      { label: '--dot-port <number>', desc: 'DoT (DNS over TLS) port (default: 853)' },
      { label: '--dot-domain <domain>', desc: 'Base domain name for DoT & HTTPS service (e.g. dns.example.com)' },
      { label: '--ech-enabled <boolean>', desc: 'Enable or disable ECH broadcast (true/false, default: true)' },
      { label: '--ech-config <base64>', desc: 'Custom Base64-encoded ECHConfigList' },
      { label: '--ech-fronting-domain <domain>', desc: 'ECH outer SNI fronting domain (default: cloudflare-ech.com)' },
      { label: '-h, --host <address>', desc: 'Network address to bind (default: 0.0.0.0)' },
      { label: '--db <path>', desc: `SQLite database file path (default: ${getDefaultDbPath()})` },
      { label: '--default-profile <key>', desc: 'Default Profile Key or Access Point Token for standard queries' },
      { label: '--disable-udp', desc: 'Disable Classic UDP DNS server' },
      { label: '--disable-dot', desc: 'Disable DoT server' },
      { label: '-v, --version', desc: 'Display version number' },
      { label: '--help', desc: 'Display this help message' }
    ],
    envVars: [
      { label: 'PORT / HTTP_PORT / SERVERFULL_HTTP_PORT', desc: 'Plain HTTP Web Dashboard & DoH port' },
      { label: 'HTTPS_PORT / SERVERFULL_HTTPS_PORT', desc: 'Secure HTTPS Web Dashboard & DoH port' },
      { label: 'SERVERFULL_DISABLE_HTTPS', desc: 'Disable HTTPS Web Dashboard server' },
      { label: 'DNS_PORT / SERVERFULL_UDP_PORT', desc: 'Classic UDP DNS port' },
      { label: 'DOT_PORT / SERVERFULL_DOT_PORT', desc: 'DoT port' },
      { label: 'SERVERFULL_DOT_DOMAIN / DOT_DOMAIN', desc: 'Base domain name for DoT & HTTPS service' },
      { label: 'SERVERFULL_ECH_ENABLED', desc: 'Enable or disable ECH (true/false)' },
      { label: 'SERVERFULL_ECH_CONFIG', desc: 'Custom Base64-encoded ECHConfigList' },
      { label: 'SERVERFULL_ECH_FRONTING_DOMAIN', desc: 'Fronting domain for ECH outer SNI' },
      { label: 'DB_PATH / SERVERFULL_DB_PATH', desc: 'SQLite database file path' },
      { label: 'JWT_SECRET', desc: 'JWT secret key (recommended >= 32 characters)' },
      { label: 'SERVERFULL_TLS_KEY_PATH', desc: 'Path to TLS private key for HTTPS & DoT' },
      { label: 'SERVERFULL_TLS_CERT_PATH', desc: 'Path to TLS certificate for HTTPS & DoT' }
    ],
    tip: [
      "Run 'dns-worker status' to inspect active runtime status, port availability, and database health.",
      "Run 'dns-worker ech' to view active ECH configuration, outer SNI, and RFC 9460 DNS records.",
      "Run 'dns-worker config init' to create an editable .env configuration file.",
      process.platform === 'win32'
        ? "Run 'dns-worker service install' (in Administrator terminal) to run as a persistent Windows background service."
        : "Run 'sudo dns-worker service install' to run as a persistent background Linux systemd service."
    ]
  });

  console.log(menu);
}

async function parseCli(): Promise<ServerfullCliArgs> {
  try {
    const { values, positionals } = parseArgs({
      options: {
        port: { type: 'string', short: 'p' },
        'http-port': { type: 'string' },
        'https-port': { type: 'string' },
        'disable-https': { type: 'boolean' },
        'dns-port': { type: 'string' },
        'dot-port': { type: 'string' },
        'dot-domain': { type: 'string' },
        host: { type: 'string', short: 'h' },
        db: { type: 'string' },
        'default-profile': { type: 'string' },
        'disable-udp': { type: 'boolean' },
        'disable-dot': { type: 'boolean' },
        'ech-enabled': { type: 'boolean' },
        'ech-config': { type: 'string' },
        'ech-fronting-domain': { type: 'string' },
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

    if (positionals[0]?.toLowerCase() === 'ech') {
      handleEchCommand(values as ServerfullCliArgs);
      process.exit(0);
    }

    if (positionals[0]?.toLowerCase() === 'config') {
      const subAction = positionals[1]?.toLowerCase() || 'show';
      const targetArg = positionals[2];
      handleConfigCommand(subAction, targetArg);
      process.exit(0);
    }

    if (positionals[0]?.toLowerCase() === 'service') {
      const action = positionals[1]?.toLowerCase() || 'status';
      await handleServiceAction(action);
      process.exit(0);
    }

    if (positionals[0]?.toLowerCase() === 'postinstall') {
      try {
        const { dataDir, configDir, configFile } = ensurePersistentDirs(true);
        console.log(`[dns-worker] Initialized data directory: ${dataDir}`);
        console.log(`[dns-worker] Initialized configuration file: ${configFile}`);
      } catch {}
      process.exit(0);
    }

    const serviceInstallHint = process.platform === 'win32'
      ? "Run 'dns-worker service install' in Administrator terminal to install Windows service."
      : "Run 'sudo dns-worker service install' to install as a Linux systemd service.";

    if (positionals.length > 0) {
      console.error(formatDiagnostic({
        level: 'error',
        title: 'DNS Worker - CLI Argument Error',
        message: `Unrecognized command or argument "${positionals.join(' ')}".`,
        solutions: [
          "Run 'dns-worker status' to view runtime status.",
          serviceInstallHint,
          "Run 'dns-worker --help' to inspect supported options and usage."
        ]
      }));
      printHelp();
      process.exit(1);
    }

    return values as ServerfullCliArgs;
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const serviceInstallHint = process.platform === 'win32'
      ? "Run 'dns-worker service install' in Administrator terminal to install Windows service."
      : "Run 'sudo dns-worker service install' to install as a Linux systemd service.";

    console.error(formatDiagnostic({
      level: 'error',
      title: 'DNS Worker - CLI Argument Error',
      message: errorMsg,
      solutions: [
        "Run 'dns-worker status' to view runtime status.",
        serviceInstallHint,
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

  // 3. Inspect TLS certificate and determine HTTPS / DoT availability
  const certInfo = inspectTlsCertificate(config.tlsCertPath, config.tlsKeyPath);
  const canStartHttps = certInfo.configured && certInfo.filesExist && !config.disableHttps;

  // Print Certbot diagnostic guidance if certificate is not configured or not wildcard
  if (!certInfo.configured || !certInfo.filesExist) {
    console.log(formatDiagnostic(getCertbotDiagnosticOptions('missing', config.dotDomain)));
  } else if (!certInfo.isWildcard) {
    console.log(formatDiagnostic(getCertbotDiagnosticOptions('non_wildcard', config.dotDomain)));
  }

  const httpsDisplay = config.disableHttps
    ? 'Disabled (--disable-https)'
    : canStartHttps
      ? `https://${config.host}:${config.httpsPort}`
      : 'Disabled (TLS Certificates Not Configured)';

  console.log(formatKeyValueSection({
    title: '[Services] Configured Ports & Transports:',
    items: [
      { label: 'Web Dashboard & DoH (HTTP)', value: `http://${config.host}:${config.httpPort}` },
      { label: 'Web Dashboard & DoH (HTTPS)', value: httpsDisplay },
      { label: 'Classic UDP DNS', value: config.disableUdp ? 'Disabled' : `udp://${config.host}:${config.udpPort}` },
      { label: 'DNS over TLS (DoT)', value: config.disableDot ? 'Disabled' : (certInfo.configured && certInfo.filesExist ? `tls://${config.host}:${config.dotPort}` : 'Disabled (TLS Certificates Not Configured)') }
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

  // 4. Initialize SQLite D1 adapter and execute schema migrations
  const db = initServerfullDb(config.dbPath);
  env.DB = db;

  // 5. Initialize servers
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
    dotDomain: config.dotDomain,
    defaultProfileKey: config.defaultProfileKey,
    env
  }) : null;

  const httpServer = new HttpServer({
    port: config.httpPort,
    host: config.host,
    env
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
        value: (dotServer && hasTls) ? `tls://${config.dotDomain || config.host}:${config.dotPort}` : 'Disabled / Not Configured'
      },
      {
        label: 'Web UI & DoH (HTTP)',
        value: `http://${config.host}:${config.httpPort}`
      },
      {
        label: 'Web UI & DoH (HTTPS)',
        value: httpsServer ? `https://${config.dotDomain || config.host}:${config.httpsPort}` : 'Disabled / Not Configured'
      },
      {
        label: 'SQLite Database',
        value: config.dbPath
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
