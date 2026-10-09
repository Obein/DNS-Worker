/**
 * @file env.ts
 * @description System privilege detection and execution path resolution for service runners.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { ServiceExecDetails } from './types';

/**
 * Checks whether the current process has Administrator privileges on Windows.
 *
 * @returns True if running as elevated Administrator.
 */
export function isWindowsAdmin(): boolean {
  try {
    execSync('net session', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Checks whether the current process has root privileges on Linux.
 *
 * @returns True if running with root UID.
 */
export function isLinuxRoot(): boolean {
  return typeof process.getuid === 'function' && process.getuid() === 0;
}

/**
 * Resolves appropriate binary execution path, working directory, and user account.
 *
 * @param targetUser - Optional designated user to run the service as (e.g. 'root').
 * @returns Service execution parameters.
 */
export function getServiceExecDetails(targetUser?: string): ServiceExecDetails {
  const nodePath = process.execPath;
  const scriptPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
  const user = targetUser || process.env.SERVERFULL_SERVICE_USER || process.env.SUDO_USER || process.env.USER || 'root';
  const homeDir = user === 'root'
    ? '/root'
    : (process.env.SUDO_USER && user === process.env.SUDO_USER)
      ? `/home/${process.env.SUDO_USER}`
      : (process.env.HOME || process.cwd());

  let execCmd = '';
  if (scriptPath && fs.existsSync(scriptPath)) {
    execCmd = `"${nodePath}" "${scriptPath}"`;
  } else {
    execCmd = 'dns-worker';
  }

  return {
    execCmd,
    nodePath,
    scriptPath,
    workDir: process.platform === 'win32' ? process.cwd() : homeDir,
    user
  };
}
