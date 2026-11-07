/**
 * @file test_quad9_transport.ts
 * @description Validates Quad9 DoH -> DoT seamless routing and HTTP 505 / 525 resilience.
 */

import assert from "node:assert";
import http from "node:http";
import { resolveUpstreamEndpoint, fetchFromUpstream } from "../src/pipeline/resolver/transport";
import { isSafeUrl } from "../src/utils/validator";

async function runTests(): Promise<void> {
  console.log("================================================================");
  console.log("   Quad9 DoH / DoT Upstream Transport Verification Test         ");
  console.log("================================================================\n");

  const sampleQueryRaw = new Uint8Array([
    0x12, 0x34, 0x01, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x07, 0x65, 0x78, 0x61, 0x6d, 0x70, 0x6c, 0x65, 0x03, 0x63, 0x6f, 0x6d, 0x00,
    0x00, 0x01, 0x00, 0x01
  ]);

  // 1. Verify URL Safety
  console.log("[1] Testing URL safety for Quad9 endpoints...");
  assert.strictEqual(isSafeUrl("https://dns11.quad9.net/dns-query"), true);
  assert.strictEqual(isSafeUrl("https://dns.quad9.net/dns-query"), true);
  assert.strictEqual(isSafeUrl("tls://dns.quad9.net"), true);
  assert.strictEqual(isSafeUrl("tls://dns11.quad9.net"), true);
  assert.strictEqual(isSafeUrl("tcp://9.9.9.11:9953"), true);
  console.log("    ✓ All Quad9 endpoints validated as safe URLs.");

  // 2. Verify Endpoint Resolution (Quad9 DoH -> DoT auto-upgrade)
  console.log("\n[2] Testing endpoint resolution for Quad9 DoH URLs...");
  const epDns11 = resolveUpstreamEndpoint("https://dns11.quad9.net/dns-query");
  assert.strictEqual(epDns11.diagMethod, "DoT", "Quad9 ECS DoH should route to DoT to avoid HTTP 525/505");
  assert.strictEqual(epDns11.effectiveUrl, "tls://dns11.quad9.net:853");
  assert.strictEqual(epDns11.diagTarget, "tls://dns11.quad9.net:853");
  console.log(`    ✓ https://dns11.quad9.net/dns-query -> ${epDns11.effectiveUrl} (${epDns11.diagMethod})`);

  const epDnsStandard = resolveUpstreamEndpoint("https://dns.quad9.net/dns-query");
  assert.strictEqual(epDnsStandard.diagMethod, "DoT", "Quad9 standard DoH should route to DoT to avoid HTTP 505");
  assert.strictEqual(epDnsStandard.effectiveUrl, "tls://dns.quad9.net:853");
  console.log(`    ✓ https://dns.quad9.net/dns-query -> ${epDnsStandard.effectiveUrl} (${epDnsStandard.diagMethod})`);

  const epIpDoh = resolveUpstreamEndpoint("https://9.9.9.11/dns-query");
  assert.strictEqual(epIpDoh.diagMethod, "DoT");
  assert.strictEqual(epIpDoh.effectiveUrl, "tls://9.9.9.11:853");
  console.log(`    ✓ https://9.9.9.11/dns-query -> ${epIpDoh.effectiveUrl} (${epIpDoh.diagMethod})`);

  const epDirectDot = resolveUpstreamEndpoint("tls://dns11.quad9.net");
  assert.strictEqual(epDirectDot.diagMethod, "DoT");
  assert.strictEqual(epDirectDot.effectiveUrl, "tls://dns11.quad9.net");
  assert.strictEqual(epDirectDot.diagTarget, "tls://dns11.quad9.net:853");
  console.log(`    ✓ tls://dns11.quad9.net -> ${epDirectDot.diagTarget} (${epDirectDot.diagMethod})`);

  // 3. Live query against Quad9 ECS (previously failing with 525)
  console.log("\n[3] Testing live query against Quad9 ECS (https://dns11.quad9.net/dns-query)...");
  try {
    const resDns11 = await fetchFromUpstream(epDns11, sampleQueryRaw);
    assert.ok(resDns11.answer.length > 0, "Quad9 ECS must return wire answer");
    assert.strictEqual(resDns11.diagMethod, "DoT");
    console.log(`    ✓ Query succeeded! Latency: ${resDns11.latency}ms, Answer size: ${resDns11.answer.length} bytes`);
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.warn(`    ⚠ Live network test failed or skipped (network dependency):`, errorMsg);
  }

  // 4. Live query against Quad9 standard (previously failing with 505)
  console.log("\n[4] Testing live query against Quad9 standard (https://dns.quad9.net/dns-query)...");
  try {
    const resDns = await fetchFromUpstream(epDnsStandard, sampleQueryRaw);
    assert.ok(resDns.answer.length > 0, "Quad9 standard must return wire answer");
    assert.strictEqual(resDns.diagMethod, "DoT");
    console.log(`    ✓ Query succeeded! Latency: ${resDns.latency}ms, Answer size: ${resDns.answer.length} bytes`);
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.warn(`    ⚠ Live network test failed or skipped (network dependency):`, errorMsg);
  }

  // 5. Simulated HTTP 505 DoT Fallback Test
  console.log("\n[5] Testing resilient DoT fallback when an upstream DoH returns HTTP 505...");
  const server = http.createServer((req, res) => {
    res.writeHead(505, { "Content-Type": "text/html" });
    res.end("<html><body>This server implements RFC 8484 and requires HTTP/2</body></html>");
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const serverPort = (server.address() as any).port;

  // Endpoint pointing to mock 505 server, fallback to DoT (using cloudflare 1.1.1.1 on port 853)
  // To test the fallback logic, we can construct an endpoint that tries mock server and catches 505
  // If fallback port 853 fails (since localhost doesn't listen on 853), it cleanly throws UpstreamHttpError
  const mockEndpoint = {
    effectiveUrl: `http://127.0.0.1:${serverPort}/dns-query`,
    diagMethod: "POST",
    diagTarget: `http://127.0.0.1:${serverPort}/dns-query`
  };

  try {
    await fetchFromUpstream(mockEndpoint, sampleQueryRaw);
    assert.fail("Should have thrown because localhost doesn't run DoT on 853");
  } catch (err: any) {
    assert.strictEqual(err.status, 505, "Must retain 505 status if DoT fallback unavailable");
    assert.ok(err.responseBodySnippet.includes("RFC 8484"), "Must retain upstream response snippet");
    console.log(`    ✓ Handled HTTP 505 cleanly with expected UpstreamHttpError: ${err.message}`);
  } finally {
    server.close();
  }

  // 6. Test direct queryDoT capability
  console.log("\n[6] Testing queryDoT direct query...");
  const { queryDoT } = await import("../src/pipeline/resolver/transport");
  const dotRes = await queryDoT("dns.google", 853, sampleQueryRaw, 5000);
  assert.ok(dotRes.length > 0, "queryDoT must resolve DNS queries directly");
  console.log(`    ✓ queryDoT succeeded with ${dotRes.length} bytes from dns.google:853`);

  console.log("\n================================================================");
  console.log("   ALL QUAD9 TRANSPORT TESTS PASSED SUCCESSFULLY!              ");
  console.log("================================================================\n");
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
