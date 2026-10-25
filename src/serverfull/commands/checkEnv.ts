/**
 * @file checkEnv.ts
 * @description Validates that the active Node.js or Bun runtime meets minimum engine requirements.
 */

import { formatDiagnostic } from '../format';

/**
 * Validates that the active Node.js or Bun runtime version meets minimum requirements.
 * Exits with code 1 and user-friendly diagnostics if requirements are not met.
 */
export function checkNodeVersion(): void {
  const bunVersion = (process.versions as Record<string, string | undefined>).bun;
  if (bunVersion) {
    const [bMajor, bMinor] = bunVersion.split('.').map(Number);
    if (bMajor < 1 || (bMajor === 1 && bMinor < 4)) {
      console.error(formatDiagnostic({
        level: 'error',
        title: 'DNS Worker - Environment Error',
        message: `Bun >= 1.4.0 is required for built-in node:sqlite support (found Bun v${bunVersion}).`,
        solutions: [
          'Please upgrade Bun to version 1.4.0 or higher.',
          'Alternatively, run with Node.js >= 22.5.0 (Recommended).'
        ]
      }));
      process.exit(1);
    }
    return;
  }

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
