/**
 * @file checkEnv.ts
 * @description Validates and coordinates runtime execution across Node.js and Bun engines.
 */

import { spawnSync, spawn } from 'node:child_process';
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

/**
 * Returns a human-friendly description of the currently active JavaScript runtime engine.
 *
 * @returns e.g. "Bun v1.4.1 (JavaScriptCore)" or "Node.js v24.2.0 (V8)"
 */
export function getActiveRuntimeDescription(): string {
  const bunVersion = (process.versions as Record<string, string | undefined>).bun;
  if (bunVersion) {
    return `Bun v${bunVersion} (JavaScriptCore)`;
  }
  return `Node.js v${process.versions.node} (V8)`;
}

/**
 * Handles explicit runtime switching if --runtime or DNS_WORKER_RUNTIME requests an alternate runtime engine.
 * Returns true if a child runtime was spawned (in which case the current process should yield).
 *
 * @param requestedRuntime - Optional runtime flag from CLI ('node' | 'bun' | 'auto').
 * @returns True if child process was spawned to take over.
 */
export function handleRuntimeSwitch(requestedRuntime?: string): boolean {
  if (process.env.DNS_WORKER_SWITCHED_RUNTIME === '1') {
    return false;
  }

  const target = (requestedRuntime || process.env.DNS_WORKER_RUNTIME || process.env.SERVERFULL_RUNTIME || '').toLowerCase().trim();
  if (!target || target === 'auto') {
    return false;
  }

  const isCurrentBun = Boolean((process.versions as Record<string, string | undefined>).bun);
  const isCurrentNode = !isCurrentBun;

  if (target === 'bun' && isCurrentNode) {
    try {
      const check = spawnSync('bun', ['--version'], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
      if (check.status === 0 && check.stdout) {
        const cleanArgs = process.argv.slice(1).filter(arg => !arg.startsWith('--runtime=') && arg !== '--runtime');
        const child = spawn('bun', cleanArgs, {
          stdio: 'inherit',
          env: { ...process.env, DNS_WORKER_SWITCHED_RUNTIME: '1' }
        });
        child.on('exit', (code, signal) => {
          if (signal) process.kill(process.pid, signal);
          else process.exit(code ?? 0);
        });
        return true;
      } else {
        console.warn('[Runtime] Bun runtime was requested (--runtime bun), but bun binary was not found in PATH. Continuing with Node.js.');
      }
    } catch {
      console.warn('[Runtime] Failed to invoke Bun binary. Continuing with Node.js.');
    }
  } else if (target === 'node' && isCurrentBun) {
    try {
      const check = spawnSync('node', ['--version'], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
      if (check.status === 0 && check.stdout) {
        const cleanArgs = process.argv.slice(1).filter(arg => !arg.startsWith('--runtime=') && arg !== '--runtime');
        const child = spawn('node', cleanArgs, {
          stdio: 'inherit',
          env: { ...process.env, DNS_WORKER_SWITCHED_RUNTIME: '1' }
        });
        child.on('exit', (code, signal) => {
          if (signal) process.kill(process.pid, signal);
          else process.exit(code ?? 0);
        });
        return true;
      } else {
        console.warn('[Runtime] Node.js runtime was requested (--runtime node), but node binary was not found in PATH. Continuing with Bun.');
      }
    } catch {
      console.warn('[Runtime] Failed to invoke Node.js binary. Continuing with Bun.');
    }
  }

  return false;
}
