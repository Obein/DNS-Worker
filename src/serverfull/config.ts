/**
 * @file config.ts
 * @description Configuration loader and environment variable manager for Serverfull mode.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Env } from '../types';
import {
  DEFAULT_PRESET_UPSTREAMS,
  DEFAULT_PRESET_EXTERNAL_FILTERS,
  DEFAULT_IP_REGION_CN,
  DEFAULT_SUBSTITUTE_DOMAIN,
  DEFAULT_FAIL_OPEN_UPSTREAM
} from '../constants/presets';

export interface ServerfullCliArgs {
  port?: string;
  'dns-port'?: string;
  'dot-port'?: string;
  host?: string;
  db?: string;
  'default-profile'?: string;
  'disable-udp'?: boolean;
  'disable-dot'?: boolean;
  status?: boolean;
  version?: boolean;
  help?: boolean;
}

export interface ServerfullConfig {
  tlsKeyPath: string;
  tlsCertPath: string;
  udpPort: number;
  dotPort: number;
  httpPort: number;
  host: string;
  dbPath: string;
  defaultProfileKey: string;
  disableUdp: boolean;
  disableDot: boolean;
  packageRoot: string;
}

/**
 * Resolves the root directory of the installed package (where static/ and migrations/ live).
 */
export function getPackageRoot(): string {
  try {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    // 1. If running bundled (e.g. dist/serverfull.mjs -> root has migrations and static)
    if (fs.existsSync(path.join(currentDir, 'migrations')) && fs.existsSync(path.join(currentDir, 'static'))) {
      return currentDir;
    }
    // 2. One level up from dist/
    const parent = path.resolve(currentDir, '..');
    if (fs.existsSync(path.join(parent, 'migrations')) && fs.existsSync(path.join(parent, 'static'))) {
      return parent;
    }
    // 3. Two levels up (from src/serverfull/)
    const grandParent = path.resolve(currentDir, '../..');
    if (fs.existsSync(path.join(grandParent, 'migrations')) && fs.existsSync(path.join(grandParent, 'static'))) {
      return grandParent;
    }
  } catch {}
  return process.cwd();
}

/**
 * Resolves package version from package.json if available.
 */
export function getPackageVersion(): string {
  try {
    const pkgPath = path.join(getPackageRoot(), 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      if (pkg.version) return pkg.version;
    }
  } catch {}
  return '1.0.0';
}

/**
 * Resolves the fixed platform-specific default persistent data directory.
 * - Linux: /var/lib/dns-worker (with automatic fallback to ~/.local/share/dns-worker for unprivileged non-root users if /var/lib is not writable)
 * - Windows: %ProgramData%\DNS-Worker (e.g. C:\ProgramData\DNS-Worker)
 * - macOS: ~/Library/Application Support/DNS-Worker
 */
export function getDefaultDataDir(): string {
  if (process.platform === 'win32') {
    const programData = process.env.ProgramData || path.join(process.env.SystemDrive || 'C:', 'ProgramData');
    return path.join(programData, 'DNS-Worker');
  }

  if (process.platform === 'linux') {
    const systemVarLib = '/var/lib/dns-worker';
    // If running as root, or if /var/lib/dns-worker already exists and is writable
    if (typeof process.getuid === 'function' && process.getuid() === 0) {
      return systemVarLib;
    }
    if (fs.existsSync(systemVarLib)) {
      try {
        fs.accessSync(systemVarLib, fs.constants.W_OK);
        return systemVarLib;
      } catch {
        /* Not writable by current user, fall through */
      }
    }
    // For unprivileged user when system /var/lib/dns-worker is not provisioned,
    // use standard XDG user data directory: ~/.local/share/dns-worker
    const homeDir = process.env.HOME || '/tmp';
    const xdgDataHome = process.env.XDG_DATA_HOME || path.join(homeDir, '.local', 'share');
    return path.join(xdgDataHome, 'dns-worker');
  }

  if (process.platform === 'darwin') {
    const homeDir = process.env.HOME || '/tmp';
    return path.join(homeDir, 'Library', 'Application Support', 'DNS-Worker');
  }

  return path.join(process.cwd(), 'data');
}

/**
 * Resolves the fixed platform-specific default SQLite database file path.
 *
 * @returns Persistent SQLite database file path.
 */
export function getDefaultDbPath(): string {
  return path.join(getDefaultDataDir(), 'dns_worker.sqlite');
}

/**
 * Parsed and loaded environment files tracker.
 */
const loadedEnvFiles: string[] = [];

/**
 * Returns list of environment files successfully loaded into process.env.
 */
export function getLoadedEnvFiles(): readonly string[] {
  return loadedEnvFiles;
}

/**
 * Resolves the platform-specific default configuration file path.
 */
