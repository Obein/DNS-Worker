/**
 * @file service.ts
 * @description Cross-platform background service and daemon manager for DNS Worker Serverfull mode.
 * - Linux: systemd unit management with CAP_NET_BIND_SERVICE.
 * - Windows: Task Scheduler (schtasks.exe) with SYSTEM account, onstart trigger, and log capture.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import {
  formatBanner,
  formatDiagnostic,
  formatCommandList,
  formatLogBox
} from './format';

export const SERVICE_NAME = 'dns-worker';
export const SERVICE_FILE_NAME = `${SERVICE_NAME}.service`;
export const SYSTEMD_SERVICE_PATH = `/etc/systemd/system/${SERVICE_FILE_NAME}`;

export const WINDOWS_TASK_NAME = 'DNS-Worker';
export const WINDOWS_DATA_DIR = path.join(process.env.ProgramData || 'C:\\ProgramData', 'DNS-Worker');
export const WINDOWS_LOG_FILE = path.join(WINDOWS_DATA_DIR, 'service.log');
export const WINDOWS_BAT_FILE = path.join(WINDOWS_DATA_DIR, 'run-service.bat');

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
 * Execution details resolved for generating background service scripts.
 */
export interface ServiceExecDetails {
  execCmd: string;
  nodePath: string;
  scriptPath: string;
  workDir: string;
  user: string;
}

/**
 * Resolves appropriate binary execution path, working directory, and user account.
 *
 * @returns Service execution parameters.
 */
