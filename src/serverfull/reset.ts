/**
 * @file reset.ts
 * @description Reset command handler for Serverfull mode:
 * Restores default .env configuration and wipes SQLite database with two-step confirmation.
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { DatabaseSync } from 'node:sqlite';
import {
  getDefaultConfigFilePath,
  getDefaultDbPath
} from './config';
import { writeDefaultConfigFile } from './defaults';
import { initServerfullDb } from './db';
import { formatBanner, formatDiagnostic, formatKeyValueSection } from './format';

/**
 * Options for the reset command.
 */
export interface ResetOptions {
  /** If true, bypass interactive confirmation prompt. */
  force?: boolean;
}

/**
 * Handles the `dns-worker reset` CLI command.
 *
 * Prompts the user for secondary confirmation unless `--force` or `-y` is provided.
 * Wipes the database and re-initializes all migrations from scratch, and rewrites
 * the default .env configuration template.
 *
 * @param options - Execution flags.
 */
export async function handleResetCommand(options: ResetOptions = {}): Promise<void> {
  const configPath = getDefaultConfigFilePath();
  const dbPath = getDefaultDbPath();
  const cwdEnv = path.join(process.cwd(), '.env');

  // Secondary confirmation check
  if (!options.force) {
    if (!input.isTTY) {
      console.error(formatDiagnostic({
        level: 'error',
        title: 'DNS Worker - Confirmation Required',
        message: 'The reset command wipes all database records and resets configuration files.',
        solutions: [
          'In non-interactive environments, provide the --force or -y flag: dns-worker reset --force',
          'Or run interactively in a terminal to confirm the operation.'
        ]
      }));
      process.exit(1);
    }

    const warningBanner = formatBanner({
      title: '⚠️  CAUTION: FACTORY RESET (DATA DESTRUCTION)',
      borderChar: '!',
      bullet: '• '
    });

    const targetItems = [
      { label: 'Configuration File', value: configPath },
      { label: 'SQLite Database', value: dbPath }
    ];
    if (fs.existsSync(cwdEnv)) {
      targetItems.push({ label: 'Local .env File', value: cwdEnv });
    }

    const details = formatKeyValueSection({
      title: '\nTarget Resources to be Reset:',
      items: targetItems
    });

    console.log([
      warningBanner,
      details,
      '\nThis operation will:',
      '  1. Overwrite configuration files with the factory default .env template.',
      '  2. Permanently delete all query logs, user accounts, access points, and custom rules.',
      '  3. Recreate a clean database with fresh schema migrations.\n'
    ].join('\n'));

    const rl = readline.createInterface({ input, output });
    try {
      const answer = await rl.question('Are you sure you want to proceed with factory reset? (yes/no): ');
      const normalized = answer.trim().toLowerCase();
      if (normalized !== 'yes' && normalized !== 'y') {
        console.log(formatDiagnostic({
          level: 'info',
          title: 'Operation Cancelled',
          message: 'Factory reset cancelled by user. No files or database records were modified.'
        }));
        return;
      }
    } finally {
      rl.close();
    }
  }

  // 1. Wipe SQLite database
  const wipeDbTablesAndFiles = (targetPath: string): void => {
    if (fs.existsSync(targetPath)) {
      try {
        const rawDb = new DatabaseSync(targetPath);
        rawDb.exec('PRAGMA foreign_keys = OFF;');
        const tables = rawDb
          .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
          .all() as Array<{ name: string }>;
        for (const { name } of tables) {
          rawDb.exec(`DROP TABLE IF EXISTS "${name}";`);
        }
        rawDb.exec('PRAGMA wal_checkpoint(TRUNCATE);');
        rawDb.exec('VACUUM;');
        rawDb.close();
      } catch (err: unknown) {
        console.warn(`[Reset] Could not cleanly drop tables in ${targetPath}:`, err);
      }
    }

    const files = [targetPath, `${targetPath}-wal`, `${targetPath}-shm`];
    for (const file of files) {
      if (fs.existsSync(file)) {
        try {
          fs.unlinkSync(file);
        } catch {
          // In-use on Windows; table truncate above already cleared the data
        }
      }
    }
  };

  wipeDbTablesAndFiles(dbPath);

  // Also check and wipe legacy ./data/dns_worker.sqlite if it exists
  const legacyDb = path.join(process.cwd(), 'data', 'dns_worker.sqlite');
  if (fs.existsSync(legacyDb) && path.resolve(legacyDb) !== path.resolve(dbPath)) {
    wipeDbTablesAndFiles(legacyDb);
  }

  // 2. Re-initialize database schema fresh
  console.log('[Reset] Rebuilding fresh database schema...');
  initServerfullDb(dbPath);

  // 3. Restore default .env configuration file
  writeDefaultConfigFile(configPath, true);

  if (fs.existsSync(cwdEnv) && path.resolve(cwdEnv) !== path.resolve(configPath)) {
    writeDefaultConfigFile(cwdEnv, true);
  }

  console.log(formatDiagnostic({
    level: 'success',
    title: 'DNS Worker - Factory Reset Completed',
    message: 'System configuration restored to default template and database re-initialized.',
    solutions: [
      `Default configuration written to: ${configPath}`,
      `Pristine database created at: ${dbPath}`,
      "Run 'dns-worker status' to inspect system status.",
      "Run 'dns-worker' to start the service."
    ]
  }));
}
