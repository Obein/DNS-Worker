import assert from "node:assert";
import {
  parseAdGuardLine,
  extractApexDomain,
  wildcardToRegex,
  AdGuardRuleKind
} from "../src/lib/adguard";

function runAdGuardParserTests(): void {
  console.log(">>> [TEST] Starting AdGuard Rule Parser & Classifier Unit Tests...");

  // 1. Comments and Cosmetic Rules
  console.log("1. Testing comments and cosmetic rules...");
  assert.strictEqual(parseAdGuardLine("! Title: EasyList")?.kind, AdGuardRuleKind.COMMENT);
  assert.strictEqual(parseAdGuardLine("# Another comment")?.kind, AdGuardRuleKind.COMMENT);
  assert.strictEqual(parseAdGuardLine("   ") === null, true);
  assert.strictEqual(parseAdGuardLine("example.com##.banner-ad")?.kind, AdGuardRuleKind.UNSUPPORTED);
  assert.strictEqual(parseAdGuardLine("##.ad-header")?.kind, AdGuardRuleKind.UNSUPPORTED);
  assert.strictEqual(parseAdGuardLine("$$script:contains('ads')")?.kind, AdGuardRuleKind.UNSUPPORTED);
  console.log("   ✓ Comments and cosmetic rules handled.");

  // 2. Regular Expressions
  console.log("2. Testing regular expression rules...");
  const regexRule = parseAdGuardLine("/^ad[0-9]+\\.google\\.com$/");
  assert.strictEqual(regexRule?.kind, AdGuardRuleKind.COMPLEX_PATTERN);
  assert.strictEqual(regexRule?.patternRegex, "^ad[0-9]+\\.google\\.com$");
  assert.strictEqual(regexRule?.apexIndex, "google.com");
  console.log("   ✓ Regular expressions parsed and indexed.");

  // 3. Whitelist Exceptions (@@)
  console.log("3. Testing whitelist exceptions (@@)...");
  const subExc = parseAdGuardLine("@@||safe\\.example\\.com^");
  assert.strictEqual(subExc?.kind, AdGuardRuleKind.EXCEPTION);
  assert.strictEqual(subExc?.domain, "safe.example.com");
  assert.strictEqual(subExc?.includeSubdomains, true);

  const exactExc = parseAdGuardLine("@@|exact\\.example\\.com^");
  assert.strictEqual(exactExc?.kind, AdGuardRuleKind.EXCEPTION);
  assert.strictEqual(exactExc?.domain, "exact.example.com");
  assert.strictEqual(exactExc?.includeSubdomains, false);

  const wildcardExc = parseAdGuardLine("@@||*-allow.example.com^");
  assert.strictEqual(wildcardExc?.kind, AdGuardRuleKind.COMPLEX_PATTERN);
  assert.strictEqual(wildcardExc?.apexIndex, "example.com");
  console.log("   ✓ Whitelist exceptions properly parsed.");

  // 4. DNS Rewrites ($dnsrewrite)
  console.log("4. Testing DNS rewrite rules ($dnsrewrite)...");
  const aRewrite = parseAdGuardLine("||router.local^$dnsrewrite=192.168.1.1");
  assert.strictEqual(aRewrite?.kind, AdGuardRuleKind.DNS_REWRITE);
  assert.strictEqual(aRewrite?.domain, "router.local");
  assert.strictEqual(aRewrite?.includeSubdomains, true);
  assert.strictEqual(aRewrite?.rewrite?.type, "A");
  assert.strictEqual(aRewrite?.rewrite?.value, "192.168.1.1");

  const aaaaRewrite = parseAdGuardLine("||router.ipv6^$dnsrewrite=2001:db8::1");
  assert.strictEqual(aaaaRewrite?.rewrite?.type, "AAAA");
  assert.strictEqual(aaaaRewrite?.rewrite?.value, "2001:db8::1");

  const nxRewrite = parseAdGuardLine("||telemetry\\.windows\\.com^$dnsrewrite=NXDOMAIN");
  assert.strictEqual(nxRewrite?.rewrite?.type, "NXDOMAIN");

  const cnameRewrite = parseAdGuardLine("|duck.com^$dnsrewrite=duckduckgo.com");
  assert.strictEqual(cnameRewrite?.domain, "duck.com");
  assert.strictEqual(cnameRewrite?.includeSubdomains, false);
  assert.strictEqual(cnameRewrite?.rewrite?.type, "CNAME");
  assert.strictEqual(cnameRewrite?.rewrite?.value, "duckduckgo.com");
  console.log("   ✓ DNS rewrite rules correctly parsed.");

  // 5. Hosts-format lines
  console.log("5. Testing hosts-file format...");
  const hostsRule = parseAdGuardLine("0.0.0.0 adservice.google.com");
  assert.strictEqual(hostsRule?.kind, AdGuardRuleKind.BLOOM_DOMAIN);
  assert.strictEqual(hostsRule?.domain, "adservice.google.com");
  assert.strictEqual(hostsRule?.includeSubdomains, false); // Hosts lines only target exact domain

  assert.strictEqual(parseAdGuardLine("127.0.0.1 localhost") === null, true);
  assert.strictEqual(parseAdGuardLine("0.0.0.0 0.0.0.0") === null, true);
  console.log("   ✓ Hosts format parsed.");

  // 6. Subdomain Distinction (|| vs | vs bare)
  console.log("6. Testing subdomain matching distinction (|| vs | vs bare)...");
  const subBlock = parseAdGuardLine("||tracker.com^");
  assert.strictEqual(subBlock?.kind, AdGuardRuleKind.BLOOM_DOMAIN);
  assert.strictEqual(subBlock?.domain, "tracker.com");
  assert.strictEqual(subBlock?.includeSubdomains, true);

  const exactBlock = parseAdGuardLine("|single-exact.com^");
  assert.strictEqual(exactBlock?.kind, AdGuardRuleKind.BLOOM_DOMAIN);
  assert.strictEqual(exactBlock?.domain, "single-exact.com");
  assert.strictEqual(exactBlock?.includeSubdomains, false);

  const bareBlock = parseAdGuardLine("bare-domain.org");
  assert.strictEqual(bareBlock?.kind, AdGuardRuleKind.BLOOM_DOMAIN);
  assert.strictEqual(bareBlock?.domain, "bare-domain.org");
  assert.strictEqual(bareBlock?.includeSubdomains, false); // Cancelled always matching subdomains policy
  console.log("   ✓ Subdomain distinction verified.");

  // 7. Wildcards and Apex Extraction
  console.log("7. Testing wildcards and apex extraction...");
  const wildcardBlock = parseAdGuardLine("||*-analytics.facebook.com^");
  assert.strictEqual(wildcardBlock?.kind, AdGuardRuleKind.COMPLEX_PATTERN);
  assert.strictEqual(wildcardBlock?.apexIndex, "facebook.com");

  assert.strictEqual(extractApexDomain("ad.example.co.uk"), "example.co.uk");
  assert.strictEqual(extractApexDomain("sub.my-domain.com"), "my-domain.com");
  assert.strictEqual(extractApexDomain("example.*"), undefined);

  const regexSrc = wildcardToRegex("||*-ad.test.com^", true);
  const re = new RegExp(regexSrc, "i");
  assert.strictEqual(re.test("sub.xyz-ad.test.com"), true);
  assert.strictEqual(re.test("xyz-ad.test.com"), true);
  assert.strictEqual(re.test("other.test.com"), false);
  console.log("   ✓ Wildcard to regex compilation verified.");

  console.log("\n======================================================");
  console.log("   ALL ADGUARD PARSER TESTS PASSED!                   ");
  console.log("======================================================\n");
}

runAdGuardParserTests();
