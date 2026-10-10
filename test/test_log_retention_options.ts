/**
 * @file test_log_retention_options.ts
 * @description Unit tests for dynamic log retention tier calculation & reverse proxy client IP resolution.
 */

import assert from 'node:assert';
import { extractClientIp, sanitizeClientIp } from '../src/serverfull/http';

function runRetentionOptionsLogic(maxRetentionDays: number) {
  const effectiveMax = maxRetentionDays > 0 ? maxRetentionDays : 30;
  const maxSuffix = '(Maximum)';

  const baseTiers = [
    { label: 'Disabled', value: 0 },
    { label: '10 Minutes', value: 0.007 },
    { label: '1 Hour', value: 0.0416 },
    { label: '24 Hours', value: 1 },
    { label: '7 Days', value: 7 },
    { label: '30 Days', value: 30 },
    { label: '90 Days', value: 90 },
    { label: '180 Days', value: 180 },
    { label: '360 Days', value: 360 },
  ];

  const filtered = baseTiers.filter((opt) => opt.value <= effectiveMax);

  if (effectiveMax > 0 && !filtered.some((opt) => opt.value === effectiveMax)) {
    filtered.push({
      label: `${effectiveMax} Days`,
      value: effectiveMax
    });
    filtered.sort((a, b) => a.value - b.value);
  }

  if (filtered.length === 0) return [baseTiers[0]];

  return filtered.map((opt) => {
    if (opt.value === effectiveMax && opt.value > 0) {
      return {
        ...opt,
        label: `${opt.label} ${maxSuffix}`
      };
    }
    return opt;
  });
}

