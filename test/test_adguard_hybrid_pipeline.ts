import assert from "node:assert";
import { DNSFilter } from "../src/lib/filtering";
import { AdGuardProfileEngine, parseAdGuardLine, AdGuardRuleKind, AdGuardPayload } from "../src/lib/adguard";
import { BloomFilter } from "../src/utils/bloom";
import { pipelineFilter } from "../src/pipeline/filter";
import { Context, DNSQuery, ProfileSettings, Rule } from "../src/types";

import { buildDNSQuery } from "../src/utils/dns";

async function runPipelineTests(): Promise<void> {
  console.log(">>> [TEST] Starting AdGuard Tiered Hybrid Pipeline & Subdomain Matching Tests...");

  // 1. Custom Rules Subdomain Matching (cancelled automatic subdomain match)
  console.log("1. Testing custom rules subdomain matching policy...");
  const exactRule: Rule = {
    id: 1,
    profile_id: "p1",
    type: "BLOCK",
    pattern: "example.com",
    include_subdomains: 0 // Default: off
  };
  assert.strictEqual(DNSFilter.isMatch("example.com", exactRule), true);
  assert.strictEqual(DNSFilter.isMatch("sub.example.com", exactRule), false);
  assert.strictEqual(DNSFilter.isMatch("a.b.example.com", exactRule), false);

  const subRule: Rule = {
    id: 2,
    profile_id: "p1",
    type: "BLOCK",
    pattern: "example.com",
    include_subdomains: 1 // Explicitly enabled
  };
  assert.strictEqual(DNSFilter.isMatch("example.com", subRule), true);
  assert.strictEqual(DNSFilter.isMatch("sub.example.com", subRule), true);
  assert.strictEqual(DNSFilter.isMatch("a.b.example.com", subRule), true);
  assert.strictEqual(DNSFilter.isMatch("notexample.com", subRule), false);

  // Direct AdGuard syntax in pattern
  const adguardSyntaxRule: Rule = {
    id: 3,
    profile_id: "p1",
    type: "BLOCK",
    pattern: "||adguard-syntax.com^"
  };
  assert.strictEqual(DNSFilter.isMatch("adguard-syntax.com", adguardSyntaxRule), true);
  assert.strictEqual(DNSFilter.isMatch("sub.adguard-syntax.com", adguardSyntaxRule), true);

  // Wildcard syntax: *.wildcard.com
  const wildcardRule: Rule = {
    id: 4,
    profile_id: "p1",
    type: "BLOCK",
    pattern: "*.wildcard.com"
  };
  assert.strictEqual(DNSFilter.isMatch("wildcard.com", wildcardRule), true);
  assert.strictEqual(DNSFilter.isMatch("sub.wildcard.com", wildcardRule), true);
  assert.strictEqual(DNSFilter.isMatch("deep.sub.wildcard.com", wildcardRule), true);
  assert.strictEqual(DNSFilter.isMatch("notwildcard.com", wildcardRule), false);
  console.log("   ✓ Custom rule exact vs subdomain matching verified.");

  // 2. Dual-State Bloom Filter (|| vs exact)
  console.log("2. Testing dual-state Bloom filter (prefix-encoded subdomain distinction)...");
  const bloom = BloomFilter.create(10000, 0.0001);

  // Add a wildcard rule: ||blocked-all.com^
  bloom.add("blocked-all.com");
  bloom.add("||blocked-all.com");

  // Add an exact rule: exact-single.com
  bloom.add("exact-single.com");

  const mockContext: Context = {
    profileId: "p1",
    startTime: Date.now(),
    env: {} as any,
    ctx: { waitUntil: () => {}, passThroughOnException: () => {} } as any
  };
  const mockSettings: ProfileSettings = {
    upstream: ["https://cloudflare-dns.com/dns-query"],
    ecs: { enabled: false, use_client_ip: false },
    default_policy: "ALLOW",
    log_retention_days: 0
  };
  const dummyRequest = new Request("http://127.0.0.1/dns-query");

  // Query sub.blocked-all.com -> should match Level 1 ||blocked-all.com -> BLOCK!
  const querySubBlocked: DNSQuery = { name: "sub.blocked-all.com", type: "A", raw: new Uint8Array() };
  const resSubBlocked = await pipelineFilter.match(
    dummyRequest, querySubBlocked, mockContext, mockSettings, [], bloom, () => {}
  );
  assert.strictEqual(resSubBlocked?.action, "BLOCK");
  assert.strictEqual(resSubBlocked?.reason, "External List: ||blocked-all.com");

  // Query exact-single.com -> matches exact -> BLOCK!
  const queryExact: DNSQuery = { name: "exact-single.com", type: "A", raw: new Uint8Array() };
  const resExact = await pipelineFilter.match(
    dummyRequest, queryExact, mockContext, mockSettings, [], bloom, () => {}
  );
  assert.strictEqual(resExact?.action, "BLOCK");
  assert.strictEqual(resExact?.reason, "External List: exact-single.com");

  // Query sub.exact-single.com -> parent is exact-single.com without || -> NOT BLOCKED!
  const querySubExact: DNSQuery = { name: "sub.exact-single.com", type: "A", raw: new Uint8Array() };
  const resSubExact = await pipelineFilter.match(
    dummyRequest, querySubExact, mockContext, mockSettings, [], bloom, () => {}
  );
  assert.strictEqual(resSubExact, null);
  console.log("   ✓ Dual-state Bloom filter successfully avoids false subdomain blocks.");

  // 3. AdGuard Exceptions (@@) Overriding Bloom
  console.log("3. Testing AdGuard exception whitelist overriding Bloom...");
  const adguardPayload: AdGuardPayload = {
    exceptions: [
      { domain: "safe.blocked-all.com", includeSubdomains: true }
    ],
    rewrites: {
      "router.local": { type: "A", value: "192.168.1.1", includeSubdomains: true }
    },
    patterns: [
      { pattern: "^ad[0-9]+\\.track\\.com$", apexIndex: "track.com" }
    ]
  };
  const engine = new AdGuardProfileEngine(adguardPayload);

  // safe.blocked-all.com is in Bloom under ||blocked-all.com, but exempted by @@
  const queryExempted: DNSQuery = {
    name: "safe.blocked-all.com",
    type: "A",
    raw: buildDNSQuery("safe.blocked-all.com", "A")
  };
  const resExempted = await pipelineFilter.match(
    dummyRequest, queryExempted, mockContext, mockSettings, [], bloom, () => {}, engine
  );
  // It was exempted from Bloom! It dispatched to resolver as Whitelist Exception rather than BLOCK.
  assert.ok(resExempted !== null);
  assert.notStrictEqual(resExempted?.action, "BLOCK");
  assert.strictEqual(resExempted?.action, "PASS");
  assert.strictEqual(resExempted?.reason, "External List: Exception");
  console.log("   ✓ External list whitelist exception successfully overrides Bloom block.");

  // 4. External List DNS Rewrite ($dnsrewrite)
  console.log("4. Testing External List DNS rewrites ($dnsrewrite)...");
  const queryRewrite: DNSQuery = { name: "sub.router.local", type: "A", raw: new Uint8Array() };
  const resRewrite = await pipelineFilter.match(
    dummyRequest, queryRewrite, mockContext, mockSettings, [], bloom, () => {}, engine
  );
  assert.strictEqual(resRewrite?.action, "REDIRECT");
  assert.strictEqual(resRewrite?.reason, "External List: DNS Rewrite");
  console.log("   ✓ External List DNS rewrite synthesized properly.");

  // 5. External List Complex Regex Pattern
  console.log("5. Testing External List complex regex pattern matching...");
  const queryPatternHit: DNSQuery = { name: "ad123.track.com", type: "A", raw: new Uint8Array() };
  const resPatternHit = await pipelineFilter.match(
    dummyRequest, queryPatternHit, mockContext, mockSettings, [], bloom, () => {}, engine
  );
  assert.strictEqual(resPatternHit?.action, "BLOCK");
  assert.strictEqual(resPatternHit?.reason, "External List: Pattern");

  const queryPatternMiss: DNSQuery = { name: "good.track.com", type: "A", raw: new Uint8Array() };
  const resPatternMiss = await pipelineFilter.match(
    dummyRequest, queryPatternMiss, mockContext, mockSettings, [], bloom, () => {}, engine
  );
  assert.strictEqual(resPatternMiss, null);
  console.log("   ✓ AdGuard regex pattern evaluation passed.");

  // 6. AdGuard Detail Inspection (findException, findPattern, findRewrite)
  console.log("6. Testing AdGuard detail inspection methods (findException, findPattern, findRewrite)...");
  const inspectionPayload: AdGuardPayload = {
    exceptions: [
      { domain: "microsoft.com", includeSubdomains: true, raw: "@@||microsoft.com^" }
    ],
    rewrites: {
      "router.local": { type: "A", value: "192.168.1.1", includeSubdomains: true, raw: "||router.local^$dnsrewrite=192.168.1.1" }
    },
    patterns: [
      { pattern: "^(?:.*\\.)?gostats\\..*$", raw: "||gostats.*^" },
      { pattern: "^(?:.*\\.)?.*\\-analytics.*\\.huami\\.com$", apexIndex: "huami.com", raw: "||*-analytics*.huami.com^" }
    ]
  };
  const inspectEngine = new AdGuardProfileEngine(inspectionPayload);

  // Exception inspection
  assert.strictEqual(inspectEngine.findException("microsoft.com"), "@@||microsoft.com^");
  assert.strictEqual(inspectEngine.findException("sub.microsoft.com"), "@@||microsoft.com^");
  assert.strictEqual(inspectEngine.findException("other.com"), null);

  // Pattern inspection
  const gostatsHit = inspectEngine.findPattern("gostats.net");
  assert.ok(gostatsHit !== null && gostatsHit.matched);
  assert.strictEqual(gostatsHit.raw, "||gostats.*^");

  const huamiHit = inspectEngine.findPattern("2-analytics-1.huami.com");
  assert.ok(huamiHit !== null && huamiHit.matched);
  assert.strictEqual(huamiHit.raw, "||*-analytics*.huami.com^");

  const huamiMiss = inspectEngine.findPattern("other.huami.com");
  assert.strictEqual(huamiMiss, null);

  // Rewrite inspection
  const rewriteHit = inspectEngine.findRewrite("sub.router.local");
  assert.ok(rewriteHit !== null);
  assert.strictEqual(rewriteHit.raw, "||router.local^$dnsrewrite=192.168.1.1");
  console.log("   ✓ AdGuard detail inspection methods verified successfully.");

  console.log("\n======================================================");
  console.log("   ALL ADGUARD HYBRID PIPELINE TESTS PASSED!          ");
  console.log("======================================================\n");
}

runPipelineTests().catch((err) => {
  console.error("Pipeline test failed:", err);
  process.exit(1);
});
