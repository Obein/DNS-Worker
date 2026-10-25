/**
 * @file cli.ts
 * @description Command-line argument parsing and subcommand dispatcher for Serverfull mode.
 * Decomposed into specialized SRP command modules under `./commands/`.
 */

import { parseArgs } from 'node:util';
import {
  getPackageVersion,
  getServerfullConfig,
  ensurePersistentDirs,
  ServerfullCliArgs
} from './config';
import { formatDiagnostic } from './format';
import { showServerfullStatus } from './status';
import { handleServiceAction } from './service';
import { handleResetCommand } from './reset';

import { checkNodeVersion } from './commands/checkEnv';
import { handleConfigCommand, isSafeConfigPathArg } from './commands/configCmd';
import { handleEchCommand } from './commands/echCmd';
import { printHelp } from './commands/helpCmd';

export { checkNodeVersion } from './commands/checkEnv';
export { handleConfigCommand, isSafeConfigPathArg } from './commands/configCmd';
export { handleEchCommand } from './commands/echCmd';
export { printHelp } from './commands/helpCmd';

/**
 * Parses CLI flags and dispatches subcommands (status, ech, reset, service, config, help, version).
 *
 * @returns Parsed ServerfullCliArgs if server daemon should launch.
 */
export async function parseCli(): Promise<ServerfullCliArgs> {
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
        'database-service': { type: 'string' },
        'db-service': { type: 'string' },
        db: { type: 'string' },
        'turso-url': { type: 'string' },
        'turso-token': { type: 'string' },
        'default-profile': { type: 'string' },
        'disable-udp': { type: 'boolean' },
        'disable-dot': { type: 'boolean' },
        'ech-enabled': { type: 'boolean' },
        'ech-config': { type: 'string' },
        'ech-fronting-domain': { type: 'string' },
        user: { type: 'string', short: 'u' },
        status: { type: 'boolean', short: 's' },
        force: { type: 'boolean', short: 'f' },
        yes: { type: 'boolean', short: 'y' },
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

    if (positionals[0]?.toLowerCase() === 'reset') {
      const isForce = Boolean(
        values.force ||
        values.yes ||
        process.argv.includes('--force') ||
        process.argv.includes('-f') ||
        process.argv.includes('-y') ||
        process.argv.includes('--yes')
      );
      await handleResetCommand({ force: isForce });
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
      const targetUser = values.user as string | undefined;
      await handleServiceAction(action, targetUser);
      process.exit(0);
    }

    if (positionals[0]?.toLowerCase() === 'postinstall') {
      try {
        const { dataDir, configFile } = ensurePersistentDirs(true);
        console.log(`[dns-worker] Initialized data directory: ${dataDir}`);
        console.log(`[dns-worker] Initialized configuration file: ${configFile}`);
      } catch { }
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
