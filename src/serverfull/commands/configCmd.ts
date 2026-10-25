/**
 * @file configCmd.ts
 * @description Subcommand handler for `dns-worker config` (show, path, template, init).
 */

import path from 'node:path';
import {
  getDefaultDbPath,
  getDefaultDataDir,
  getDefaultConfigDir,
  getDefaultConfigFilePath,
  loadEnvFiles,
  getLoadedEnvFiles
} from '../config';
import { DEFAULT_ENV_SERVERFULL_TEMPLATE, writeDefaultConfigFile } from '../defaults';
import {
  formatBanner,
  formatDiagnostic,
  formatKeyValueSection,
  formatTip
} from '../format';

/**
 * Validates that user-supplied configuration file path contains only safe characters.
 *
 * @param input - Path string to inspect.
 * @returns True if path string contains only alphanumeric and safe filesystem characters.
 */
export function isSafeConfigPathArg(input: string): boolean {
  return /^[a-zA-Z0-9._\-\/\\ :]+$/.test(input);
}

/**
 * Handles `dns-worker config` subcommands (show, path, template, init).
 *
 * @param subAction - Subcommand action name.
 * @param targetArg - Optional path or flag argument.
 */
export function handleConfigCommand(subAction: string, targetArg?: string): void {
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
    if (targetArg && targetArg !== '--force' && !isSafeConfigPathArg(targetArg)) {
      console.error(formatDiagnostic({
        level: 'error',
        title: 'Invalid Configuration Path',
        message: 'The provided config path contains unsupported characters.',
        solutions: [
          'Use a normal filesystem path containing letters, numbers, spaces, ".", "_", "-", "/", "\\", or ":" only.',
          'Avoid shell metacharacters and control characters in path arguments.'
        ]
      }));
      process.exit(1);
    }
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
