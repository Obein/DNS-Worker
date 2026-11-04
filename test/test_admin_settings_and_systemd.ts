import assert from 'node:assert';
import { generateSystemdUnit } from '../src/serverfull/service/systemd';
import { handleAdminRequest } from '../src/api/account/admin';
import { SystemSettingsModel } from '../src/models/systemSettings';

async function runTests(): Promise<void> {
  console.log('>>> [TEST] Starting Admin Settings Allowlist & Systemd Defensive Unit Tests...');

  // 1. Test generateSystemdUnit with username validation
  console.log('1. Testing generateSystemdUnit username validation...');
  {
    const validDetails = {
      execCmd: '/usr/bin/node /opt/dns-worker/index.mjs',
      nodePath: '/usr/bin/node',
      scriptPath: '/opt/dns-worker/index.mjs',
      workDir: '/opt/dns-worker',
      user: 'dnsadmin_01'
    };
    const validUnit = generateSystemdUnit(validDetails);
    assert(validUnit.includes('User=dnsadmin_01'), 'Valid username must be accepted');

    const maliciousDetails = {
      execCmd: '/usr/bin/node /opt/dns-worker/index.mjs',
      nodePath: '/usr/bin/node',
      scriptPath: '/opt/dns-worker/index.mjs',
      workDir: '/opt/dns-worker',
      user: 'malicious; rm -rf /\nInjectedDirective=true'
    };
    const sanitizedUnit = generateSystemdUnit(maliciousDetails);
    assert(!sanitizedUnit.includes('malicious;'), 'Malicious characters must not be present in systemd unit');
    assert(sanitizedUnit.includes('User=root'), 'Invalid username must safely fallback to root');
    console.log('   ✓ generateSystemdUnit username sanitization passed.');
  }

  // 2. Test PATCH /api/admin/settings allowlist enforcement
  console.log('2. Testing PATCH /api/admin/settings allowlist and length bounding...');
  {
    const store = new Map<string, string>();
    const mockDb: any = {
      prepare(sql: string) {
        const createStmt = (args: any[] = []) => ({
          async all() {
            if (sql.includes('SELECT key, value FROM system_settings')) {
              const results = Array.from(store.entries()).map(([k, v]) => ({ key: k, value: v }));
              return { results };
            }
            return { results: [] };
          },
          async first() {
            return null;
          },
          async run() {
            if (sql.includes('INSERT INTO system_settings') || sql.includes('INSERT OR REPLACE INTO system_settings')) {
              store.set(args[0], String(args[1]));
            }
            return { success: true };
          }
        });
        return {
          ...createStmt(),
          bind(...args: any[]) {
            return createStmt(args);
          }
        };
      },
      async batch(statements: any[]) {
        for (const s of statements) {
          await s.run();
        }
        return statements.map(() => ({ success: true }));
      }
    };

    const dummyUser: any = { id: 'admin1', username: 'admin', role: 'admin' };
    const mockEnv: any = { DB: mockDb };
    const dummyCtx: any = { waitUntil: () => {} };

    // A. PATCH with valid keys and malicious injected keys
    const patchPayload = {
      turnstile_site_key: '0x4AAAAAAAValidSiteKey',
      turnstile_enabled_signup: 'true',
      registration_enabled: 'false',
      jwt_secret: 'stolen_or_overwritten_secret',
      cron_last_cleanup_timestamp: '9999999999',
      arbitrary_injected_setting: 'malicious_value'
    };

    const req = new Request('http://localhost/api/admin/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patchPayload)
    });

    const res = await handleAdminRequest(req, mockEnv, dummyUser, ['', 'admin', 'settings'], dummyCtx);
    assert.strictEqual(res.status, 200, 'PATCH must return 200 OK');

    const settingsModel = new SystemSettingsModel(mockDb);
    const saved = await settingsModel.getAll();

    // Verify allowed keys were saved
    assert.strictEqual(saved.turnstile_site_key, '0x4AAAAAAAValidSiteKey', 'Allowed site key must be saved');
    assert.strictEqual(saved.turnstile_enabled_signup, 'true', 'Allowed switch must be saved');
    assert.strictEqual(saved.registration_enabled, 'false', 'Allowed registration toggle must be saved');

    // Verify forbidden/internal keys were strictly rejected
    assert.strictEqual(saved.jwt_secret, undefined, 'jwt_secret must NEVER be saved or overwritten');
    assert.strictEqual(saved.cron_last_cleanup_timestamp, undefined, 'Internal timestamp must not be overwritten');
    assert.strictEqual(saved.arbitrary_injected_setting, undefined, 'Arbitrary keys must not be persisted');

    console.log('   ✓ PATCH /api/admin/settings allowlist enforcement passed.');
  }

  console.log('\n======================================================');
  console.log('   ALL DEFENSIVE HARDENING TESTS PASSED!              ');
  console.log('======================================================\n');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
