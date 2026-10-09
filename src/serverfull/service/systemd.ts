/**
 * @file systemd.ts
 * @description Linux systemd background service management provider.
 * Configures systemd unit files with CAP_NET_BIND_SERVICE capabilities for unprivileged low-port binding.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { ServiceAction, ServiceExecDetails } from './types';
import { getServiceExecDetails, isLinuxRoot } from './env';
import {
  formatBanner,
  formatDiagnostic,
  formatCommandList
} from '../format';
import { writeDefaultConfigFile } from '../defaults';

export const SERVICE_NAME = 'dns-worker';
export const SERVICE_FILE_NAME = `${SERVICE_NAME}.service`;
export const SYSTEMD_SERVICE_PATH = `/etc/systemd/system/${SERVICE_FILE_NAME}`;

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

# Automatically provision and preserve /var/lib/dns-worker persistent state directory
StateDirectory=dns-worker

# Automatically provision and preserve /etc/dns-worker configuration directory
ConfigurationDirectory=dns-worker

# Load environment configuration file from /etc/dns-worker/.env
EnvironmentFile=-/etc/dns-worker/.env

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
 * @param targetUser - Optional user to run service as.
 */
export async function handleLinuxSystemd(action: ServiceAction | string, targetUser?: string): Promise<void> {
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

      const details = getServiceExecDetails(targetUser);
      const unitContent = generateSystemdUnit(details);

      try {
        // Ensure persistent state directory /var/lib/dns-worker (Persistent Data Dir)
        // and configuration directory /etc/dns-worker (Config Data Dir) exist with proper user ownership
        const dataDir = '/var/lib/dns-worker';
        const configDir = '/etc/dns-worker';
        const configFile = path.join(configDir, '.env');

        try {
          if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true, mode: 0o755 });
          }
          if (!fs.existsSync(configDir)) {
            fs.mkdirSync(configDir, { recursive: true, mode: 0o755 });
          }
          writeDefaultConfigFile(configFile, false);
          if (details.user && details.user !== 'root') {
            try {
              execSync(`chown -R ${details.user} ${dataDir}`);
            } catch {}
            try {
              execSync(`chown -R ${details.user} ${configDir}`);
            } catch {}
          }
        } catch {}

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
            { label: 'Persistent Data Dir', value: dataDir },
            { label: 'Config Directory', value: configDir },
            { label: 'Config File', value: configFile },
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
            { command: 'sudo dns-worker service enable', desc: 'Enable autostart on boot' },
            { command: 'sudo dns-worker service disable', desc: 'Disable autostart on boot' },
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
    case 'restart':
    case 'enable':
    case 'disable': {
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
          'Supported actions: install, start, stop, restart, enable, disable, status, logs, uninstall',
          'Example: sudo dns-worker service install'
        ]
      }));
      process.exit(1);
    }
  }
}
