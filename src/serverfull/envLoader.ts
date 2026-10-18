/**
 * @file envLoader.ts
 * @description Hierarchical dotenv environment file loading and loaded path tracking.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  ensurePersistentDirs,
  getDefaultConfigFilePath,
  getDefaultDataDir,
  getPackageRoot
} from './paths';

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
 * Parses simple KEY=VALUE dotenv files.
 * Returns true if file was successfully read.
 */
export function loadDotEnv(filePath: string): boolean {
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
 * 2. System config directory: /etc/dns-worker/.env on Linux, %ProgramData%\\DNS-Worker\\.env on Windows
 * 3. Linux system config directory & compatibility paths
 * 4. Package distribution root: <packageRoot>/.env.serverfull
 */
export function loadEnvFiles(rootDir: string = process.cwd()): string[] {
  ensurePersistentDirs(true);
  loadedEnvFiles.length = 0;

  const candidatePaths = [
    // 1. Current working directory
    path.join(rootDir, '.dev.vars'),
    path.join(rootDir, '.env'),
    path.join(rootDir, '.env.serverfull'),

    // 2. Standard system configuration file (/etc/dns-worker/.env on Linux)
    getDefaultConfigFilePath(),

    // 3. Linux standard system paths & compatibility fallbacks
    process.platform === 'linux' ? '/etc/dns-worker/.env' : null,
    process.platform === 'linux' ? '/etc/default/dns-worker' : null,
    process.platform === 'linux' ? path.join(getDefaultDataDir(), '.env') : null,

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