async function runTests(): Promise<void> {
  console.log('>>> [TEST] Starting Log Retention Tiers & Reverse Proxy IP Tests...');

  // 1. Verify Log Retention Tiers when MAX_LOG_RETENTION_DAYS = 360
  console.log('>>> [TEST] 1. maxRetentionDays = 360');
  const tiers360 = runRetentionOptionsLogic(360);
  const opt90_360 = tiers360.find((o) => o.value === 90);
  const opt180_360 = tiers360.find((o) => o.value === 180);
  const opt360_360 = tiers360.find((o) => o.value === 360);

  assert.ok(opt90_360, 'Option 90 must be present');
  assert.strictEqual(opt90_360.label, '90 Days', 'Option 90 must NOT have (Maximum) suffix when max is 360');

  assert.ok(opt180_360, 'Option 180 must be present');
  assert.strictEqual(opt180_360.label, '180 Days');

  assert.ok(opt360_360, 'Option 360 must be present');
  assert.strictEqual(opt360_360.label, '360 Days (Maximum)', 'Option 360 must have (Maximum) suffix');

  // 2. Verify Log Retention Tiers when MAX_LOG_RETENTION_DAYS = 90
  console.log('>>> [TEST] 2. maxRetentionDays = 90');
  const tiers90 = runRetentionOptionsLogic(90);
  assert.strictEqual(tiers90.some((o) => o.value === 180), false, '180 must not be present when max is 90');
  assert.strictEqual(tiers90.some((o) => o.value === 360), false, '360 must not be present when max is 90');
  const opt90_90 = tiers90.find((o) => o.value === 90);
  assert.ok(opt90_90);
  assert.strictEqual(opt90_90.label, '90 Days (Maximum)', 'Option 90 must have (Maximum) when max is 90');

  // 3. Verify Log Retention Tiers when MAX_LOG_RETENTION_DAYS = 30
  console.log('>>> [TEST] 3. maxRetentionDays = 30');
  const tiers30 = runRetentionOptionsLogic(30);
  const opt30_30 = tiers30.find((o) => o.value === 30);
  assert.ok(opt30_30);
  assert.strictEqual(opt30_30.label, '30 Days (Maximum)');

  // 4. Verify Log Retention Tiers with Custom Max (e.g. 14 days)
  console.log('>>> [TEST] 4. maxRetentionDays = 14 (custom)');
  const tiers14 = runRetentionOptionsLogic(14);
  const opt14_14 = tiers14.find((o) => o.value === 14);
  assert.ok(opt14_14);
  assert.strictEqual(opt14_14.label, '14 Days (Maximum)');

  // 5. Test IP sanitization
  console.log('>>> [TEST] 5. sanitizeClientIp');
  assert.strictEqual(sanitizeClientIp('192.168.1.1'), '192.168.1.1');
  assert.strictEqual(sanitizeClientIp('  192.168.1.1  '), '192.168.1.1');
  assert.strictEqual(sanitizeClientIp('192.168.1.1:8080'), '192.168.1.1');
  assert.strictEqual(sanitizeClientIp('::ffff:192.168.1.1'), '192.168.1.1');
  assert.strictEqual(sanitizeClientIp('2001:db8::1'), '2001:db8::1');
  assert.strictEqual(sanitizeClientIp('[2001:db8::1]:443'), '2001:db8::1');
  assert.strictEqual(sanitizeClientIp('invalid-ip'), null);
  assert.strictEqual(sanitizeClientIp(''), null);
  assert.strictEqual(sanitizeClientIp(null), null);

  // 6. Test Reverse Proxy extractClientIp priority
  console.log('>>> [TEST] 6. extractClientIp with Caddy/Nginx headers');

  // Case A: Caddy default X-Forwarded-For with single IP
  const headersA = new Headers({ 'X-Forwarded-For': '203.0.113.195' });
  assert.strictEqual(extractClientIp(headersA, '127.0.0.1'), '203.0.113.195');

  // Case B: Caddy multi-hop X-Forwarded-For: client, proxy1, proxy2
  const headersB = new Headers({ 'X-Forwarded-For': '198.51.100.42, 10.0.0.1, 127.0.0.1' });
  assert.strictEqual(extractClientIp(headersB, '127.0.0.1'), '198.51.100.42');

  // Case C: X-Real-IP takes precedence over X-Forwarded-For if set
  const headersC = new Headers({
    'X-Real-IP': '203.0.113.88',
    'X-Forwarded-For': '198.51.100.42'
  });
  assert.strictEqual(extractClientIp(headersC, '127.0.0.1'), '203.0.113.88');

  // Case D: CF-Connecting-IP takes highest precedence
  const headersD = new Headers({
    'CF-Connecting-IP': '1.1.1.1',
    'X-Real-IP': '203.0.113.88',
    'X-Forwarded-For': '198.51.100.42'
  });
  assert.strictEqual(extractClientIp(headersD, '127.0.0.1'), '1.1.1.1');

  // Case E: Direct connection from public IP without proxy headers
  const headersE = new Headers();
  assert.strictEqual(extractClientIp(headersE, '93.184.216.34'), '93.184.216.34');

  // Case F: Direct connection from untrusted public IP attempting to spoof headers -> headers ignored!
  const headersF = new Headers({
    'CF-Connecting-IP': '1.1.1.1',
    'X-Real-IP': '8.8.8.8',
    'X-Forwarded-For': '9.9.9.9'
  });
  assert.strictEqual(extractClientIp(headersF, '93.184.216.34'), '93.184.216.34', 'Must ignore spoofed headers from untrusted public socket');

  // Case G: Direct connection with explicitly trusted proxy configured
  assert.strictEqual(extractClientIp(headersF, '93.184.216.34', '93.184.216.34'), '1.1.1.1', 'Must honor headers from explicitly trusted proxy');

  // 7. Test getFlagEmoji behavior (LAN, UN, UNKNOWN, Country Codes)
  console.log('>>> [TEST] 7. getFlagEmoji mapping');
  const { getFlagEmoji } = await import('../web/src/utils/getFlagEmoji');
  assert.strictEqual(getFlagEmoji('CN'), '🇨🇳', 'CN must produce China flag');
  assert.strictEqual(getFlagEmoji('US'), '🇺🇸', 'US must produce US flag');
  assert.strictEqual(getFlagEmoji('LAN'), '🏠', 'LAN must produce home emoji');
  assert.strictEqual(getFlagEmoji('LOCAL'), '🏠', 'LOCAL must produce home emoji');
  assert.strictEqual(getFlagEmoji('PRIVATE'), '🏠', 'PRIVATE must produce home emoji');
  assert.strictEqual(getFlagEmoji('UN'), '🌐', 'UN must produce globe emoji (not UN flag)');
  assert.strictEqual(getFlagEmoji('UNKNOWN'), '🌐', 'UNKNOWN must produce globe emoji');
  assert.strictEqual(getFlagEmoji('XX'), '🌐', 'XX must produce globe emoji');
  assert.strictEqual(getFlagEmoji(''), '🌐', 'Empty string must produce globe emoji');
  assert.strictEqual(getFlagEmoji(null), '🌐', 'Null must produce globe emoji');

  // 8. Test resolveClientGeoCountry behavior
  console.log('>>> [TEST] 8. resolveClientGeoCountry');
  const { resolveClientGeoCountry } = await import('../src/utils/geoip');
  const reqPrivate = new Request('http://localhost');
  const countryPrivate = await resolveClientGeoCountry(reqPrivate, '192.168.1.100');
  assert.strictEqual(countryPrivate, 'LAN', 'Private IP must resolve to LAN');

  const reqLoopback = new Request('http://localhost');
  const countryLoopback = await resolveClientGeoCountry(reqLoopback, '127.0.0.1');
  assert.strictEqual(countryLoopback, 'LAN', 'Loopback IP must resolve to LAN');

  const reqCf = new Request('http://localhost', {
    headers: { 'CF-IPCountry': 'JP' }
  });
  const countryCf = await resolveClientGeoCountry(reqCf, '1.1.1.1');
  assert.strictEqual(countryCf, 'JP', 'CF-IPCountry header must be respected when valid');

  console.log('>>> [TEST] All Log Retention, Client IP & GeoIP Tests Passed! ✔\n');
}

runTests().catch((err) => {
  console.error('Test Failed:', err);
  process.exit(1);
});
