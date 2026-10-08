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
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  getDefaultDataDir,
  getDefaultDbPath,
  getDefaultConfigFilePath,
  getOrInitPersistentJwtSecret,
  getLoadedEnvFiles
} from '../src/serverfull/config';
import {
  DEFAULT_PRESET_UPSTREAMS,
  DEFAULT_PRESET_EXTERNAL_FILTERS,
  DEFAULT_IP_REGION_CN,
  DEFAULT_SUBSTITUTE_DOMAIN,
  DEFAULT_FAIL_OPEN_UPSTREAM
} from '../src/constants/presets';
import {
  DEFAULT_ENV_SERVERFULL_TEMPLATE,
  writeDefaultConfigFile
} from '../src/serverfull/defaults';

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

  // 6. Test Canonical Built-in Presets
  console.log('6. Testing Canonical Built-in Presets...');
  if (!Array.isArray(DEFAULT_PRESET_UPSTREAMS) || DEFAULT_PRESET_UPSTREAMS.length === 0) {
    throw new Error('DEFAULT_PRESET_UPSTREAMS must be non-empty array');
  }
  if (!Array.isArray(DEFAULT_PRESET_EXTERNAL_FILTERS) || DEFAULT_PRESET_EXTERNAL_FILTERS.length === 0) {
    throw new Error('DEFAULT_PRESET_EXTERNAL_FILTERS must be non-empty array');
  }
  if (!Array.isArray(DEFAULT_IP_REGION_CN) || DEFAULT_IP_REGION_CN.length === 0) {
    throw new Error('DEFAULT_IP_REGION_CN must be non-empty array');
  }
  if (DEFAULT_SUBSTITUTE_DOMAIN !== 'www.okx.com' || !DEFAULT_FAIL_OPEN_UPSTREAM) {
    throw new Error('DEFAULT_SUBSTITUTE_DOMAIN or DEFAULT_FAIL_OPEN_UPSTREAM invalid');
  }
  console.log('   ✓ Built-in presets constants passed.');

  // 7. Test Persistent JWT Secret Initialization
  console.log('7. Testing getOrInitPersistentJwtSecret stability...');
  const tempTestDir = path.join(os.tmpdir(), `test_jwt_${Date.now()}`);
  try {
    fs.mkdirSync(tempTestDir, { recursive: true });
    // First call generates and persists secret
    const secret1 = getOrInitPersistentJwtSecret(tempTestDir);
    if (!secret1 || secret1.length < 32) {
      throw new Error(`Generated secret too short: ${secret1}`);
    }
    // Second call must return identical persisted secret
    const secret2 = getOrInitPersistentJwtSecret(tempTestDir);
    if (secret1 !== secret2) {
      throw new Error(`Persistent secret mismatch: ${secret1} vs ${secret2}`);
    }
    console.log('   ✓ getOrInitPersistentJwtSecret stability verified.');
  } finally {
    try { fs.rmSync(tempTestDir, { recursive: true, force: true }); } catch {}
  }

  // 8. Test Default Config File Seeding and Template
  console.log('8. Testing writeDefaultConfigFile and template...');
  const configPath = getDefaultConfigFilePath();
  if (!configPath.endsWith('.env')) {
    throw new Error(`getDefaultConfigFilePath must end with .env: ${configPath}`);
  }
  if (!DEFAULT_ENV_SERVERFULL_TEMPLATE.includes('SERVERFULL_HOST=0.0.0.0') ||
      !DEFAULT_ENV_SERVERFULL_TEMPLATE.includes('PRESET_UPSTREAMS=')) {
    throw new Error('DEFAULT_ENV_SERVERFULL_TEMPLATE missing required variables');
  }
  const tempConfigPath = path.join(os.tmpdir(), `test_config_${Date.now()}`, '.env');
  try {
    const res1 = writeDefaultConfigFile(tempConfigPath, false);
    if (!res1.created || !fs.existsSync(tempConfigPath)) {
      throw new Error('writeDefaultConfigFile failed to create config file');
    }
    const res2 = writeDefaultConfigFile(tempConfigPath, false);
    if (res2.created) {
      throw new Error('writeDefaultConfigFile should not overwrite without force=true');
    }
    console.log('   ✓ writeDefaultConfigFile template test passed.');
  } finally {
    try { fs.rmSync(path.dirname(tempConfigPath), { recursive: true, force: true }); } catch {}
  }

  console.log('\n======================================================');
  console.log('   ALL SERVICE PROVIDER UNIT TESTS PASSED!            ');
  console.log('======================================================');
}

runServiceUnitTests();
