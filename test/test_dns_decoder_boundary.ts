/// <reference types="node" />
import assert from "node:assert";
import { parseDNSAnswer } from "../src/utils/dns/decoder";
import { buildDNSQuery, buildResponseMulti } from "../src/utils/dns/encoder";

async function runTests() {
  console.log(">>> [TEST] Running DNS Decoder Boundary & Truncation Tests...\n");

  // 1. Normal resolution parsing
  console.log("1. Testing normal resolution parsing...");
  {
    const query = buildDNSQuery("example.com", "A");
    const response = buildResponseMulti(query, [
      { name: "example.com", type: "A", value: "93.184.216.34", ttl: 300 },
      { name: "example.com", type: "AAAA", value: "2606:2800:220:1:248:1893:25c8:1946", ttl: 300 },
      { name: "example.com", type: "TXT", value: "v=spf1 -all", ttl: 300 }
    ]);

    const answers = parseDNSAnswer(response);
    assert.strictEqual(answers.length, 3, "Should parse all 3 valid answers");
    assert.strictEqual(answers[0].data, "93.184.216.34");
    assert.strictEqual(answers[1].type, "AAAA");
    assert.strictEqual(answers[2].data, "v=spf1 -all");
    console.log("  Passed: Normal records parsed successfully.");
  }

  // 2. Truncated A record (RDATA bytes missing)
  console.log("\n2. Testing truncated A record (RDATA cut short)...");
  {
    const query = buildDNSQuery("example.com", "A");
    const validResponse = buildResponseMulti(query, [
      { name: "example.com", type: "A", value: "1.2.3.4", ttl: 60 }
    ]);

    // Cut off the last 2 bytes of the IPv4 address
    const truncatedResponse = validResponse.subarray(0, validResponse.length - 2);

    const answers = parseDNSAnswer(truncatedResponse);
    assert.strictEqual(answers.length, 0, "Truncated A record should be dropped");
    for (const ans of answers) {
      assert(!ans.data.includes("undefined"), "Must never contain 'undefined'");
    }
    console.log("  Passed: Truncated A record was dropped and no 'undefined.undefined' was produced.");
  }

  // 3. Multi-record answer with second record truncated
  console.log("\n3. Testing multi-record answer where second record is truncated...");
  {
    const query = buildDNSQuery("example.com", "A");
    const validResponse = buildResponseMulti(query, [
      { name: "example.com", type: "A", value: "1.1.1.1", ttl: 60 },
      { name: "example.com", type: "A", value: "2.2.2.2", ttl: 60 }
    ]);

    // Truncate the second record's RDATA
    const truncatedResponse = validResponse.subarray(0, validResponse.length - 3);

    const answers = parseDNSAnswer(truncatedResponse);
    assert.strictEqual(answers.length, 1, "Should keep first valid record and drop truncated second record");
    assert.strictEqual(answers[0].data, "1.1.1.1");
    console.log("  Passed: First record retained, truncated second record dropped cleanly.");
  }

  // 4. Truncated RR fixed header (cut off mid-header)
  console.log("\n4. Testing truncated RR fixed header (less than 10 bytes)...");
  {
    const query = buildDNSQuery("example.com", "A");
    const validResponse = buildResponseMulti(query, [
      { name: "example.com", type: "A", value: "8.8.8.8", ttl: 60 }
    ]);

    // Cut off so that only partial RR header remains
    // Full RR is name (2B pointer) + 10B header + 4B rdata = 16B
    // Cut 10 bytes -> only name and 4 bytes of header remain
    const truncatedResponse = validResponse.subarray(0, validResponse.length - 10);

    const answers = parseDNSAnswer(truncatedResponse);
    assert.strictEqual(answers.length, 0, "Incomplete RR header must be dropped");
    console.log("  Passed: Incomplete RR header safely dropped without errors.");
  }

  // 5. Truncated Question section
  console.log("\n5. Testing truncated Question section...");
  {
    const query = buildDNSQuery("verylongdomainnameforboundarytest.example.com", "A");
    // Cut off query inside the question section
    const truncatedQuery = query.subarray(0, 18);

    const answers = parseDNSAnswer(truncatedQuery);
    assert.strictEqual(answers.length, 0, "Truncated Question must safely return empty array");
    console.log("  Passed: Truncated Question section returned empty array.");
  }

  // 6. Truncated AAAA record
  console.log("\n6. Testing truncated AAAA record...");
  {
    const query = buildDNSQuery("example.com", "AAAA");
    const validResponse = buildResponseMulti(query, [
      { name: "example.com", type: "AAAA", value: "2001:db8::1", ttl: 60 }
    ]);

    // Cut off last 8 bytes of the 16-byte IPv6 address
    const truncatedResponse = validResponse.subarray(0, validResponse.length - 8);

    const answers = parseDNSAnswer(truncatedResponse);
    assert.strictEqual(answers.length, 0, "Truncated AAAA record must be dropped");
    console.log("  Passed: Truncated AAAA record safely dropped.");
  }

  // 7. Malformed TXT record (string length exceeds rdLength)
  console.log("\n7. Testing malformed TXT record (chunk length > rdLength)...");
  {
    const query = buildDNSQuery("example.com", "TXT");
    const validResponse = buildResponseMulti(query, [
      { name: "example.com", type: "TXT", value: "hello", ttl: 60 }
    ]);

    // In validResponse, find the TXT rdata where the string length byte is
    // Corrupt the length byte to 250 (exceeding the actual rdLength of 6)
    const corrupted = new Uint8Array(validResponse);
    // The TXT length byte is at the end: name(2B) + 10B header + length_byte(1B) + 'hello'(5B)
    corrupted[corrupted.length - 6] = 250;

    const answers = parseDNSAnswer(corrupted);
    // Should safely terminate without throwing or hanging
    assert(Array.isArray(answers), "Should return array without throwing");
    console.log("  Passed: Malformed TXT chunk length safely handled.");
  }

  // 8. HTTPS/SVCB record with rdLength < 2
  console.log("\n8. Testing HTTPS record with rdLength < 2...");
  {
    // Construct a packet with an HTTPS record whose rdLength is 1
    const query = buildDNSQuery("example.com", "HTTPS");
    const response = new Uint8Array(query.length + 14);
    response.set(query);
    response[2] |= 0x80; // QR=1
    response[7] = 1;     // ANCOUNT=1
    let offset = query.length;
    response[offset++] = 0xc0; response[offset++] = 0x0c; // Name pointer
    response[offset++] = 0x00; response[offset++] = 0x41; // TYPE HTTPS (65)
    response[offset++] = 0x00; response[offset++] = 0x01; // CLASS IN
    response[offset++] = 0x00; response[offset++] = 0x00; response[offset++] = 0x00; response[offset++] = 0x3c; // TTL 60
    response[offset++] = 0x00; response[offset++] = 0x01; // rdLength = 1 (too short for priority 2B)
    response[offset++] = 0xaa; // 1 byte payload

    const answers = parseDNSAnswer(response);
    assert.strictEqual(answers.length, 1);
    assert.strictEqual(answers[0].data, "[Raw: 1 bytes]");
    console.log("  Passed: HTTPS record with rdLength < 2 handled safely.");
  }

  console.log("\n>>> [TEST] All DNS Decoder Boundary & Truncation tests passed successfully!\n");
}

runTests().catch(err => {
  console.error(">>> [TEST ERROR]", err);
  process.exit(1);
});