export function getServiceExecDetails(): ServiceExecDetails {
  const nodePath = process.execPath;
  const scriptPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
  const user = process.env.SUDO_USER || process.env.USER || 'root';
  const homeDir = process.env.SUDO_USER
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

/**
 * Generates the Linux systemd unit file content with CAP_NET_BIND_SERVICE capabilities.
 *
 * @param details - The execution parameters.
 * @returns Systemd unit file content string.
 */
export function generateSystemdUnit(details: ServiceExecDetails): string {
  const { execCmd, workDir, user } = details;

  return `[Unit]
Description=DNS Worker Serverfull Service (UDP DNS, DoT & Web Dashboard)
After=network.target

[Service]
Type=simple
User=${user}
WorkingDirectory=${workDir}
ExecStart=${execCmd}
Restart=always
RestartSec=5
LimitNOFILE=65535

# Grant capability to bind ports 53 and 853 without running as full root
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=dns-worker

[Install]
WantedBy=multi-user.target
`;
}

/**
 * Handles Linux systemd service actions (install, uninstall, start, stop, restart, status, logs).
 *
 * @param action - Action verb.
 */
async function handleLinuxSystemd(action: string): Promise<void> {
  const isRoot = isLinuxRoot();

  switch (action) {
    case 'install': {
      if (!isRoot) {
        console.error(formatDiagnostic({
          level: 'error',
          title: 'Permission Denied',
          message: 'Installing a systemd service requires elevated privileges (root).',
          solutions: [
            'Run the command with sudo: sudo dns-worker service install'
          ]
        }));
        process.exit(1);
      }

      const details = getServiceExecDetails();
      const unitContent = generateSystemdUnit(details);

      try {
        fs.writeFileSync(SYSTEMD_SERVICE_PATH, unitContent, 'utf-8');

        execSync('systemctl daemon-reload', { stdio: 'inherit' });
        execSync(`systemctl enable ${SERVICE_NAME}`, { stdio: 'inherit' });
        execSync(`systemctl restart ${SERVICE_NAME}`, { stdio: 'inherit' });

        const banner = formatBanner({
          title: 'DNS Worker Linux Service Installed & Started',
          borderChar: '=',
          bullet: '• ',
          items: [
            { label: 'Service File', value: SYSTEMD_SERVICE_PATH },
            { label: 'Running As User', value: `${details.user} (CAP_NET_BIND_SERVICE)` },
            { label: 'Privileged Ports', value: 'Port 53 & 853 enabled without root' },
            { label: 'Auto-restart', value: 'Enabled on system boot (Restart=always)' }
          ]
        });

        const commandGuide = formatCommandList({
          title: 'Useful service management commands:',
          items: [
            { command: 'dns-worker service status', desc: 'Check live status' },
            { command: 'dns-worker service logs', desc: 'Tail live syslog / journal logs' },
            { command: 'sudo dns-worker service restart', desc: 'Restart service' },
            { command: 'sudo dns-worker service stop', desc: 'Stop service' },
            { command: 'sudo dns-worker service uninstall', desc: 'Remove service' }
          ]
        });

        console.log('\n' + banner + '\n\n' + commandGuide);
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(formatDiagnostic({
          level: 'error',
          title: 'Service Installation Failed',
          message: errorMsg,
          solutions: [
            'Ensure systemd is running as PID 1 on your Linux distribution.',
            `Verify permissions to write to ${SYSTEMD_SERVICE_PATH}.`
          ]
        }));
        process.exit(1);
      }
      break;
    }

    case 'uninstall': {
      if (!isRoot) {
        console.error(formatDiagnostic({
          level: 'error',
          title: 'Permission Denied',
          message: 'Uninstalling a systemd service requires elevated privileges (root).',
          solutions: [
            'Run the command with sudo: sudo dns-worker service uninstall'
          ]
        }));
        process.exit(1);
      }

      try {
        try { execSync(`systemctl stop ${SERVICE_NAME}`, { stdio: 'ignore' }); } catch {}
        try { execSync(`systemctl disable ${SERVICE_NAME}`, { stdio: 'ignore' }); } catch {}

        if (fs.existsSync(SYSTEMD_SERVICE_PATH)) {
          fs.unlinkSync(SYSTEMD_SERVICE_PATH);
        }

        execSync('systemctl daemon-reload', { stdio: 'inherit' });
        console.log(formatDiagnostic({
          level: 'success',
          title: 'Service Removed',
          message: `DNS Worker systemd service removed from ${SYSTEMD_SERVICE_PATH}.`
        }));
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(formatDiagnostic({
          level: 'error',
          title: 'Service Uninstall Failed',
          message: errorMsg
        }));
        process.exit(1);
      }
      break;
    }

    case 'start':
    case 'stop':
    case 'restart': {
      if (!isRoot) {
        console.error(formatDiagnostic({
          level: 'error',
          title: 'Permission Denied',
          message: `Managing systemd service (${action}) requires elevated privileges.`,
          solutions: [
            `Run with sudo: sudo dns-worker service ${action}`
          ]
        }));
        process.exit(1);
      }

      try {
        execSync(`systemctl ${action} ${SERVICE_NAME}`, { stdio: 'inherit' });
        console.log(formatDiagnostic({
          level: 'success',
          title: 'Service Action Executed',
          message: `systemctl ${action} ${SERVICE_NAME}`
        }));
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(formatDiagnostic({
          level: 'error',
          title: `Service ${action} Failed`,
          message: errorMsg
        }));
        process.exit(1);
      }
      break;
    }

    case 'status': {
      try {
        execSync(`systemctl status ${SERVICE_NAME}`, { stdio: 'inherit' });
      } catch {
        // systemctl status exits with code 3 when service is stopped; stdio already printed status output
      }
      break;
    }

    case 'logs': {
      try {
        execSync(`journalctl -u ${SERVICE_NAME} -f -n 50`, { stdio: 'inherit' });
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(formatDiagnostic({
          level: 'error',
          title: 'Service Logs Error',
          message: `journalctl exited: ${errorMsg}`
        }));
      }
      break;
    }

    default: {
      console.error(formatDiagnostic({
        level: 'error',
        title: 'Service Command Error',
        message: `Unknown service action "${action}".`,
        solutions: [
          'Supported actions: install, start, stop, restart, status, logs, uninstall',
          'Example: sudo dns-worker service install'
        ]
      }));
      process.exit(1);
    }
  }
}

/**
 * Handles Windows Task Scheduler service actions (install, uninstall, start, stop, restart, status, logs).
 *
 * @param action - Action verb.
 */
async function handleWindowsTask(action: string): Promise<void> {
  const isAdmin = isWindowsAdmin();

  switch (action) {
    case 'install': {
      if (!isAdmin) {
        console.error(formatDiagnostic({
          level: 'error',
          title: 'Permission Denied',
          message: 'Registering a Windows background service (scheduled task) requires Administrator privileges.',
          solutions: [
            'Please open PowerShell or Command Prompt as Administrator ("Run as Administrator").',
            'Then re-run: dns-worker service install'
          ]
        }));
        process.exit(1);
      }

      const details = getServiceExecDetails();

      try {
        if (!fs.existsSync(WINDOWS_DATA_DIR)) {
          fs.mkdirSync(WINDOWS_DATA_DIR, { recursive: true });
        }

        const batContent = `@echo off\r\nsetlocal\r\ncd /d "${details.workDir}"\r\n"${details.nodePath}" "${details.scriptPath}" >> "${WINDOWS_LOG_FILE}" 2>&1\r\n`;
        fs.writeFileSync(WINDOWS_BAT_FILE, batContent, 'utf-8');

        // Create Task in Task Scheduler to run on boot with highest privileges under SYSTEM account
        const createCmd = `schtasks /create /tn "${WINDOWS_TASK_NAME}" /tr "\\"${WINDOWS_BAT_FILE}\\"" /sc onstart /ru "SYSTEM" /rl HIGHEST /f`;
        execSync(createCmd, { stdio: 'inherit' });

        // Immediately start the task
        try {
          execSync(`schtasks /run /tn "${WINDOWS_TASK_NAME}"`, { stdio: 'inherit' });
        } catch {
          /* ignore */
        }

        const banner = formatBanner({
          title: 'DNS Worker Windows Service Installed & Started',
          borderChar: '=',
          bullet: '• ',
          items: [
            { label: 'Task Name', value: WINDOWS_TASK_NAME },
            { label: 'Account', value: 'NT AUTHORITY\\SYSTEM (Highest Privileges)' },
            { label: 'Auto-Start', value: 'On system startup (/sc onstart)' },
            { label: 'Launcher Script', value: WINDOWS_BAT_FILE },
            { label: 'Log Output', value: WINDOWS_LOG_FILE }
          ]
        });

        const commandGuide = formatCommandList({
          title: 'Useful Windows service management commands:',
          items: [
            { command: 'dns-worker service status', desc: 'View task status' },
            { command: 'dns-worker service logs', desc: 'View recent service logs' },
            { command: 'dns-worker service restart', desc: 'Restart background task' },
            { command: 'dns-worker service stop', desc: 'Stop background task' },
            { command: 'dns-worker service uninstall', desc: 'Remove background task' }
          ]
        });

        console.log('\n' + banner + '\n\n' + commandGuide);
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(formatDiagnostic({
          level: 'error',
          title: 'Windows Service Installation Failed',
          message: errorMsg,
          solutions: [
            'Ensure you are running the terminal as Administrator.',
            'Verify that the Windows Task Scheduler service is active.'
          ]
        }));
        process.exit(1);
      }
      break;
    }

    case 'uninstall': {
      if (!isAdmin) {
        console.error(formatDiagnostic({
          level: 'error',
          title: 'Permission Denied',
          message: 'Removing a Windows background service requires Administrator privileges.',
          solutions: [
            'Run in an Administrator terminal: dns-worker service uninstall'
          ]
        }));
        process.exit(1);
      }

      try {
        try { execSync(`schtasks /end /tn "${WINDOWS_TASK_NAME}"`, { stdio: 'ignore' }); } catch {}
        execSync(`schtasks /delete /tn "${WINDOWS_TASK_NAME}" /f`, { stdio: 'inherit' });

        if (fs.existsSync(WINDOWS_BAT_FILE)) {
          fs.unlinkSync(WINDOWS_BAT_FILE);
        }

        console.log(formatDiagnostic({
          level: 'success',
          title: 'Service Removed',
          message: `Windows background task "${WINDOWS_TASK_NAME}" removed successfully.`
        }));
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(formatDiagnostic({
          level: 'error',
          title: 'Windows Service Removal Failed',
          message: errorMsg
        }));
        process.exit(1);
      }
      break;
    }

    case 'start': {
      try {
        execSync(`schtasks /run /tn "${WINDOWS_TASK_NAME}"`, { stdio: 'inherit' });
        console.log(formatDiagnostic({
          level: 'success',
          title: 'Service Started',
          message: `Started Windows background task: ${WINDOWS_TASK_NAME}`
        }));
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(formatDiagnostic({
          level: 'error',
          title: 'Task Start Failed',
          message: errorMsg,
          solutions: [
            `Verify the task exists with 'dns-worker service status'.`,
            `Or reinstall with 'dns-worker service install' in Administrator terminal.`
          ]
        }));
        process.exit(1);
      }
      break;
    }

    case 'stop': {
      try {
        execSync(`schtasks /end /tn "${WINDOWS_TASK_NAME}"`, { stdio: 'inherit' });
        console.log(formatDiagnostic({
          level: 'success',
          title: 'Service Stopped',
          message: `Stopped Windows background task: ${WINDOWS_TASK_NAME}`
        }));
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(formatDiagnostic({
          level: 'error',
          title: 'Task Stop Failed',
          message: errorMsg
        }));
        process.exit(1);
      }
      break;
    }

    case 'restart': {
      try {
        try { execSync(`schtasks /end /tn "${WINDOWS_TASK_NAME}"`, { stdio: 'ignore' }); } catch {}
        execSync(`schtasks /run /tn "${WINDOWS_TASK_NAME}"`, { stdio: 'inherit' });
        console.log(formatDiagnostic({
          level: 'success',
          title: 'Service Restarted',
          message: `Restarted Windows background task: ${WINDOWS_TASK_NAME}`
        }));
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(formatDiagnostic({
          level: 'error',
          title: 'Task Restart Failed',
          message: errorMsg
        }));
        process.exit(1);
      }
      break;
    }

    case 'status': {
      try {
        execSync(`schtasks /query /tn "${WINDOWS_TASK_NAME}" /fo LIST /v`, { stdio: 'inherit' });
      } catch {
        console.log(formatDiagnostic({
          level: 'info',
          title: 'Windows Task Status',
          message: `Task "${WINDOWS_TASK_NAME}" is not currently registered in Windows Task Scheduler.`,
          solutions: [
            'Run "dns-worker service install" in an Administrator terminal to register and run it.'
          ]
        }));
      }
      break;
    }

    case 'logs': {
      if (!fs.existsSync(WINDOWS_LOG_FILE)) {
        console.log(formatDiagnostic({
          level: 'info',
          title: 'Service Logs Notice',
          message: `No log file found at ${WINDOWS_LOG_FILE} yet.`,
          details: [
            'The background service has not produced any log output or has not been started yet.'
          ]
        }));
        return;
      }

      try {
        const content = fs.readFileSync(WINDOWS_LOG_FILE, 'utf-8');
        const lines = content.trim().split(/\r?\n/);
        const tailLines = lines.slice(-50).join('\n');

        console.log(formatLogBox({
          title: `Recent 50 Service Log Lines: ${WINDOWS_LOG_FILE}`,
          content: tailLines,
          borderChar: '-',
          tip: `In PowerShell, run: Get-Content "${WINDOWS_LOG_FILE}" -Tail 50 -Wait`
        }));
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(formatDiagnostic({
          level: 'error',
          title: 'Service Logs Error',
          message: `Error reading log file: ${errorMsg}`
        }));
      }
      break;
    }

    default: {
      console.error(formatDiagnostic({
        level: 'error',
        title: 'Service Command Error',
        message: `Unknown service action "${action}".`,
        solutions: [
          'Supported actions: install, start, stop, restart, status, logs, uninstall',
          'Example: dns-worker service install'
        ]
      }));
      process.exit(1);
    }
  }
}

/**
 * Handles 'dns-worker service <action>' subcommands across Linux and Windows.
 *
 * @param action - Action verb: 'install' | 'uninstall' | 'start' | 'stop' | 'restart' | 'status' | 'logs'
 */
export async function handleServiceAction(action: string): Promise<void> {
  if (process.platform === 'win32') {
    await handleWindowsTask(action);
  } else if (process.platform === 'linux') {
    await handleLinuxSystemd(action);
  } else {
    // macOS or other platform
    const details = getServiceExecDetails();
    const unitContent = generateSystemdUnit(details);

    console.log(formatDiagnostic({
      level: 'info',
      title: 'Platform Service Notice',
      message: `Automatic service management is supported on Linux (systemd) and Windows (schtasks). Current platform: ${process.platform}.`,
      details: [
        'A systemd service unit template is provided below for manual reference:'
      ]
    }));
    console.log(formatLogBox({
      title: 'systemd service unit template',
      content: unitContent.trim(),
      borderChar: '-'
    }));
  }
}
