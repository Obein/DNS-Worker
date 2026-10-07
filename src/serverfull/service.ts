/**
 * @file service.ts
 * @description Linux systemd service manager for DNS Worker Serverfull mode.
 * Enables running as a persistent daemon with CAP_NET_BIND_SERVICE for ports 53/853.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { formatBanner, formatDiagnostic } from './format';

export const SERVICE_NAME = 'dns-worker';
export const SERVICE_FILE_NAME = `${SERVICE_NAME}.service`;
export const SYSTEMD_SERVICE_PATH = `/etc/systemd/system/${SERVICE_FILE_NAME}`;

/**
 * Execution details resolved for generating systemd service file.
 */
export interface ServiceExecDetails {
  execCmd: string;
  workDir: string;
  user: string;
}

/**
 * Resolves appropriate binary execution path, working directory, and user for systemd.
 *
 * @returns Service execution parameters.
 */
export function getServiceExecDetails(): ServiceExecDetails {
  const nodePath = process.execPath;
  const scriptPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
  const user = process.env.SUDO_USER || process.env.USER || 'root';
  const homeDir = process.env.SUDO_USER
    ? `/home/${process.env.SUDO_USER}`
    : (process.env.HOME || '/root');

  let execCmd = '';
  if (scriptPath && fs.existsSync(scriptPath)) {
    execCmd = `${nodePath} ${scriptPath}`;
  } else {
    execCmd = 'dns-worker';
  }

  return { execCmd, workDir: homeDir, user };
}

/**
 * Generates the systemd unit file content with CAP_NET_BIND_SERVICE capabilities.
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
 * Handles 'dns-worker service <action>' subcommands.
 *
 * @param action - Action verb: 'install' | 'uninstall' | 'start' | 'stop' | 'restart' | 'status' | 'logs'
 */
export async function handleServiceAction(action: string): Promise<void> {
  const isLinux = process.platform === 'linux';

  if (!isLinux) {
    const details = getServiceExecDetails();
    const unitContent = generateSystemdUnit(details);

    console.log(formatDiagnostic({
      level: 'info',
      title: 'Linux Service Manager',
      message: 'systemd service management is only supported on Linux environments.',
      details: [
        'A systemd service unit template is provided below for reference:'
      ]
    }));
    console.log('------------------------------------------------------');
    console.log(unitContent);
    console.log('------------------------------------------------------');
    return;
  }

  const isRoot = typeof process.getuid === 'function' ? process.getuid() === 0 : false;

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

        console.log('\n' + banner + '\n');
        console.log('Useful service management commands:');
        console.log('  dns-worker service status    # Check live status');
        console.log('  dns-worker service logs      # Tail live syslog / journal logs');
        console.log('  sudo dns-worker service restart # Restart service');
        console.log('  sudo dns-worker service stop    # Stop service');
        console.log('  sudo dns-worker service uninstall # Remove service\n');
      } catch (err: any) {
        console.error(formatDiagnostic({
          level: 'error',
          title: 'Service Installation Failed',
          message: err.message || String(err),
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
        console.log(`\n[Success] DNS Worker systemd service removed from ${SYSTEMD_SERVICE_PATH}.\n`);
      } catch (err: any) {
        console.error(formatDiagnostic({
          level: 'error',
          title: 'Service Uninstall Failed',
          message: err.message || String(err)
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
        console.log(`[Success] Executed: systemctl ${action} ${SERVICE_NAME}`);
      } catch (err: any) {
        console.error(formatDiagnostic({
          level: 'error',
          title: `Service ${action} Failed`,
          message: err.message || String(err)
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
      } catch (err: any) {
        console.error('[Service Logs] journalctl exited:', err.message || err);
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
