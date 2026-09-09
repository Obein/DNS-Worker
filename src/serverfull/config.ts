/**
 * @file config.ts
 * @description Configuration loader and environment variable manager for Serverfull mode.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Env } from '../types';

export interface ServerfullConfig {
  tlsKeyPath: string;
  tlsCertPath: string;
  udpPort: number;
  dotPort: number;
  httpPort: number;
  host: string;
  dbPath: string;
  defaultProfileKey: string;
}

/**
 * Parses simple KEY=VALUE dotenv files.
 */
function loadDotEnv(filePath: string): void {
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
    }
  } catch (err) {
    console.warn(`[Config] Failed to read ${filePath}:`, err);
  }
}

/**
 * Loads configuration files from root workspace directory.
 */
export function loadEnvFiles(rootDir: string = process.cwd()): void {
  loadDotEnv(path.join(rootDir, '.dev.vars'));
  loadDotEnv(path.join(rootDir, '.env'));
  loadDotEnv(path.join(rootDir, '.env.serverfull'));
}

/**
 * Loads Serverfull-specific options and builds the standard Env interface.
 */
export function getServerfullConfig(): { config: ServerfullConfig; env: Env } {
  loadEnvFiles();

  // Support both SERVERFULL_TLS_KEY_PATH and SERFULL_TLS_KEY_PATH
  const tlsKeyPath = process.env.SERVERFULL_TLS_KEY_PATH || process.env.SERFULL_TLS_KEY_PATH || '';
  // Support SERVERFULL_TLS_CERT_PATH and public key aliases
  const tlsCertPath = process.env.SERVERFULL_TLS_CERT_PATH || 
                      process.env.SERVERFULL_TLS_PUB_PATH || 
                      process.env.SERVERFULL_TLS_PUBLIC_KEY_PATH ||
                      process.env.SERFULL_TLS_CERT_PATH ||
                      process.env.SERFULL_TLS_PUB_PATH || '';

  const udpPort = parseInt(process.env.SERVERFULL_UDP_PORT || process.env.DNS_PORT || '53', 10);
  const dotPort = parseInt(process.env.SERVERFULL_DOT_PORT || process.env.DOT_PORT || '853', 10);
  const httpPort = parseInt(process.env.SERVERFULL_HTTP_PORT || process.env.PORT || '3000', 10);
  const host = process.env.SERVERFULL_HOST || process.env.SERVERFULL_BIND_ADDRESS || '0.0.0.0';
  const dbPath = process.env.SERVERFULL_DB_PATH || process.env.DB_PATH || path.join(process.cwd(), 'data', 'dns_worker.sqlite');
  const defaultProfileKey = process.env.SERVERFULL_DEFAULT_PROFILE_KEY || process.env.DEFAULT_PROFILE_KEY || '';

  const config: ServerfullConfig = {
    tlsKeyPath,
    tlsCertPath,
    udpPort,
    dotPort,
    httpPort,
    host,
    dbPath,
    defaultProfileKey
  };

  const env: Env = {
    DB: null as any, // Set by db.ts
    ASSETS: null as any, // Set by http.ts
    JWT_SECRET: process.env.JWT_SECRET || 'dns_worker_serverfull_secret_' + crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, ''),
    FAIL_OPEN_UPSTREAM: process.env.FAIL_OPEN_UPSTREAM || 'https://freedns.controld.com/no-ads-malware-typo',
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
