/**
 * @file test_ech_serverfull_dot_domain.ts
 * @description Validates ECH behavior for SERVERFULL_DOT_DOMAIN, DDR queries, and Cloudflare IP domains.
 * Ensures no unintended `ech=` parameters are synthesized when ECH rewrite is off or when no custom ECH is configured.
 */

import assert from "node:assert";
import { processBestEffortEch } from "../src/pipeline/resolver/ech";
import { buildDNSQuery, parseDNSAnswer } from "../src/utils/dns";
import { Context, DNSQuery, ProfileSettings } from "../src/types";
import { updateActiveCfProxyCidrs } from "../src/utils/ech";

async function runTests() {
  console.log("-------------------------------------------------------------------");
  console.log("Testing processBestEffortEch for SERVERFULL_DOT_DOMAIN & ECH Rewrite");
  console.log("-------------------------------------------------------------------");

  // Pre-seed Cloudflare CIDRs to prevent outbound HTTP fetches in test
  updateActiveCfProxyCidrs(["104.16.0.0/13", "172.64.0.0/13"]);

  const serverDomain = "user.example.com";
  const dummyRequest = new Request("https://example.com/dns-query");

  // Mock probe resolver that returns 1.2.3.4 (VPS non-Cloudflare IP) for user.example.com
  // and 104.16.1.1 (Cloudflare IP) for cf.example.com
  const mockProbeResolver = async (
    _req: Request,
    query: DNSQuery
  ): Promise<any> => {
    if (query.name === "cf.example.com") {
      const { buildResponse } = await import("../src/utils/dns");
      return {
        answer: buildResponse(query.raw, "A", "104.16.1.1", 300, 0),
        latency: 5
      };
    }
    const { buildResponse } = await import("../src/utils/dns");
    return {
      answer: buildResponse(query.raw, "A", "1.2.3.4", 300, 0),
      latency: 5
    };
  };

  // Mock DB with preloaded CIDRs
  const mockDb = {
    prepare: (sql: string) => ({
      bind: (...args: any[]) => ({
        first: async () => {
          if (args[0] === "cf_proxy_cidrs") {
            return { value: JSON.stringify(["104.16.0.0/13", "172.64.0.0/13"]) };
          }
          if (args[0] === "cf_active_ech_config") {
            return { value: "AEX+CF_ACTIVE_ECH==" };
          }
          return null;
        },
        run: async () => ({ meta: {} }),
        all: async () => ({ results: [] })
      }),
      first: async () => null,
      run: async () => ({ meta: {} }),
      all: async () => ({ results: [] })
    })
  } as any;

  const createTestContext = (envProps: Record<string, any>): Context => ({
    env: envProps as any,
    profileId: "test-profile",
    startTime: Date.now(),
    ctx: { waitUntil: () => {}, passThroughOnException: () => {} } as any
  });

  const createTestSettings = (echEnabled: boolean): ProfileSettings => ({
    upstream: ["https://1.1.1.1/dns-query"],
    default_policy: "ALLOW",
    log_retention_days: 7,
    ecs: { enabled: true, use_client_ip: true },
    best_effort_ech: { enabled: echEnabled }
  });

  // ---------------------------------------------------------------------------
  // Test 1: SERVERFULL_DOT_DOMAIN with ECH Rewrite OFF (default profile settings)
  // Expected: NO ech= synthesized.
  // ---------------------------------------------------------------------------
  console.log("1. Testing SERVERFULL_DOT_DOMAIN with ECH Rewrite OFF (default)...");
  {
    const queryRaw = buildDNSQuery(serverDomain, "HTTPS");
    const query: DNSQuery = { name: serverDomain, type: "HTTPS", raw: queryRaw };
    const context = createTestContext({
      SERVERFULL_DOT_DOMAIN: serverDomain,
      DB: mockDb
    });
    const settings = createTestSettings(false);

    const initialAnswer = new Uint8Array([0, 0]); // Empty upstream answer
    const initialParsedAnswers = parseDNSAnswer(initialAnswer);

    const res = await processBestEffortEch(
      query,
      initialParsedAnswers,
      initialAnswer,
      context,
      settings,
      dummyRequest,
      mockProbeResolver,
      "Pass"
    );

    const dataStr = res.parsedAnswers.map(a => a.data).join(" ");
    assert.ok(!dataStr.includes("ech="), `Must not contain ech= when ECH Rewrite is OFF. Actual: ${dataStr}`);
    assert.strictEqual(res.answer, initialAnswer, "Must return initialAnswer untouched when ECH Rewrite is OFF");
    console.log("   ✓ Verified: No ech= synthesized when ECH Rewrite is OFF.");
  }

  // ---------------------------------------------------------------------------
  // Test 2: SERVERFULL_ECH_ENABLED=false (env flag set to false)
  // Expected: NO ech= synthesized even if profile has best_effort_ech: true.
  // ---------------------------------------------------------------------------
  console.log("2. Testing SERVERFULL_ECH_ENABLED=false (server-level disable)...");
  {
    const queryRaw = buildDNSQuery(serverDomain, "HTTPS");
    const query: DNSQuery = { name: serverDomain, type: "HTTPS", raw: queryRaw };
    const context = createTestContext({
      SERVERFULL_DOT_DOMAIN: serverDomain,
      SERVERFULL_ECH_ENABLED: "false",
      DB: mockDb
    });
    const settings = createTestSettings(true);

    const initialAnswer = new Uint8Array([0, 0]);
    const initialParsedAnswers = parseDNSAnswer(initialAnswer);

    const res = await processBestEffortEch(
      query,
      initialParsedAnswers,
      initialAnswer,
      context,
      settings,
      dummyRequest,
      mockProbeResolver,
      "Pass"
    );

    const dataStr = res.parsedAnswers.map(a => a.data).join(" ");
    assert.ok(!dataStr.includes("ech="), `Must not contain ech= when SERVERFULL_ECH_ENABLED=false. Actual: ${dataStr}`);
    assert.strictEqual(res.answer, initialAnswer, "Must return initialAnswer untouched when SERVERFULL_ECH_ENABLED=false");
    console.log("   ✓ Verified: SERVERFULL_ECH_ENABLED=false strictly respected.");
  }

  // ---------------------------------------------------------------------------
  // Test 3: SERVERFULL_DOT_DOMAIN with ECH Rewrite ON, but server is VPS IP (isCf = false)
  // and no custom SERVERFULL_ECH_CONFIG
  // Expected: MUST NOT inject fake Cloudflare ECH into self-hosted server domain!
  // ---------------------------------------------------------------------------
  console.log("3. Testing SERVERFULL_DOT_DOMAIN on non-CF VPS with ECH Rewrite ON (no custom ECH)...");
  {
    const queryRaw = buildDNSQuery(serverDomain, "HTTPS");
    const query: DNSQuery = { name: serverDomain, type: "HTTPS", raw: queryRaw };
    const context = createTestContext({
      SERVERFULL_DOT_DOMAIN: serverDomain,
      SERVERFULL_ECH_ENABLED: "true",
      DB: mockDb
    });
    const settings = createTestSettings(true);

    const initialAnswer = new Uint8Array([0, 0]);
    const initialParsedAnswers = parseDNSAnswer(initialAnswer);

    const res = await processBestEffortEch(
      query,
      initialParsedAnswers,
      initialAnswer,
      context,
      settings,
      dummyRequest,
      mockProbeResolver,
      "Pass"
    );

    const dataStr = res.parsedAnswers.map(a => a.data).join(" ");
    assert.ok(!dataStr.includes("ech="), `Must NOT inject fake Cloudflare ech= for self-hosted VPS domain. Actual: ${dataStr}`);
    assert.strictEqual(res.answer, initialAnswer, "Must return initialAnswer when VPS domain has no custom ECH and is not CF");
    console.log("   ✓ Verified: Fake Cloudflare ECH is NOT injected for self-hosted domain.");
  }

  // ---------------------------------------------------------------------------
  // Test 4: SERVERFULL_DOT_DOMAIN with ECH Rewrite ON AND custom SERVERFULL_ECH_CONFIG provided
  // Expected: Synthesizes HTTPS record with custom ech=
  // ---------------------------------------------------------------------------
  console.log("4. Testing SERVERFULL_DOT_DOMAIN with custom SERVERFULL_ECH_CONFIG...");
  {
    const customEch = Buffer.from(new Uint8Array([0xfe, 0x0d, 0x00, 0x10, 0x01, 0x02, 0x03, 0x04])).toString("base64");
    const queryRaw = buildDNSQuery(serverDomain, "HTTPS");
    const query: DNSQuery = { name: serverDomain, type: "HTTPS", raw: queryRaw };
    const context = createTestContext({
      SERVERFULL_DOT_DOMAIN: serverDomain,
      SERVERFULL_ECH_ENABLED: "true",
      SERVERFULL_ECH_CONFIG: customEch,
      SERVERFULL_HTTPS_PORT: 443,
      DB: mockDb
    });
    const settings = createTestSettings(true);

    const initialAnswer = new Uint8Array([0, 0]);
    const initialParsedAnswers = parseDNSAnswer(initialAnswer);

    const res = await processBestEffortEch(
      query,
      initialParsedAnswers,
      initialAnswer,
      context,
      settings,
      dummyRequest,
      mockProbeResolver,
      "Pass"
    );

    const dataStr = res.parsedAnswers.map(a => a.data).join(" ");
    assert.ok(dataStr.includes(`ech=${customEch}`), `Must contain custom ech=. Actual: ${dataStr}`);
    assert.ok(dataStr.includes("alpn=h3,h2"), "Must advertise h3,h2 ALPN");
    assert.strictEqual(res.effectiveReason, "Server HTTPS (H3/ECH)");
    console.log("   ✓ Verified: Custom SERVERFULL_ECH_CONFIG properly synthesized.");
  }

  // ---------------------------------------------------------------------------
  // Test 5: DDR query (_dns.user.example.com) with ECH OFF
  // Expected: Advertises DoT/DoQ port WITHOUT ech=
  // ---------------------------------------------------------------------------
  console.log("5. Testing DDR query (_dns.user.example.com) with ECH OFF...");
  {
    const ddrDomain = `_dns.${serverDomain}`;
    const queryRaw = buildDNSQuery(ddrDomain, "SVCB");
    const query: DNSQuery = { name: ddrDomain, type: "SVCB", raw: queryRaw };
    const context = createTestContext({
      SERVERFULL_DOT_DOMAIN: serverDomain,
      SERVERFULL_DOT_PORT: 853,
      DB: mockDb
    });
    const settings = createTestSettings(false);

    const initialAnswer = new Uint8Array([0, 0]);
    const initialParsedAnswers = parseDNSAnswer(initialAnswer);

    const res = await processBestEffortEch(
      query,
      initialParsedAnswers,
      initialAnswer,
      context,
      settings,
      dummyRequest,
      mockProbeResolver,
      "Pass"
    );

    const dataStr = res.parsedAnswers.map(a => a.data).join(" ");
    assert.ok(dataStr.includes("alpn=doq,dot port=853"), `Must advertise doq,dot port 853. Actual: ${dataStr}`);
    assert.ok(!dataStr.includes("ech="), `Must not contain ech= when ECH is OFF. Actual: ${dataStr}`);
    assert.strictEqual(res.effectiveReason, "DDR SVCB (DoQ/DoT)");
    console.log("   ✓ Verified: DDR advertises DoT/DoQ without ech= when ECH is OFF.");
  }

  // ---------------------------------------------------------------------------
  // Test 6: Cloudflare-fronted domain (cf.example.com) with ECH Rewrite ON
  // Expected: Synthesizes valid Cloudflare ECH rewrite
  // ---------------------------------------------------------------------------
  console.log("6. Testing Cloudflare-fronted domain with ECH Rewrite ON...");
  {
    const cfDomain = "cf.example.com";
    const queryRaw = buildDNSQuery(cfDomain, "HTTPS");
    const query: DNSQuery = { name: cfDomain, type: "HTTPS", raw: queryRaw };
    const context = createTestContext({
      SERVERFULL_DOT_DOMAIN: serverDomain,
      DB: mockDb
    });
    const settings = createTestSettings(true);

    const initialAnswer = new Uint8Array([0, 0]);
    const initialParsedAnswers = parseDNSAnswer(initialAnswer);

    const res = await processBestEffortEch(
      query,
      initialParsedAnswers,
      initialAnswer,
      context,
      settings,
      dummyRequest,
      mockProbeResolver,
      "Pass"
    );

    const dataStr = res.parsedAnswers.map(a => a.data).join(" ");
    assert.ok(dataStr.includes("ech="), `Must contain ech= for Cloudflare-fronted domain. Actual: ${dataStr}`);
    assert.strictEqual(res.effectiveReason, "ECH Rewritten");
    console.log("   ✓ Verified: Cloudflare-fronted domain successfully gets ECH rewritten.");
  }

  console.log("\nAll 6 ECH tests passed successfully!");
}

runTests().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