export function getDefaultConfigFilePath(): string {
  return path.join(getDefaultDataDir(), '.env');
}

/**
 * Parses simple KEY=VALUE dotenv files.
 * Returns true if file was successfully read.
 */
function loadDotEnv(filePath: string): boolean {
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx !== -1) {
          const key = trimmed.slice(0, eqIdx).trim();
          let val = trimmed.slice(eqIdx + 1).trim();
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }
          if (!(key in process.env)) {
            process.env[key] = val;
          }
        }
      }
      return true;
    }
  } catch (err) {
    console.warn(`[Config] Failed to read ${filePath}:`, err);
  }
  return false;
}

/**
 * Loads configuration files from multiple hierarchical search paths:
 * 1. Current working directory: .dev.vars, .env, .env.serverfull
 * 2. Persistent system data directory: <DataDir>/.env (e.g. /var/lib/dns-worker/.env or %ProgramData%\\DNS-Worker\\.env)
 * 3. Linux system config directory: /etc/dns-worker/.env or /etc/default/dns-worker
 * 4. Package distribution root: <packageRoot>/.env.serverfull
 */
export function loadEnvFiles(rootDir: string = process.cwd()): string[] {
  loadedEnvFiles.length = 0;

  const candidatePaths = [
    // 1. Current working directory
    path.join(rootDir, '.dev.vars'),
    path.join(rootDir, '.env'),
    path.join(rootDir, '.env.serverfull'),

    // 2. Persistent system data directory
    getDefaultConfigFilePath(),

    // 3. Linux standard system paths
    process.platform === 'linux' ? '/etc/dns-worker/.env' : null,
    process.platform === 'linux' ? '/etc/default/dns-worker' : null,

    // 4. Package distribution root
    path.join(getPackageRoot(), '.env.serverfull')
  ].filter((p): p is string => Boolean(p));

  const uniquePaths = Array.from(new Set(candidatePaths));
  for (const filePath of uniquePaths) {
    if (loadDotEnv(filePath)) {
      loadedEnvFiles.push(filePath);
    }
  }

  return loadedEnvFiles;
}

/**
 * Resolves or initializes a stable, persistent JWT secret.
 * Precedence:
 * 1. process.env.JWT_SECRET (if explicitly configured)
 * 2. <DataDir>/.jwt_secret (if previously generated and persisted)
 * 3. Generates 256-bit cryptographically secure hex string and persists it to <DataDir>/.jwt_secret
 */
export function getOrInitPersistentJwtSecret(dataDir: string = getDefaultDataDir()): string {
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.trim().length > 0) {
    return process.env.JWT_SECRET.trim();
  }

  const secretFile = path.join(dataDir, '.jwt_secret');
  try {
    if (fs.existsSync(secretFile)) {
      const existing = fs.readFileSync(secretFile, 'utf-8').trim();
      if (existing.length >= 16) {
        return existing;
      }
    }
  } catch {}

  // Generate 256-bit secure random secret (64 hex characters)
  const newSecret = Buffer.from(crypto.randomBytes(32)).toString('hex');
  try {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    fs.writeFileSync(secretFile, newSecret, { encoding: 'utf-8', mode: 0o600 });
  } catch {}
  return newSecret;
}

/**
 * Loads Serverfull-specific options and builds the standard Env interface.
 */
