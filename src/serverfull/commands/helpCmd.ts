/**
 * @file helpCmd.ts
 * @description Formats and prints the Serverfull CLI help menu.
 */

import { getPackageVersion, getDefaultDbPath } from '../config';
import { formatHelpMenu } from '../format';

/**
 * Prints the formatted CLI help menu with commands, flags, and environment variables.
 */
export function printHelp(): void {
  const version = getPackageVersion();

  const menu = formatHelpMenu({
    name: `DNS Worker v${version} (Serverfull Mode)`,
    description: 'Privacy-first DNS & DoH Resolver',
    usage: [
      'dns-worker [options]',
      'dns-worker status [options]',
      'dns-worker ech [options]',
      'dns-worker config [action]',
      'dns-worker reset [options]',
      'dns-worker service <action>',
      'npx dns-worker [options]'
    ],
    commands: [
      { label: 'status', desc: 'Inspect service runtime status and database health' },
      { label: 'ech', desc: 'Display active ECH configuration, outer SNI, and DNS RR records' },
      { label: 'config [action]', desc: 'Manage configuration (show, path, init, template)' },
      { label: 'reset', desc: 'Restore default .env configuration and wipe database (requires confirmation)' },
      { label: 'service <action>', desc: 'Manage background service (install, start, stop, restart, enable, disable, status, logs, uninstall)' }
    ],
    options: [
      { label: '-s, --status', desc: 'Display service and database runtime status' },
      { label: '-f, --force, -y, --yes', desc: 'Bypass interactive confirmation prompt for reset command' },
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
      { label: '--database-service <D1|Turso|File>', desc: 'Database engine (default: File in Serverfull, D1 in Serverless)' },
      { label: '--db <path>', desc: `SQLite database file path (default: ${getDefaultDbPath()})` },
      { label: '--turso-url <url>', desc: 'Turso / libSQL database URL (e.g. libsql://your-db.turso.io)' },
      { label: '--turso-token <token>', desc: 'Turso database authorization token' },
      { label: '--default-profile <key>', desc: 'Default Profile Key or Access Point Token for standard queries' },
      { label: '--disable-udp', desc: 'Disable Classic UDP DNS server' },
      { label: '--disable-dot', desc: 'Disable DoT server' },
      { label: '-u, --user <username>', desc: 'User account to run background service as (default: current invoking user)' },
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
      { label: 'DATABASE_SERVICE', desc: 'Database engine (D1, Turso, File. Default: File)' },
      { label: 'DB_PATH / SERVERFULL_DB_PATH', desc: 'SQLite database file path' },
      { label: 'TURSO_DATABASE_URL / TURSO_URL', desc: 'Turso / libSQL database URL (e.g. libsql://your-db.turso.io)' },
      { label: 'TURSO_AUTH_TOKEN', desc: 'Turso database authorization token' },
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
