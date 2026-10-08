/**
 * @file test_serverfull_port.ts
 * @description Unit tests for cross-platform port occupant resolution and formatting.
 */

import net from 'node:net';
import {
  getPortOccupant,
  formatOccupantSummary,
  PortOccupant
} from '../src/serverfull/port';
import { formatPortError } from '../src/serverfull/format';

async function runPortUnitTests(): Promise<void> {
  console.log('>>> [TEST] Starting Port Occupant & Conflict Resolution Unit Tests...');

  // 1. Test formatOccupantSummary
  console.log('1. Testing formatOccupantSummary...');
  const occupantA: PortOccupant = { processName: 'dnsmasq' };
  if (formatOccupantSummary(occupantA) !== 'dnsmasq') {
    throw new Error('formatOccupantSummary failed for processName only');
  }

  const occupantB: PortOccupant = { processName: 'named', pid: 1234 };
  if (formatOccupantSummary(occupantB) !== 'named (PID 1234)') {
    throw new Error('formatOccupantSummary failed for processName + pid');
  }

  const occupantC: PortOccupant = { processName: 'svchost.exe', pid: 3512, serviceName: 'SharedAccess' };
  if (formatOccupantSummary(occupantC) !== 'svchost.exe (PID 3512) [SharedAccess]') {
    throw new Error('formatOccupantSummary failed for serviceName');
  }
  console.log('   ✓ formatOccupantSummary passed.');

  // 2. Test live TCP Port Occupant Detection (Self-binding verification)
  console.log('2. Testing live getPortOccupant on active TCP socket...');
  const TEST_PORT = 29876;
  const server = net.createServer();

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(TEST_PORT, '127.0.0.1', () => resolve());
  });

  try {
    const liveOccupant = getPortOccupant(TEST_PORT, 'TCP');
    if (!liveOccupant) {
      throw new Error(`Expected getPortOccupant to detect listener on port ${TEST_PORT}, got null`);
    }

    if (liveOccupant.pid !== process.pid) {
      throw new Error(`Expected PID ${process.pid}, got ${liveOccupant.pid}`);
    }

    const summary = formatOccupantSummary(liveOccupant);
    if (!summary.toLowerCase().includes('node') || !summary.includes(String(process.pid))) {
      throw new Error(`Expected summary to mention node and PID, got: ${summary}`);
    }
    console.log(`   ✓ getPortOccupant live detection passed: ${summary}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  // 3. Test getPortOccupant on closed port
  console.log('3. Testing getPortOccupant on free port...');
  const freeOccupant = getPortOccupant(TEST_PORT, 'TCP');
  if (freeOccupant !== null) {
    throw new Error(`Expected null for closed port ${TEST_PORT}, got: ${JSON.stringify(freeOccupant)}`);
  }
  console.log('   ✓ getPortOccupant correctly returns null for unused port.');

  // 4. Test formatPortError with systemd-resolved occupant
  console.log('4. Testing formatPortError with systemd-resolved...');
  const systemdErr = formatPortError({
    serviceName: 'UDP DNS',
    protocol: 'UDP',
    port: 53,
    err: { code: 'EADDRINUSE' },
    alternateOption: '--dns-port 5353',
    occupant: { processName: 'systemd-resolved', pid: 762, serviceName: 'DNSStubListener' }
  });

  if (!systemdErr.includes('systemd-resolved') || !systemdErr.includes('DNSStubListener')) {
    throw new Error('formatPortError failed to include systemd-resolved occupant details');
  }
  if (!systemdErr.includes('DNSStubListener=no') || !systemdErr.includes('--dns-port 5353')) {
    throw new Error('formatPortError missing systemd-resolved solution');
  }
  console.log('   ✓ formatPortError systemd-resolved diagnosis passed.');

  // 5. Test formatPortError with Windows SharedAccess occupant
  console.log('5. Testing formatPortError with Windows SharedAccess...');
  const sharedAccessErr = formatPortError({
    serviceName: 'UDP DNS',
    protocol: 'UDP',
    port: 53,
    err: { code: 'EADDRINUSE' },
    alternateOption: '--dns-port 5353',
    occupant: { processName: 'svchost.exe', pid: 3512, serviceName: 'SharedAccess' }
  });

  if (!sharedAccessErr.includes('svchost.exe') || !sharedAccessErr.includes('SharedAccess')) {
    throw new Error('formatPortError failed to include SharedAccess occupant details');
  }
  if (!sharedAccessErr.includes('Internet Connection Sharing') || !sharedAccessErr.includes('Stop-Service SharedAccess')) {
    throw new Error('formatPortError missing Windows SharedAccess solution');
  }
  console.log('   ✓ formatPortError Windows SharedAccess diagnosis passed.');

  // 6. Test formatPortError with generic process occupant
  console.log('6. Testing formatPortError with generic process...');
  const genericErr = formatPortError({
    serviceName: 'Web Dashboard',
    protocol: 'HTTP',
    port: 3000,
    err: { code: 'EADDRINUSE' },
    alternateOption: '--port 3001',
    occupant: { processName: 'nginx', pid: 8888 }
  });

  if (!genericErr.includes('nginx (PID 8888)') || !genericErr.includes('Terminate conflicting process')) {
    throw new Error('formatPortError generic process failed');
  }
  console.log('   ✓ formatPortError generic process diagnosis passed.');

  console.log('\n======================================================');
  console.log('   ALL PORT OCCUPANT UNIT TESTS PASSED!              ');
  console.log('======================================================');
}

runPortUnitTests().catch((err) => {
  console.error('\n[TEST FAILURE]:', err);
  process.exit(1);
});
