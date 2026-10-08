/**
 * @file test_serverfull_service.ts
 * @description Unit tests for modular background service management providers (SRP).
 */

import {
  isWindowsAdmin,
  isLinuxRoot,
  getServiceExecDetails
} from '../src/serverfull/service/env';
import {
  SERVICE_NAME,
  SERVICE_FILE_NAME,
  SYSTEMD_SERVICE_PATH,
  generateSystemdUnit
} from '../src/serverfull/service/systemd';
import {
  WINDOWS_TASK_NAME,
  WINDOWS_DATA_DIR,
  WINDOWS_LOG_FILE,
  WINDOWS_BAT_FILE,
  generateWindowsBat
} from '../src/serverfull/service/schtasks';
import {
  getDefaultDataDir,
  getDefaultDbPath
} from '../src/serverfull/config';

function runServiceUnitTests(): void {
  console.log('>>> [TEST] Starting Modular Service Provider Unit Tests (SRP)...');

  // 1. Test Environment and Privilege Utilities
  console.log('1. Testing isWindowsAdmin and isLinuxRoot...');
  const winAdmin = isWindowsAdmin();
  if (typeof winAdmin !== 'boolean') {
    throw new Error('isWindowsAdmin must return a boolean');
  }

  const linuxRoot = isLinuxRoot();
  if (typeof linuxRoot !== 'boolean') {
    throw new Error('isLinuxRoot must return a boolean');
  }
  console.log(`   ✓ Privilege checks passed (winAdmin=${winAdmin}, linuxRoot=${linuxRoot}).`);

  // 2. Test Execution Details Resolution
  console.log('2. Testing getServiceExecDetails resolution...');
  const details = getServiceExecDetails();
  if (!details.nodePath || !details.user || !details.workDir || !details.execCmd) {
    throw new Error(`getServiceExecDetails missing fields: ${JSON.stringify(details)}`);
  }
  if (!details.execCmd.includes('node') && !details.execCmd.includes('dns-worker')) {
    throw new Error(`Unexpected execCmd format: ${details.execCmd}`);
  }
  console.log('   ✓ getServiceExecDetails passed.');

  // 3. Test Linux systemd Unit Generator
  console.log('3. Testing generateSystemdUnit...');
  const dummyDetails = {
    execCmd: '/usr/bin/node /opt/dns-worker/index.mjs',
    nodePath: '/usr/bin/node',
    scriptPath: '/opt/dns-worker/index.mjs',
    workDir: '/opt/dns-worker',
    user: 'dnsadmin'
  };
  const unit = generateSystemdUnit(dummyDetails);

  if (!unit.includes('StateDirectory=dns-worker')) {
    throw new Error('generateSystemdUnit missing StateDirectory=dns-worker');
  }
  if (!unit.includes('AmbientCapabilities=CAP_NET_BIND_SERVICE')) {
    throw new Error('generateSystemdUnit missing CAP_NET_BIND_SERVICE');
  }
  if (!unit.includes('User=dnsadmin') || !unit.includes('WorkingDirectory=/opt/dns-worker')) {
    throw new Error('generateSystemdUnit missing user or workDir binding');
  }
  if (!unit.includes('ExecStart=/usr/bin/node /opt/dns-worker/index.mjs')) {
    throw new Error('generateSystemdUnit missing ExecStart command');
  }
  if (SERVICE_NAME !== 'dns-worker' || SYSTEMD_SERVICE_PATH !== '/etc/systemd/system/dns-worker.service') {
    throw new Error('systemd service constants mismatch');
  }
  console.log('   ✓ generateSystemdUnit and constants passed.');

  // 4. Test Windows Task Scheduler Batch Script Generator
  console.log('4. Testing generateWindowsBat...');
  const winDetails = {
    execCmd: '"C:\\Program Files\\nodejs\\node.exe" "C:\\dns-worker\\index.mjs"',
    nodePath: 'C:\\Program Files\\nodejs\\node.exe',
    scriptPath: 'C:\\dns-worker\\index.mjs',
    workDir: 'C:\\dns-worker',
    user: 'Administrator'
  };
  const bat = generateWindowsBat(winDetails);

  if (!bat.includes('@echo off') || !bat.includes('cd /d "C:\\dns-worker"')) {
    throw new Error('generateWindowsBat missing @echo off or cd command');
  }
  if (!bat.includes(WINDOWS_LOG_FILE)) {
    throw new Error('generateWindowsBat missing log output redirection');
  }
  if (WINDOWS_TASK_NAME !== 'DNS-Worker') {
    throw new Error('WINDOWS_TASK_NAME mismatch');
  }
  console.log('   ✓ generateWindowsBat and constants passed.');

  // 5. Test Persistent Storage Path Resolvers
  console.log('5. Testing getDefaultDataDir and getDefaultDbPath...');
  const dataDir = getDefaultDataDir();
  const dbPath = getDefaultDbPath();
  if (!dataDir || typeof dataDir !== 'string') {
    throw new Error('getDefaultDataDir must return non-empty string');
  }
  if (!dbPath || !dbPath.endsWith('dns_worker.sqlite')) {
    throw new Error(`getDefaultDbPath must end with dns_worker.sqlite, got: ${dbPath}`);
  }
  if (process.platform === 'win32' && !dataDir.includes('ProgramData')) {
    throw new Error(`On Windows, dataDir should contain ProgramData, got: ${dataDir}`);
  }
  console.log(`   ✓ Persistent path resolution passed (DataDir=${dataDir}, DbPath=${dbPath}).`);

  console.log('\n======================================================');
  console.log('   ALL SERVICE PROVIDER UNIT TESTS PASSED!            ');
  console.log('======================================================');
}

runServiceUnitTests();
