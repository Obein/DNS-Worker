/**
 * @file test_serverfull.ts
 * @description Comprehensive test for Serverfull mode:
 * - SQLite initialization and migrations
 * - Classic UDP DNS resolution (port 15353)
 * - DoT resolution with TLS self-signed certificate and SNI routing (port 18853)
 * - HTTP Web UI and API request handling (port 13300)
 */

import fs from 'node:fs';
import path from 'node:path';
import dgram from 'node:dgram';
import tls from 'node:tls';
import https from 'node:https';
import http2 from 'node:http2';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { initNodeGlobals } from '../src/serverfull/cache';
import { initServerfullDb } from '../src/serverfull/db';
import { UdpDnsServer } from '../src/serverfull/udp';
import { DotDnsServer } from '../src/serverfull/dot';
import { HttpServer, HttpsServer } from '../src/serverfull/http';
import { buildDNSQuery, parseDNSAnswer } from '../src/utils/dns';
import { ListBloomModel } from '../src/models/listBloom';
import { ProfileBloomModel } from '../src/models/profileBloom';
import { BloomFilter } from '../src/utils/bloom';
import { Env } from '../src/types';

async function runTests() {
  console.log('>>> [TEST] Starting Serverfull Integration Tests...');

  // 1. Initialize globals
  initNodeGlobals();

  // 2. Prepare test directory
  const testDir = path.join(process.cwd(), 'temp_test_data');
  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
  fs.mkdirSync(testDir, { recursive: true });

  const testDbPath = path.join(testDir, 'test_dns_worker.sqlite');

  // 3. Test SQLite D1 & Migrations
  console.log('>>> [TEST] Testing SQLite D1 & Migrations...');
  const db = initServerfullDb(testDbPath);

  // Insert a test user and profile
  const now = Math.floor(Date.now() / 1000);
  await db.prepare('INSERT INTO users (id, username, hashed_password, role, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind('user1', 'admin', 'dummy_hash', 'admin', now).run();

  const profileSettings = JSON.stringify({
    upstream: ['https://security.cloudflare-dns.com/dns-query'],
    default_policy: 'ALLOW',
    log_retention_days: 7,
    ecs: { enabled: true, use_client_ip: true }
  });

  await db.prepare('INSERT INTO profiles (id, name, settings, owner_id, profile_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind('prof1', 'Default Profile', profileSettings, 'user1', 'testkey123', now, now).run();

  // Add a custom block rule for 'ad.test.com'
  await db.prepare('INSERT INTO rules (profile_id, type, pattern, record_type) VALUES (?, ?, ?, ?)')
    .bind('prof1', 'BLOCK', 'ad.test.com', 'A').run();

  // Verify ListBloomModel & ProfileBloomModel with binary BLOB chunks in SQLite D1
  console.log('>>> [TEST] Testing ListBloomModel & ProfileBloomModel BLOB bindings...');
  const listBloomModel = new ListBloomModel(db as any);
  const profileBloomModel = new ProfileBloomModel(db as any);

  // 1. Create a dummy list entry
  const listRes = await db.prepare('INSERT INTO lists (profile_id, url, enabled) VALUES (?, ?, ?)')
    .bind('prof1', 'https://test-list.local/domains.txt', 1).run();
  const listId = Number(listRes.meta.last_row_id);

  // 2. Build a test BloomFilter and save it via ListBloomModel (which binds ArrayBuffer as parameter 3)
  const testBloom = BloomFilter.create(1000, 0.001);
  testBloom.add('blocked-by-filter.example');
  const bloomBuf = testBloom.toUint8Array().buffer as ArrayBuffer;

  const upsertSuccess = await listBloomModel.upsertListBloom(listId, bloomBuf, now);
  assert.strictEqual(upsertSuccess, true, 'upsertListBloom must succeed with ArrayBuffer chunk data');

  const loadedBloomBuf = await listBloomModel.getListBloom(listId);
  assert.ok(loadedBloomBuf !== null, 'getListBloom must retrieve the saved bloom filter');
  const restoredBloom = BloomFilter.fromUint8Array(new Uint8Array(loadedBloomBuf!));
  assert.strictEqual(restoredBloom.test('blocked-by-filter.example'), true, 'Restored bloom filter must contain added domain');
  assert.strictEqual(restoredBloom.test('allowed.example'), false, 'Restored bloom filter must not contain unadded domain');

  // 3. Test ProfileBloom staging and atomic promotion (which tests parameter re-binding)
  const stagingSuccess = await profileBloomModel.upsertStagingBloom('prof1', bloomBuf, now);
  assert.strictEqual(stagingSuccess, true, 'upsertStagingBloom must succeed with ArrayBuffer');

  const promoteSuccess = await profileBloomModel.promoteStagingToActive('prof1', now);
  assert.strictEqual(promoteSuccess, true, 'promoteStagingToActive must succeed');

  const activeProfileBloom = await profileBloomModel.getProfileBloom('prof1');
  assert.ok(activeProfileBloom !== null, 'getProfileBloom must retrieve promoted bloom filter');
  assert.strictEqual(activeProfileBloom instanceof ArrayBuffer, true, 'getProfileBloom must return an ArrayBuffer for D1 parity');
  const restoredProfileBloom = BloomFilter.fromUint8Array(new Uint8Array(activeProfileBloom!));
  assert.strictEqual(restoredProfileBloom.test('blocked-by-filter.example'), true);
  console.log('>>> [TEST] SUCCESS: BLOB binding and Bloom Filter operations verified on SQLite D1!');

  console.log('>>> [TEST] Database seeded successfully.');

  // 4. Generate self-signed TLS certificates for DoT testing
  console.log('>>> [TEST] Generating self-signed TLS cert for DoT...');
  const tlsKeyPath = path.join(testDir, 'dot_test_key.pem');
  const tlsCertPath = path.join(testDir, 'dot_test_cert.pem');

  const fixtureKeyPath = path.join(__dirname, 'fixtures', 'tls', 'test_key.pem');
  const fixtureCertPath = path.join(__dirname, 'fixtures', 'tls', 'test_cert.pem');

  if (fs.existsSync(fixtureKeyPath) && fs.existsSync(fixtureCertPath)) {
    fs.copyFileSync(fixtureKeyPath, tlsKeyPath);
    fs.copyFileSync(fixtureCertPath, tlsCertPath);
  } else {
    let opensslBin = 'openssl';
    if (process.platform === 'win32') {
      const gitOpenssl = 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe';
      if (fs.existsSync(gitOpenssl)) {
        opensslBin = `"${gitOpenssl}"`;
      }
    }

    // Use openssl to generate self-signed wildcard cert (*.dns.local)
    execSync(`${opensslBin} req -x509 -newkey rsa:2048 -nodes -sha256 -keyout "${tlsKeyPath}" -out "${tlsCertPath}" -days 1 -subj "/CN=*.dns.local" -addext "subjectAltName=DNS:*.dns.local,DNS:dns.local"`, {
      stdio: 'ignore'
    });
  }

  const env: Env = {
    DB: db,
    ASSETS: null as any,
    JWT_SECRET: 'test_jwt_secret_serverfull_suite_000000',
    FAIL_OPEN_UPSTREAM: 'https://security.cloudflare-dns.com/dns-query',
    SERVERFULL_DEFAULT_PROFILE_KEY: 'testkey123',
    SERVERFULL_DOT_DOMAIN: 'dns.local'
  };

  // Ports for testing
  const UDP_TEST_PORT = 15353;
  const DOT_TEST_PORT = 18853;
  const HTTP_TEST_PORT = 23300;
  const HTTPS_TEST_PORT = 24443;

  // 5. Start UDP Server
  const udpServer = new UdpDnsServer({
    port: UDP_TEST_PORT,
    host: '127.0.0.1',
    defaultProfileKey: 'testkey123',
    env
  });
  await udpServer.start();

  // 6. Start DoT Server
  const dotServer = new DotDnsServer({
    port: DOT_TEST_PORT,
    host: '127.0.0.1',
    tlsKeyPath,
    tlsCertPath,
    dotDomain: 'dns.local',
    defaultProfileKey: 'testkey123',
    env
  });
  await dotServer.start();

  // 7. Start HTTP Server (port 23300)
  const httpServer = new HttpServer({
    port: HTTP_TEST_PORT,
    host: '127.0.0.1',
    env
  });
  await httpServer.start();

  // 8. Start HTTPS Server (port 24443)
  const httpsServer = new HttpsServer({
    port: HTTPS_TEST_PORT,
    host: '127.0.0.1',
    certPath: tlsCertPath,
    keyPath: tlsKeyPath,
    env
  });
  await httpsServer.start();

  // ── TEST A: UDP DNS Query (Internal verification domain 'obex TXT') ──
  console.log('\n>>> [TEST A] Testing UDP DNS Resolution (obex TXT)...');
  const clientSocket = dgram.createSocket('udp4');
  const queryPacket = buildDNSQuery('obex', 'TXT');

  const udpPromise = new Promise<Buffer>((resolve, reject) => {
    clientSocket.on('message', (msg) => resolve(msg));
    clientSocket.on('error', reject);
    clientSocket.send(queryPacket, UDP_TEST_PORT, '127.0.0.1');
  });

  const udpRes = await udpPromise;
  clientSocket.close();
  const udpAnswers = parseDNSAnswer(new Uint8Array(udpRes));
  console.log('>>> [TEST A] UDP Answers received:', udpAnswers);
  if (udpAnswers.length === 0 || !udpAnswers[0].data.includes('prof1')) {
    throw new Error(`Expected UDP TXT response containing 'prof1', got: ${JSON.stringify(udpAnswers)}`);
  }
  console.log('>>> [TEST A] SUCCESS: Classic UDP DNS with configured defaultProfileKey works!');

  // ── TEST A2: Unauthenticated UDP DNS Query (Fallback to FAIL_OPEN_UPSTREAM) ──
  console.log('\n>>> [TEST A2] Testing Unauthenticated UDP DNS (Fallback to FAIL_OPEN_UPSTREAM)...');
  const UDP_UNAUTH_PORT = 15354;
  const unauthEnv: Env = {
    ...env,
    SERVERFULL_DEFAULT_PROFILE_KEY: undefined
  };
  const unauthUdpServer = new UdpDnsServer({
    port: UDP_UNAUTH_PORT,
    host: '127.0.0.1',
    defaultProfileKey: undefined,
    env: unauthEnv
  });
  await unauthUdpServer.start();

  const unauthSocket = dgram.createSocket('udp4');
  const unauthQueryPacket = buildDNSQuery('obex', 'TXT');
  const unauthPromise = new Promise<Buffer>((resolve, reject) => {
    unauthSocket.on('message', (msg) => resolve(msg));
    unauthSocket.on('error', reject);
    unauthSocket.send(unauthQueryPacket, UDP_UNAUTH_PORT, '127.0.0.1');
  });

  const unauthRes = await unauthPromise;
  unauthSocket.close();
  await unauthUdpServer.stop();

  const unauthAnswers = parseDNSAnswer(new Uint8Array(unauthRes));
  console.log('>>> [TEST A2] Unauthenticated UDP Answers received:', unauthAnswers);
  if (unauthAnswers.length === 0 || !unauthAnswers[0].data.includes('default')) {
    throw new Error(`Expected UDP TXT response containing 'default', got: ${JSON.stringify(unauthAnswers)}`);
  }
  if (unauthAnswers[0].data.includes('prof1')) {
    throw new Error(`CRITICAL: Unauthenticated UDP request hijacked user profile 'prof1'!`);
  }
  console.log('>>> [TEST A2] SUCCESS: Unauthenticated UDP DNS safely falls back to FAIL_OPEN_UPSTREAM without hijacking user profile!');

  // ── TEST B: DoT Query over TLS with SNI Profile Routing (Blocked Domain) ──
  console.log('\n>>> [TEST B] Testing DoT over TLS with SNI: testkey123.dns.local (Blocked domain: ad.test.com A)...');
  const dotQueryPacket = buildDNSQuery('ad.test.com', 'A');
  const dotFrame = Buffer.allocUnsafe(2 + dotQueryPacket.length);
  dotFrame.writeUInt16BE(dotQueryPacket.length, 0);
  dotFrame.set(dotQueryPacket, 2);

  const dotPromise = new Promise<Buffer>((resolve, reject) => {
    const tlsSocket = tls.connect({
      host: '127.0.0.1',
      port: DOT_TEST_PORT,
      servername: 'testkey123.dns.local', // SNI routing to 'testkey123'
      ca: fs.readFileSync(tlsCertPath),
      rejectUnauthorized: true
    }, () => {
      tlsSocket.write(dotFrame);
    });

    let dotBuffer = Buffer.alloc(0);
    tlsSocket.on('data', (chunk) => {
      dotBuffer = Buffer.concat([dotBuffer, chunk]);
      if (dotBuffer.length >= 2) {
        const len = dotBuffer.readUInt16BE(0);
        if (dotBuffer.length >= 2 + len) {
          resolve(dotBuffer.subarray(2, 2 + len));
          tlsSocket.end();
        }
      }
    });

    tlsSocket.on('error', reject);
  });

  const dotRes = await dotPromise;
  const dotAnswers = parseDNSAnswer(new Uint8Array(dotRes));
  console.log('>>> [TEST B] DoT Blocked Answers received:', dotAnswers);
  // Default block response is 0.0.0.0
  if (dotAnswers.length === 0 || dotAnswers[0].data !== '0.0.0.0') {
    throw new Error(`Expected 0.0.0.0 for blocked ad.test.com, got: ${JSON.stringify(dotAnswers)}`);
  }
  console.log('>>> [TEST B] SUCCESS: DoT with SNI Profile Routing works!');

  // ── TEST C: HTTP Web UI / ClientInfo API ──
  console.log('\n>>> [TEST C] Testing HTTP Server (/api/clientinfo)...');
  const httpRes = await fetch(`http://127.0.0.1:${HTTP_TEST_PORT}/api/clientinfo`);
  console.log('>>> [TEST C] HTTP status:', httpRes.status);
  const clientInfoJson = await httpRes.json() as Record<string, any>;
  console.log('>>> [TEST C] ClientInfo response:', clientInfoJson);
  if (httpRes.status !== 200) {
    throw new Error(`Expected HTTP 200 from /api/clientinfo, got ${httpRes.status}`);
  }
  if (clientInfoJson.dotDomain !== 'dns.local') {
    throw new Error(`Expected clientInfo.dotDomain to be 'dns.local', got ${clientInfoJson.dotDomain}`);
  }
  if (clientInfoJson.country !== 'Private Network' || clientInfoJson.countryCode !== 'LAN') {
    throw new Error(`Expected Private Network location for 127.0.0.1, got: ${JSON.stringify(clientInfoJson)}`);
  }

  // Verify reverse proxy IP pass-through (Caddy / Nginx)
  const proxyXffRes = await fetch(`http://127.0.0.1:${HTTP_TEST_PORT}/api/clientinfo`, {
    headers: { 'X-Forwarded-For': '203.0.113.195, 127.0.0.1' }
  });
  const proxyXffJson = await proxyXffRes.json() as Record<string, any>;
  if (proxyXffJson.ip !== '203.0.113.195') {
    throw new Error(`Expected client IP 203.0.113.195 from X-Forwarded-For, got ${proxyXffJson.ip}`);
  }

  const proxyRealIpRes = await fetch(`http://127.0.0.1:${HTTP_TEST_PORT}/api/clientinfo`, {
    headers: { 'X-Real-IP': '198.51.100.22' }
  });
  const proxyRealIpJson = await proxyRealIpRes.json() as Record<string, any>;
  if (proxyRealIpJson.ip !== '198.51.100.22') {
    throw new Error(`Expected client IP 198.51.100.22 from X-Real-IP, got ${proxyRealIpJson.ip}`);
  }

  // Verify public IP GeoIP resolution through reverse proxy
  const proxyPublicRes = await fetch(`http://127.0.0.1:${HTTP_TEST_PORT}/api/clientinfo`, {
    headers: { 'X-Real-IP': '1.1.1.1' }
  });
  const proxyPublicJson = await proxyPublicRes.json() as Record<string, any>;
  if (proxyPublicJson.ip !== '1.1.1.1') {
    throw new Error(`Expected client IP 1.1.1.1 from X-Real-IP, got ${proxyPublicJson.ip}`);
  }
  if (!proxyPublicJson.country || proxyPublicJson.country === 'UNKNOWN') {
    console.warn(`[TEST C] Note: External GeoIP provider (ipwho.is) unreachable on current network environment.`);
  }

  console.log('>>> [TEST C] SUCCESS: HTTP Server, Reverse Proxy Client IP & GeoIP resolution works!');

  // ── TEST D: HTTPS Web UI / ClientInfo API ──
  console.log('\n>>> [TEST D] Testing HTTPS Server (/api/clientinfo)...');
  const httpsRes = await new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = https.get(
      `https://127.0.0.1:${HTTPS_TEST_PORT}/api/clientinfo`,
      {
        servername: 'dns.local',
        ca: fs.readFileSync(tlsCertPath),
        rejectUnauthorized: true
      },
      (res) => {
        let data = '';
        res.on('data', (c) => data += c);
        res.on('end', () => resolve({ status: res.statusCode || 0, body: data }));
      }
    );
    req.on('error', reject);
  });
  console.log('>>> [TEST D] HTTPS status:', httpsRes.status);
  const httpsClientInfo = JSON.parse(httpsRes.body) as Record<string, any>;
  if (httpsRes.status !== 200) {
    throw new Error(`Expected HTTPS 200 from /api/clientinfo, got ${httpsRes.status}`);
  }
  if (httpsClientInfo.dotDomain !== 'dns.local') {
    throw new Error(`Expected HTTPS clientInfo.dotDomain to be 'dns.local', got ${httpsClientInfo.dotDomain}`);
  }

  // Verify native HTTP/2 negotiation over HTTPS
  console.log('>>> [TEST D] Testing native HTTP/2 connection to HTTPS server...');
  const h2Session = http2.connect(`https://127.0.0.1:${HTTPS_TEST_PORT}`, {
    ca: fs.readFileSync(tlsCertPath),
    servername: 'dns.local',
    rejectUnauthorized: true
  });
  const h2Res = await new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = h2Session.request({ ':path': '/api/clientinfo' });
    let status = 0;
    let data = '';
    req.on('response', (headers) => {
      status = Number(headers[':status']) || 0;
    });
    req.on('data', (c) => data += c);
    req.on('end', () => resolve({ status, body: data }));
    req.on('error', reject);
    req.end();
  });
  h2Session.close();
  if (h2Res.status !== 200) {
    throw new Error(`Expected HTTP/2 200 from /api/clientinfo, got ${h2Res.status}`);
  }
  console.log('>>> [TEST D] SUCCESS: Native HTTP/2 connection succeeded!');

  // Verify RFC 8484 §5.2 minimum HTTP version enforcement: HTTP/1.1 to /dns-query returns 505
  console.log('>>> [TEST D] Testing RFC 8484 §5.2 rejection (HTTP/1.1 to /dns-query returns 505)...');
  const h1DohRes = await new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = https.get(
      `https://127.0.0.1:${HTTPS_TEST_PORT}/dns-query?dns=AAABAAABAAAAAAAAA3d3dwdleGFtcGxlA2NvbQAAAQAB`,
      {
        servername: 'dns.local',
        ca: fs.readFileSync(tlsCertPath),
        rejectUnauthorized: true,
        headers: {
          'Accept': 'application/dns-message'
        }
      },
      (res) => {
        let data = '';
        res.on('data', (c) => data += c);
        res.on('end', () => resolve({ status: res.statusCode || 0, body: data }));
      }
    );
    req.on('error', reject);
  });
  if (h1DohRes.status !== 505) {
    throw new Error(`Expected 505 HTTP Version Not Supported for HTTP/1.1 DoH request, got ${h1DohRes.status}`);
  }
  if (!h1DohRes.body.includes('RFC 8484')) {
    throw new Error(`Expected RFC 8484 explanation in 505 response, got ${h1DohRes.body}`);
  }
  console.log('>>> [TEST D] SUCCESS: RFC 8484 §5.2 strictly enforces HTTP/2 minimum (HTTP 505 on HTTP/1.1)!');

  // ── TEST D2: Public System Endpoints (/api/resolve & /api/geoip) ──
  console.log('\n>>> [TEST D2] Testing Public /api/resolve and /api/geoip APIs...');
  const resolveIpRes = await fetch(`http://127.0.0.1:${HTTP_TEST_PORT}/api/resolve?name=1.1.1.1`);
  if (resolveIpRes.status !== 200) {
    throw new Error(`Expected HTTP 200 from /api/resolve, got ${resolveIpRes.status}`);
  }
  const resolveIpJson = await resolveIpRes.json() as { ipv4: string[]; ipv6: string[] };
  if (!resolveIpJson.ipv4.includes('1.1.1.1')) {
    throw new Error(`Expected /api/resolve to recognize 1.1.1.1, got: ${JSON.stringify(resolveIpJson)}`);
  }

  const geoipLocalRes = await fetch(`http://127.0.0.1:${HTTP_TEST_PORT}/api/geoip?ip=127.0.0.1`);
  if (geoipLocalRes.status !== 200) {
    throw new Error(`Expected HTTP 200 from /api/geoip, got ${geoipLocalRes.status}`);
  }
  const geoipLocalJson = await geoipLocalRes.json() as { success: boolean; country: string };
  if (!geoipLocalJson.success || geoipLocalJson.country !== 'Private Network') {
    throw new Error(`Expected private network geoip for 127.0.0.1, got: ${JSON.stringify(geoipLocalJson)}`);
  }
  console.log('>>> [TEST D2] SUCCESS: /api/resolve and /api/geoip public endpoints verified!');
  console.log('\n>>> [TEST E] Testing Auth Refresh & RTR Grace Window on HTTP...');
  const { createSession } = await import('../src/lib/auth');
  const { refreshToken } = await createSession(env, 'user1', '127.0.0.1', 'Serverfull-Test-Agent', 0.0, 0.0, false);

  // 1. Initial refresh via HTTP
  const refreshRes1 = await fetch(`http://127.0.0.1:${HTTP_TEST_PORT}/api/auth/refresh`, {
    method: 'POST',
    headers: {
      'Cookie': `auth_refresh=${refreshToken}`
    }
  });

  console.log('>>> [TEST E] HTTP refresh status:', refreshRes1.status);
  if (refreshRes1.status !== 200) {
    const errorBody = await refreshRes1.text();
    throw new Error(`Expected HTTP 200 from /api/auth/refresh, got ${refreshRes1.status}: ${errorBody}`);
  }

  const refreshJson1 = await refreshRes1.json() as Record<string, any>;
  if (!refreshJson1.accessToken) {
    throw new Error(`Expected accessToken in refresh response, got: ${JSON.stringify(refreshJson1)}`);
  }

  // Verify Set-Cookie header is adapted for plain HTTP (no '; Secure')
  const rawSetCookie = refreshRes1.headers.get('set-cookie') || '';
  if (rawSetCookie.includes('Secure')) {
    throw new Error(`Plain HTTP response should NOT contain 'Secure' in Set-Cookie: ${rawSetCookie}`);
  }
  console.log('>>> [TEST E] SUCCESS: HTTP Refresh returns 200 and adapts cookies without Secure flag!');

  // 2. Test RTR Concurrency Grace Window: Replay the same token immediately (simulating concurrent tab/component refresh)
  console.log('>>> [TEST E] Testing RTR Concurrency Grace Window (simulating in-flight parallel refresh)...');
  const refreshRes2 = await fetch(`http://127.0.0.1:${HTTP_TEST_PORT}/api/auth/refresh`, {
    method: 'POST',
    headers: {
      'Cookie': `auth_refresh=${refreshToken}`
    }
  });

  console.log('>>> [TEST E] Parallel refresh status:', refreshRes2.status);
  if (refreshRes2.status !== 200) {
    const errorBody = await refreshRes2.text();
    throw new Error(`Expected HTTP 200 within RTR grace period, got ${refreshRes2.status}: ${errorBody}`);
  }
  console.log('>>> [TEST E] SUCCESS: RTR Concurrency Grace Window prevented 401 session invalidation!');

  // ── Cleanup ──
  console.log('\n>>> [CLEANUP] Stopping servers...');
  await udpServer.stop();
  await dotServer.stop();
  await httpServer.stop();
  await httpsServer.stop();
  const { flushLogBatch } = await import('../src/pipeline/logBatcher');
  try { await flushLogBatch(env); } catch {}
  db.rawDb.close();
  fs.rmSync(testDir, { recursive: true, force: true });

  console.log('\n======================================================');
  console.log('      ALL SERVERFULL INTEGRATION TESTS PASSED!        ');
  console.log('======================================================');
  process.exit(0);
}

runTests().catch((err) => {
  console.error('\n[FATAL TEST FAILURE]:', err);
  process.exit(1);
});
