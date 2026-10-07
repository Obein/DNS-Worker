/**
 * @file schtasks.ts
 * @description Windows Task Scheduler (schtasks.exe) background daemon management provider.
 * Registers boot tasks under NT AUTHORITY\SYSTEM with log capture.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { ServiceAction, ServiceExecDetails } from './types';
import { getServiceExecDetails, isWindowsAdmin } from './env';
import {
  formatBanner,
  formatDiagnostic,
  formatCommandList,
  formatLogBox
} from '../format';

export const WINDOWS_TASK_NAME = 'DNS-Worker';
export const WINDOWS_DATA_DIR = path.join(process.env.ProgramData || 'C:\\ProgramData', 'DNS-Worker');
export const WINDOWS_LOG_FILE = path.join(WINDOWS_DATA_DIR, 'service.log');
export const WINDOWS_BAT_FILE = path.join(WINDOWS_DATA_DIR, 'run-service.bat');

/**
 * Generates the Windows launcher batch script content.
 *
 * @param details - The execution parameters.
 * @returns Windows batch script content.
 */
export function generateWindowsBat(details: ServiceExecDetails): string {
  return `@echo off\r\nsetlocal\r\ncd /d "${details.workDir}"\r\n"${details.nodePath}" "${details.scriptPath}" >> "${WINDOWS_LOG_FILE}" 2>&1\r\n`;
}

/**
 * Handles Windows Task Scheduler service actions (install, uninstall, start, stop, restart, status, logs).
 *
 * @param action - Action verb.
 */
export async function handleWindowsTask(action: ServiceAction | string): Promise<void> {
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

        const batContent = generateWindowsBat(details);
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
