/**
 * @file config.ts
 * @description Configuration builder and environment variable assembler for Serverfull mode.
 * Re-exports paths, envLoader, and jwtSecret for backwards-compatible access.
 */

import fs from 'node:fs';
import { Env } from '../types';
import {
  DEFAULT_PRESET_UPSTREAMS,
  DEFAULT_PRESET_EXTERNAL_FILTERS,
  DEFAULT_IP_REGION_CN,
  DEFAULT_SUBSTITUTE_DOMAIN,
  DEFAULT_FAIL_OPEN_UPSTREAM
} from '../constants/presets';
import { getDatabaseService, DatabaseServiceType } from '../lib/turso';
import {
  getPackageRoot,
  getDefaultDbPath,
  ensurePersistentDirs
} from './paths';
import { loadEnvFiles } from './envLoader';
import { getOrInitPersistentJwtSecret } from './jwtSecret';

// Re-export submodules
export * from './paths';
export * from './envLoader';
export * from './jwtSecret';

export interface ServerfullCliArgs {
  port?: string;
  'http-port'?: string;
  'https-port'?: string;
  'disable-https'?: boolean;
  'dns-port'?: string;
  'dot-port'?: string;
  'dot-domain'?: string;
  host?: string;
  db?: string;
  'database-service'?: string;
  'db-service'?: string;
  'default-profile'?: string;
  'disable-udp'?: boolean;
  'disable-dot'?: boolean;
  'ech-enabled'?: boolean;
  'ech-config'?: string;
  'ech-fronting-domain'?: string;
  'turso-url'?: string;
  'turso-token'?: string;
  user?: string;
  status?: boolean;
  version?: boolean;
  help?: boolean;
}

export interface ServerfullConfig {
  tlsKeyPath: string;
  tlsCertPath: string;
  udpPort: number;
  dotPort: number;
  dotDomain: string;
  httpPort: number;
  httpsPort: number;
  host: string;
  dbPath: string;
  databaseService: DatabaseServiceType;
  tursoDatabaseUrl: string;
  tursoAuthToken: string;
  defaultProfileKey: string;
  disableUdp: boolean;
  disableDot: boolean;
  disableHttps: boolean;
  echEnabled: boolean;
  echConfig: string;
  echFrontingDomain: string;
  packageRoot: string;
}

/**
 * Loads Serverfull-specific options and builds the standard Env interface.
 */
