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
import { execSync } from 'node:child_process';
import { initNodeGlobals } from '../src/serverfull/cache';
import { initServerfullDb } from '../src/serverfull/db';
import { UdpDnsServer } from '../src/serverfull/udp';
import { DotDnsServer } from '../src/serverfull/dot';
import { HttpServer, HttpsServer } from '../src/serverfull/http';
import { buildDNSQuery, parseDNSAnswer } from '../src/utils/dns';
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

  console.log('>>> [TEST] Database seeded successfully.');

  // 4. Generate self-signed TLS certificates for DoT testing
  console.log('>>> [TEST] Generating self-signed TLS cert for DoT...');
  const tlsKeyPath = path.join(testDir, 'dot_test_key.pem');
  const tlsCertPath = path.join(testDir, 'dot_test_cert.pem');

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
  console.log('>>> [TEST A] SUCCESS: Classic UDP DNS works!');

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
  console.log('>>> [TEST C] SUCCESS: HTTP Server & ClientInfo with dotDomain works!');

  // ── TEST D: HTTPS Web UI / ClientInfo API ──
  console.log('\n>>> [TEST D] Testing HTTPS Server (/api/clientinfo)...');
  const httpsRes = await new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = https.get(`https://127.0.0.1:${HTTPS_TEST_PORT}/api/clientinfo`, { rejectUnauthorized: false }, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => resolve({ status: res.statusCode || 0, body: data }));
    });
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
  // ── TEST E: HTTP Auth Refresh & Multi-Cookie Handling ──
  console.log('\n>>> [TEST E] Testing Auth Refresh & RTR Grace Window on HTTP...');
  const { createSession } = await import('../src/lib/auth');
  const { session, refreshToken } = await createSession(env, 'user1', '127.0.0.1', 'Serverfull-Test-Agent', 0.0, 0.0, false);

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