export function getServerfullConfig(cliArgs?: ServerfullCliArgs): { config: ServerfullConfig; env: Env } {
  loadEnvFiles();

  const packageRoot = getPackageRoot();

  // Support both SERVERFULL_TLS_KEY_PATH and SERFULL_TLS_KEY_PATH
  const tlsKeyPath = process.env.SERVERFULL_TLS_KEY_PATH || process.env.SERFULL_TLS_KEY_PATH || '';
  // Support SERVERFULL_TLS_CERT_PATH and public key aliases
  const tlsCertPath = process.env.SERVERFULL_TLS_CERT_PATH || 
                      process.env.SERVERFULL_TLS_PUB_PATH || 
                      process.env.SERVERFULL_TLS_PUBLIC_KEY_PATH ||
                      process.env.SERFULL_TLS_CERT_PATH ||
                      process.env.SERFULL_TLS_PUB_PATH || '';

  const udpPort = parseInt(cliArgs?.['dns-port'] || process.env.SERVERFULL_UDP_PORT || process.env.DNS_PORT || '53', 10);
  const dotPort = parseInt(cliArgs?.['dot-port'] || process.env.SERVERFULL_DOT_PORT || process.env.DOT_PORT || '853', 10);
  const httpPort = parseInt(cliArgs?.port || process.env.SERVERFULL_HTTP_PORT || process.env.PORT || '3000', 10);
  const host = cliArgs?.host || process.env.SERVERFULL_HOST || process.env.SERVERFULL_BIND_ADDRESS || '0.0.0.0';
  const defaultDbPath = getDefaultDbPath();
  const dbPath = cliArgs?.db || process.env.SERVERFULL_DB_PATH || process.env.DB_PATH || defaultDbPath;
  const defaultProfileKey = cliArgs?.['default-profile'] || process.env.SERVERFULL_DEFAULT_PROFILE_KEY || process.env.DEFAULT_PROFILE_KEY || '';
  const disableUdp = Boolean(cliArgs?.['disable-udp'] || process.env.SERVERFULL_DISABLE_UDP === 'true');
  const disableDot = Boolean(cliArgs?.['disable-dot'] || process.env.SERVERFULL_DISABLE_DOT === 'true');

  const config: ServerfullConfig = {
    tlsKeyPath,
    tlsCertPath,
    udpPort,
    dotPort,
    httpPort,
    host,
    dbPath,
    defaultProfileKey,
    disableUdp,
    disableDot,
    packageRoot
  };

  const env: Env = {
    DB: null as any, // Set by db.ts
    ASSETS: null as any, // Set by http.ts
    JWT_SECRET: getOrInitPersistentJwtSecret(),
    FAIL_OPEN_UPSTREAM: process.env.FAIL_OPEN_UPSTREAM || DEFAULT_FAIL_OPEN_UPSTREAM,
    SUBSTITUTE_DOMAIN: process.env.SUBSTITUTE_DOMAIN || DEFAULT_SUBSTITUTE_DOMAIN,
    PRESET_UPSTREAMS: process.env.PRESET_UPSTREAMS || JSON.stringify(DEFAULT_PRESET_UPSTREAMS),
    PRESET_EXTERNAL_FILTERS: process.env.PRESET_EXTERNAL_FILTERS || JSON.stringify(DEFAULT_PRESET_EXTERNAL_FILTERS),
    IP_REGION_CN: process.env.IP_REGION_CN || JSON.stringify(DEFAULT_IP_REGION_CN),
    MAX_ACCESS_POINTS_PER_PROFILE: process.env.MAX_ACCESS_POINTS_PER_PROFILE || 100,
    MAX_PROFILES_PER_USER: process.env.MAX_PROFILES_PER_USER || 10,
    DEFAULT_SESSION_EXPIRATION_MINUTES: process.env.DEFAULT_SESSION_EXPIRATION_MINUTES || 1440,
    OPTIONAL_SESSION_EXPIRATION_DAYS: process.env.OPTIONAL_SESSION_EXPIRATION_DAYS || 7,
    ACCESS_TOKEN_EXPIRATION_MINUTES: process.env.ACCESS_TOKEN_EXPIRATION_MINUTES || 1,
    SESSION_GEO_DISTANCE_KM: process.env.SESSION_GEO_DISTANCE_KM || 50,
    PREAUTH_TTL_SECONDS: process.env.PREAUTH_TTL_SECONDS || 300,
    BLOOM_MEM_TTL: process.env.BLOOM_MEM_TTL || 600000,
    SYNC_TIMEOUT_MS: process.env.SYNC_TIMEOUT_MS || 30000,
    INACTIVITY_THRESHOLD_DAYS: process.env.INACTIVITY_THRESHOLD_DAYS || 180,
    THROTTLE_ACTIVE_SEC: process.env.THROTTLE_ACTIVE_SEC || 3600,
    SYNC_PROFILE_INTERVAL_SEC: process.env.SYNC_PROFILE_INTERVAL_SEC || 86400,
    BLOOM_FALSE_POSITIVE_RATE: process.env.BLOOM_FALSE_POSITIVE_RATE || 0.0001,
    MAX_SYNC_DOMAINS: process.env.MAX_SYNC_DOMAINS || 1000000,
    MAX_LIST_DOMAINS: process.env.MAX_LIST_DOMAINS || 500000,
    MAX_LOG_RETENTION_DAYS: process.env.MAX_LOG_RETENTION_DAYS || 30,
    DEFAULT_LOG_RETENTION_DAYS: process.env.DEFAULT_LOG_RETENTION_DAYS || 7,
    NORMAL_USER_MAX_LOG_RETENTION_DAYS: process.env.NORMAL_USER_MAX_LOG_RETENTION_DAYS || 7,
    NORMAL_USER_DEFAULT_LOG_RETENTION_DAYS: process.env.NORMAL_USER_DEFAULT_LOG_RETENTION_DAYS || 1,
    MAX_LOGS_PER_PROFILE: process.env.MAX_LOGS_PER_PROFILE || 500000,
    SERVERFULL_DEFAULT_PROFILE_KEY: defaultProfileKey,
    ...process.env
  };

  return { config, env };
}