export function getServerfullConfig(cliArgs?: ServerfullCliArgs): { config: ServerfullConfig; env: Env } {
  ensurePersistentDirs();
  loadEnvFiles();

  const packageRoot = getPackageRoot();

  // Support SERVERFULL_TLS_KEY_PATH and standard aliases
  const tlsKeyPath = (
    process.env.SERVERFULL_TLS_KEY_PATH ||
    process.env.SERFULL_TLS_KEY_PATH ||
    process.env.TLS_KEY_PATH ||
    process.env.SSL_KEY_PATH ||
    process.env.SERVERFULL_TLS_KEY ||
    process.env.TLS_KEY ||
    process.env.SSL_KEY ||
    process.env.KEY_PATH ||
    process.env.KEY_FILE ||
    ''
  ).trim();

  // Support SERVERFULL_TLS_CERT_PATH and standard aliases
  const tlsCertPath = (
    process.env.SERVERFULL_TLS_CERT_PATH || 
    process.env.SERVERFULL_TLS_PUB_PATH || 
    process.env.SERVERFULL_TLS_PUBLIC_KEY_PATH ||
    process.env.SERFULL_TLS_CERT_PATH ||
    process.env.SERFULL_TLS_PUB_PATH ||
    process.env.TLS_CERT_PATH ||
    process.env.SSL_CERT_PATH ||
    process.env.SERVERFULL_TLS_CERT ||
    process.env.TLS_CERT ||
    process.env.SSL_CERT ||
    process.env.CERT_PATH ||
    process.env.CERT_FILE ||
    ''
  ).trim();

  // Support automatic default TLS discovery if not explicitly specified
  let effectiveKeyPath = tlsKeyPath;
  let effectiveCertPath = tlsCertPath;

  if (!effectiveKeyPath && !effectiveCertPath) {
    const candidatePairs = [
      { cert: '/etc/ssl/dns-worker/fullchain.pem', key: '/etc/ssl/dns-worker/privkey.pem' },
      { cert: '/etc/ssl/dns-worker/cert.pem', key: '/etc/ssl/dns-worker/key.pem' },
      { cert: '/etc/dns-worker/certs/fullchain.pem', key: '/etc/dns-worker/certs/privkey.pem' },
      { cert: '/etc/dns-worker/certs/cert.pem', key: '/etc/dns-worker/certs/key.pem' }
    ];
    for (const pair of candidatePairs) {
      try {
        if (fs.existsSync(pair.cert) && fs.existsSync(pair.key)) {
          effectiveCertPath = pair.cert;
          effectiveKeyPath = pair.key;
          break;
        }
      } catch {}
    }
  }

  const udpPort = parseInt(cliArgs?.['dns-port'] || process.env.SERVERFULL_UDP_PORT || process.env.DNS_PORT || '53', 10);
  const dotPort = parseInt(cliArgs?.['dot-port'] || process.env.SERVERFULL_DOT_PORT || process.env.DOT_PORT || '853', 10);
  const dotDomain = (cliArgs?.['dot-domain'] || process.env.SERVERFULL_DOT_DOMAIN || process.env.DOT_DOMAIN || '').trim();
  const httpPort = parseInt(cliArgs?.['http-port'] || cliArgs?.port || process.env.SERVERFULL_HTTP_PORT || process.env.HTTP_PORT || process.env.PORT || '10080', 10);
  const httpsPort = parseInt(cliArgs?.['https-port'] || process.env.SERVERFULL_HTTPS_PORT || process.env.HTTPS_PORT || '10443', 10);
  const host = cliArgs?.host || process.env.SERVERFULL_HOST || process.env.SERVERFULL_BIND_ADDRESS || '0.0.0.0';
  const defaultDbPath = getDefaultDbPath();
  const dbPath = cliArgs?.db || process.env.SERVERFULL_DB_PATH || process.env.DB_PATH || defaultDbPath;
  const defaultProfileKey = cliArgs?.['default-profile'] || process.env.SERVERFULL_DEFAULT_PROFILE_KEY || process.env.DEFAULT_PROFILE_KEY || '';
  const disableUdp = Boolean(cliArgs?.['disable-udp'] || process.env.SERVERFULL_DISABLE_UDP === 'true');
  const disableDot = Boolean(cliArgs?.['disable-dot'] || process.env.SERVERFULL_DISABLE_DOT === 'true');
  const disableHttps = Boolean(cliArgs?.['disable-https'] || process.env.SERVERFULL_DISABLE_HTTPS === 'true');
  const echEnabled = cliArgs?.['ech-enabled'] !== undefined
    ? Boolean(cliArgs['ech-enabled'])
    : (process.env.SERVERFULL_ECH_ENABLED === undefined || process.env.SERVERFULL_ECH_ENABLED === 'true' || process.env.SERVERFULL_ECH_ENABLED === '1');
  const echConfig = (cliArgs?.['ech-config'] || process.env.SERVERFULL_ECH_CONFIG || '').trim();
  const echFrontingDomain = (cliArgs?.['ech-fronting-domain'] || process.env.SERVERFULL_ECH_FRONTING_DOMAIN || 'cloudflare-ech.com').trim();
  const tursoDatabaseUrl = (cliArgs?.['turso-url'] || process.env.TURSO_DATABASE_URL || process.env.TURSO_URL || '').trim();
  const tursoAuthToken = (cliArgs?.['turso-token'] || process.env.TURSO_AUTH_TOKEN || '').trim();
  const rawService = cliArgs?.['database-service'] || cliArgs?.['db-service'] || process.env.DATABASE_SERVICE || process.env.DB_SERVICE;
  const databaseService = getDatabaseService(
    {
      DATABASE_SERVICE: rawService,
      TURSO_DATABASE_URL: tursoDatabaseUrl,
      TURSO_AUTH_TOKEN: tursoAuthToken
    },
    true
  );

  const config: ServerfullConfig = {
    tlsKeyPath: effectiveKeyPath,
    tlsCertPath: effectiveCertPath,
    udpPort,
    dotPort,
    dotDomain,
    httpPort,
    httpsPort,
    host,
    dbPath,
    databaseService,
    tursoDatabaseUrl,
    tursoAuthToken,
    defaultProfileKey,
    disableUdp,
    disableDot,
    disableHttps,
    echEnabled,
    echConfig,
    echFrontingDomain,
    packageRoot
  };

  const env: Env = {
    DB: null as any, // Set by db.ts or turso client
    DATABASE_SERVICE: databaseService,
    TURSO_DATABASE_URL: tursoDatabaseUrl,
    TURSO_AUTH_TOKEN: tursoAuthToken,
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
    ACCESS_TOKEN_EXPIRATION_MINUTES: Number(process.env.ACCESS_TOKEN_EXPIRATION_MINUTES) || 10,
    SESSION_GEO_DISTANCE_KM: process.env.SESSION_GEO_DISTANCE_KM || 50,
    PREAUTH_TTL_SECONDS: process.env.PREAUTH_TTL_SECONDS || 300,
    BLOOM_MEM_TTL: process.env.BLOOM_MEM_TTL || 600000,
    CONFIG_MEM_TTL: process.env.CONFIG_MEM_TTL || 300000,
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
    SERVERFULL_DB_PATH: dbPath,
    SERVERFULL_DOT_DOMAIN: dotDomain,
    DOT_DOMAIN: dotDomain,
    SERVERFULL_HTTPS_PORT: httpsPort,
    SERVERFULL_DOT_PORT: dotPort,
    SERVERFULL_HTTP_PORT: httpPort,
    SERVERFULL_ECH_ENABLED: echEnabled ? 'true' : 'false',
    SERVERFULL_ECH_CONFIG: echConfig,
    SERVERFULL_ECH_FRONTING_DOMAIN: echFrontingDomain,
    ...process.env
  };

  return { config, env };
}
