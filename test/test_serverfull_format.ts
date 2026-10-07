/**
 * @file test_serverfull_format.ts
 * @description Unit tests for declarative CLI formatters in Serverfull mode.
 */

import {
  formatHelpMenu,
  formatBanner,
  formatKeyValueSection,
  formatDiagnostic,
  formatPortError
} from '../src/serverfull/format';
import { inspectDatabase } from '../src/serverfull/status';

function runUnitTests(): void {
  console.log('>>> [TEST] Starting Serverfull Declarative Formatting Unit Tests...');

  // 1. Test formatHelpMenu
  console.log('1. Testing formatHelpMenu dynamic alignment...');
  const helpOutput = formatHelpMenu({
    name: 'dns-worker v1.1.1',
    description: 'Privacy-first DNS & DoH Resolver',
    usage: 'dns-worker [options]',
    commands: [
      { label: 'status', desc: 'Inspect service runtime status and database health' }
    ],
    options: [
      { label: '-s, --status', desc: 'Show status' },
      { label: '-p, --port <number>', desc: 'HTTP port (default: 3000)' },
      { label: '--help', desc: 'Show this help message' }
    ],
    tip: "Run 'dns-worker status' to inspect active runtime status."
  });

  if (!helpOutput.includes('dns-worker v1.1.1 - Privacy-first DNS & DoH Resolver')) {
    throw new Error('formatHelpMenu failed header check');
  }
  if (!helpOutput.includes('Commands:') || !helpOutput.includes('Options:') || !helpOutput.includes('Tip:')) {
    throw new Error('formatHelpMenu missing sections');
  }
  console.log('   ✓ formatHelpMenu passed.');

  // 2. Test formatKeyValueSection
  console.log('2. Testing formatKeyValueSection dynamic column alignment...');
  const kvOutput = formatKeyValueSection({
    title: '[Services] Configured Ports:',
    items: [
      { label: 'Short', value: '123' },
      { label: 'Much Longer Label', value: '456' }
    ]
  });

  if (!kvOutput.includes('[Services] Configured Ports:')) {
    throw new Error('formatKeyValueSection title missing');
  }
  // Verify that the shorter label is padded to match the longer label
  const lines = kvOutput.split('\n');
  const shortLine = lines.find(l => l.includes('Short'))!;
  const colonIndexShort = shortLine.indexOf(':');
  const longLine = lines.find(l => l.includes('Much Longer Label'))!;
  const colonIndexLong = longLine.indexOf(':');
  if (colonIndexShort !== colonIndexLong) {
    throw new Error(`Column alignment mismatch in formatKeyValueSection: short=${colonIndexShort}, long=${colonIndexLong}`);
  }
  console.log('   ✓ formatKeyValueSection aligned properly.');

  // 3. Test formatBanner
  console.log('3. Testing formatBanner border and item formatting...');
  const banner = formatBanner({
    title: 'DNS Worker Started Successfully',
    borderChar: '=',
    bullet: '• ',
    items: [
      { label: 'Service A', value: 'Running' },
      { label: 'Extended Service B', value: 'Disabled' }
    ]
  });

  if (!banner.includes('===') || !banner.includes('DNS Worker Started Successfully')) {
    throw new Error('formatBanner header or border missing');
  }
  if (!banner.includes('Service A') || !banner.includes('Extended Service B')) {
    throw new Error('formatBanner items missing');
  }
  console.log('   ✓ formatBanner passed.');

  // 4. Test formatDiagnostic
  console.log('4. Testing formatDiagnostic structured output...');
  const diagnostic = formatDiagnostic({
    level: 'error',
    title: 'Port Conflict',
    message: 'Port 53 is already occupied.',
    causes: [
      'systemd-resolved is active'
    ],
    solutions: [
      'Stop systemd-resolved',
      'Or change port with --dns-port 5353'
    ]
  });

  if (!diagnostic.includes('[Port Conflict] Port 53 is already occupied.')) {
    throw new Error('formatDiagnostic header missing');
  }
  if (!diagnostic.includes('Possible causes:') || !diagnostic.includes('- systemd-resolved is active')) {
    throw new Error('formatDiagnostic causes missing');
  }
  if (!diagnostic.includes('Solutions:') || !diagnostic.includes('- Stop systemd-resolved')) {
    throw new Error('formatDiagnostic solutions missing');
  }
  console.log('   ✓ formatDiagnostic passed.');

  // 5. Test formatPortError for EADDRINUSE and EACCES
  console.log('5. Testing formatPortError handling...');
  const addrInUseUdp = formatPortError({
    serviceName: 'UDP DNS',
    protocol: 'UDP',
    port: 53,
    err: { code: 'EADDRINUSE' },
    alternateOption: '--dns-port 5353',
    disableOption: '--disable-udp'
  });
  if (!addrInUseUdp.includes('[Port Conflict] UDP DNS port 53 is already in use.') || !addrInUseUdp.includes('systemd-resolved')) {
    throw new Error('formatPortError EADDRINUSE UDP failed');
  }

  const accesHttp = formatPortError({
    serviceName: 'Web UI',
    protocol: 'HTTP',
    port: 80,
    err: { code: 'EACCES' },
    alternateOption: '--port 3000'
  });
  if (!accesHttp.includes('[Permission Denied] Permission denied binding to Web UI port 80.')) {
    throw new Error('formatPortError EACCES failed');
  }

  const genericErr = formatPortError({
    serviceName: 'Test Service',
    protocol: 'TCP',
    port: 1234,
    err: new Error('Unknown socket failure'),
    alternateOption: '--port 5678'
  });
  if (!genericErr.includes('Unknown socket failure')) {
    throw new Error('formatPortError generic error fallback failed');
  }
  console.log('   ✓ formatPortError passed.');

  // 6. Test inspectDatabase
  console.log('6. Testing inspectDatabase...');
  const nonExistentDb = inspectDatabase('./non_existent_file.sqlite');
  if (nonExistentDb.exists !== false || !nonExistentDb.statusText.includes('Not Initialized')) {
    throw new Error('inspectDatabase failed for non-existent database');
  }
  console.log('   ✓ inspectDatabase passed.');

  console.log('\n======================================================');
  console.log('   ALL FORMATTING UNIT TESTS PASSED SUCCESSFULLY!    ');
  console.log('======================================================');
}

runUnitTests();
