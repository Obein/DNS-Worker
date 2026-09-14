#!/usr/bin/env node
/**
 * @file create-linux-service.ts
 * @description Generates and installs a systemd service for DNS Worker (Serverfull Mode) on Linux systems.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Support both ESM and CJS path resolution
const currentDir = typeof __dirname !== 'undefined'
  ? __dirname
  : path.dirname(fileURLToPath(import.meta.url));

const PROJECT_DIR = path.resolve(currentDir, '..');
const SERVICE_NAME = 'dns-worker.service';
const SERVICE_PATH = `/etc/systemd/system/${SERVICE_NAME}`;

/**
 * Discovers the appropriate tsx executable path within the project.
 *
 * @returns Executable path or command string for tsx
 */
function findTsxCli(): string {
  const localTsxMjs = path.join(PROJECT_DIR, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  if (fs.existsSync(localTsxMjs)) {
    return localTsxMjs;
  }
  const localTsxBin = path.join(PROJECT_DIR, 'node_modules', '.bin', 'tsx');
  if (fs.existsSync(localTsxBin)) {
    return localTsxBin;
  }
  return 'npx tsx';
}

/**
 * Generates the systemd unit file content with proper paths, capabilities, and security hardening.
 *
 * @returns Complete systemd unit file string
 */
function generateServiceContent(): string {
  const nodePath = process.execPath;
  const tsxCli = findTsxCli();

  let execStart = '';
  if (tsxCli.endsWith('.mjs') || tsxCli.endsWith('.js')) {
    execStart = `${nodePath} ${tsxCli} src/serverfull/index.ts`;
  } else {
    execStart = `${tsxCli} src/serverfull/index.ts`;
  }

  const envServerfullPath = path.join(PROJECT_DIR, '.env.serverfull');
  const envPath = path.join(PROJECT_DIR, '.env');
  const devVarsPath = path.join(PROJECT_DIR, '.dev.vars');

  return `[Unit]
Description=DNS Worker Serverfull Service (UDP DNS, DoT & Web)
After=network.target

[Service]
Type=simple
WorkingDirectory=${PROJECT_DIR}
ExecStart=${execStart}
Restart=always
RestartSec=5
EnvironmentFile=-${envServerfullPath}
EnvironmentFile=-${envPath}
EnvironmentFile=-${devVarsPath}
LimitNOFILE=65535

# Grant capability to bind ports 53 and 853 without full root privileges
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE

# Security Hardening
StandardOutput=journal
StandardError=journal
SyslogIdentifier=dns-worker

[Install]
WantedBy=multi-user.target
`;
}

/**
 * Main entry point for generating and installing the Linux systemd service.
 */
function main(): void {
  console.log('======================================================');
  console.log('       DNS Worker - Linux Systemd Service Setup       ');
  console.log('======================================================\n');

  const content = generateServiceContent();
  const isLinux = process.platform === 'linux';

  console.log(`Target Service File: ${SERVICE_PATH}`);
  console.log(`Working Directory:   ${PROJECT_DIR}\n`);

  if (!isLinux) {
    console.log('[Notice] Current OS is not Linux. Displaying generated systemd service template below:\n');
    console.log('------------------------------------------------------');
    console.log(content);
    console.log('------------------------------------------------------');
    console.log('\nTo use this on a Linux server, save the content to /etc/systemd/system/dns-worker.service');
    return;
  }

  try {
    fs.writeFileSync(SERVICE_PATH, content, 'utf-8');
    console.log(`[Success] Written service file to ${SERVICE_PATH}`);

    try {
      execSync('systemctl daemon-reload');
      console.log('[Success] Executed: systemctl daemon-reload');
      execSync(`systemctl enable ${SERVICE_NAME}`);
      console.log(`[Success] Enabled service: ${SERVICE_NAME}`);

      console.log('\nService installed successfully! Useful commands:');
      console.log(`  sudo systemctl start ${SERVICE_NAME}     # Start the service`);
      console.log(`  sudo systemctl status ${SERVICE_NAME}    # Check service status`);
      console.log(`  sudo systemctl restart ${SERVICE_NAME}   # Restart the service`);
      console.log(`  sudo journalctl -u ${SERVICE_NAME} -f    # Follow live logs`);
    } catch (cmdErr) {
      console.warn('[Warning] Failed to run systemctl commands directly. You may need sudo:');
      console.log(`  sudo systemctl daemon-reload`);
      console.log(`  sudo systemctl enable ${SERVICE_NAME}`);
      console.log(`  sudo systemctl start ${SERVICE_NAME}`);
    }
  } catch (writeErr) {
    console.error(`[Error] Permission denied writing to ${SERVICE_PATH}`);
    console.log('Please run this command with sudo:');
    console.log('  sudo npm run service-create:linux\n');
    console.log('Or manually create the file with this content:\n');
    console.log('------------------------------------------------------');
    console.log(content);
    console.log('------------------------------------------------------');
  }
}

main();
