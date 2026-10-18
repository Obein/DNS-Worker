/**
 * @file paths.ts
 * @description System, package, and configuration paths resolution for Serverfull mode.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { writeDefaultConfigFile } from './defaults';

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
 * Resolves the platform-specific default configuration directory.
 * - Linux: /etc/dns-worker (with automatic fallback to ~/.config/dns-worker for unprivileged non-root users if /etc is not writable)
 * - Windows: %ProgramData%\DNS-Worker (e.g. C:\ProgramData\DNS-Worker)
 * - macOS: ~/Library/Application Support/DNS-Worker
 */
export function getDefaultConfigDir(): string {
  if (process.platform === 'win32') {
    const programData = process.env.ProgramData || path.join(process.env.SystemDrive || 'C:', 'ProgramData');
    return path.join(programData, 'DNS-Worker');
  }

  if (process.platform === 'linux') {
    const systemEtc = '/etc/dns-worker';
    // If running as root, or if /etc/dns-worker already exists and is writable
    if (typeof process.getuid === 'function' && process.getuid() === 0) {
      return systemEtc;
    }
    if (fs.existsSync(systemEtc)) {
      try {
        fs.accessSync(systemEtc, fs.constants.W_OK);
        return systemEtc;
      } catch {
        /* Not writable by current user, fall through */
      }
    }
    // For unprivileged user when system /etc/dns-worker is not provisioned,
    // use standard XDG config directory: ~/.config/dns-worker
    const homeDir = process.env.HOME || '/tmp';
    const xdgConfigHome = process.env.XDG_CONFIG_HOME || path.join(homeDir, '.config');
    return path.join(xdgConfigHome, 'dns-worker');
  }

  if (process.platform === 'darwin') {
    const homeDir = process.env.HOME || '/tmp';
    return path.join(homeDir, 'Library', 'Application Support', 'DNS-Worker');
  }

  return path.join(process.cwd(), 'config');
}

/**
 * Resolves the platform-specific default configuration file path.
 * - Linux: /etc/dns-worker/.env
 * - Windows: %ProgramData%\DNS-Worker\.env
 * - macOS: ~/Library/Application Support/DNS-Worker/.env
 */
export function getDefaultConfigFilePath(): string {
  return path.join(getDefaultConfigDir(), '.env');
}

/**
 * Ensures system persistent directories (Persistent Data Dir and Config Directory) exist if writable.
 * Optionally auto-seeds the default configuration file if not already present.
 *
 * @param autoSeedConfig - If true (default), automatically writes the default configuration template to the config file if missing.
 * @returns Persistent paths for data directory, configuration directory, and configuration file.
 */
export function ensurePersistentDirs(autoSeedConfig: boolean = true): { dataDir: string; configDir: string; configFile: string } {
  const dataDir = getDefaultDataDir();
  const configDir = getDefaultConfigDir();
  const configFile = getDefaultConfigFilePath();

  try {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true, mode: 0o755 });
    }
  } catch {}

  try {
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true, mode: 0o755 });
    }
  } catch {}

  if (autoSeedConfig) {
    try {
      writeDefaultConfigFile(configFile, false);
    } catch {}
  }

  // If running with sudo under Linux, ensure ownership of dataDir and configDir is assigned to the real user
  if (process.platform === 'linux' && process.env.SUDO_USER && process.env.SUDO_USER !== 'root') {
    const sudoUser = process.env.SUDO_USER.trim();
    if (/^[a-zA-Z0-9._-]+$/.test(sudoUser)) {
      try {
        execSync(`chown -R ${sudoUser} "${dataDir}"`);
      } catch {}
      try {
        execSync(`chown -R ${sudoUser} "${configDir}"`);
      } catch {}
    }
  }

  return { dataDir, configDir, configFile };
}
