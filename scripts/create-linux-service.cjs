#!/usr/bin/env node
/**
 * @file create-linux-service.cjs
 * @description Generates and installs systemd service for DNS Worker on Linux.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const PROJECT_DIR = path.resolve(__dirname, '..');
const SERVICE_NAME = 'dns-worker.service';
const SERVICE_PATH = `/etc/systemd/system/${SERVICE_NAME}`;

function findTsxCli() {
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

function generateServiceContent() {
  const nodePath = process.execPath;
  const tsxCli = findTsxCli();

  let execStart = '';
  if (tsxCli.endsWith('.mjs') || tsxCli.endsWith('.js')) {
    execStart = `${nodePath} ${tsxCli} src/serverfull/index.ts`;
  } else {
    execStart = `${tsxCli} src/serverfull/index.ts`;
  }

  return `[Unit]
Description=DNS Worker Serverfull Service (UDP DNS, DoT & Web)
After=network.target

[Service]
Type=simple
WorkingDirectory=${PROJECT_DIR}
ExecStart=${execStart}
Restart=always
RestartSec=5
EnvironmentFile=-${path.join(PROJECT_DIR, '.env')}
EnvironmentFile=-${path.join(PROJECT_DIR, '.dev.vars')}
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

function main() {
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
