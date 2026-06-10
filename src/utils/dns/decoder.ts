import { DNSQuery } from "../../types";
import { DNS_TYPES } from "./constants";

/**
 * Decodes a DNS domain name from the raw packet buffer (with support for compression pointers 0xC0).
 *
 * @param buffer - The raw DNS packet buffer.
 * @param offset - The byte offset where the name starts.
 * @returns An object containing the decoded domain name and the number of bytes read.
 */
export function decodeName(
  buffer: Uint8Array,
  offset: number
): { name: string; read: number } {
  let name = "";
  let curr = offset;
  let jumped = false;
  let consumed = 0;
  let iterations = 0;

  while (iterations < 128) {
    if (curr >= buffer.length) break; // Boundary check
    const len = buffer[curr];

    if (len === 0) {
      if (!jumped) consumed++;
      break;
    }

    if ((len & 0xc0) === 0xc0) {
      if (curr + 1 >= buffer.length) break; // Pointer bytes check
      const pointer = ((len & 0x3f) << 8) | buffer[curr + 1];
      if (!jumped) {
        consumed += 2;
        jumped = true;
      }
      curr = pointer;
      iterations++;
      continue;
    }

    if (name.length > 0) name += ".";
    // Check if label content overflows the buffer
    if (curr + 1 + len > buffer.length) break;

    for (let i = 0; i < len; i++) {
      name += String.fromCharCode(buffer[curr + 1 + i]);
    }
    if (!jumped) consumed += len + 1;
    curr += len + 1;
    iterations++;
  }

  return { name, read: consumed };
}

/**
 * Maps a numeric DNS query type code to its string representation.
 *
 * @param type - The numeric DNS query type code.
 * @returns The string representation of the record type (e.g. "A", "AAAA").
 */
export function getQTypeName(type: number): string {
  return DNS_TYPES[type] || `TYPE${type}`;
}

/**
 * Parses an incoming HTTP Request (GET or POST) containing a DNS query packet.
 *
 * @param request - The incoming Cloudflare Worker Request object.
 * @returns A promise resolving to the parsed DNSQuery or null if invalid.
 */
export async function parseDNSQuery(
  request: Request
): Promise<DNSQuery | null> {
  try {
    let raw: Uint8Array;

    if (request.method === "GET") {
      const url = new URL(request.url);
      const dnsParam = url.searchParams.get("dns");
      if (!dnsParam) return null;

      let base64 = dnsParam.replace(/-/g, "+").replace(/_/g, "/");
      while (base64.length % 4) base64 += "=";

      const binary = atob(base64);
      raw = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        raw[i] = binary.charCodeAt(i);
      }
    } else if (request.method === "POST") {
      const buffer = await request.arrayBuffer();
      raw = new Uint8Array(buffer);
    } else {
      return null;
    }

    // Minimum header length: Header(12) + QTYPE(2) + QCLASS(2) = 16
    if (raw.length < 16) return null;

    const { name, read } = decodeName(raw, 12);
    const qtypeOffset = 12 + read;

    // Boundary check for query type and class
    if (qtypeOffset + 4 > raw.length) return null;

    const qtypeCode = (raw[qtypeOffset] << 8) | raw[qtypeOffset + 1];

    return {
      name,
      type: getQTypeName(qtypeCode),
      raw
    };
  } catch (e) {
    console.error("DNS Parse Error:", e);
    return null;
  }
}

/**
 * Parses raw DNS answer packets into structured answer record details.
 *
 * @param raw - The raw DNS response packet buffer.
 * @returns An array of parsed DNS answer objects containing name, type, data, and ttl.
 */
export function parseDNSAnswer(
  raw: Uint8Array
): { name: string; type: string; data: string; ttl: number }[] {
  if (raw.length < 12) return [];
  const ansCount = (raw[6] << 8) | raw[7];
  if (ansCount === 0) return [];

  const results: { name: string; type: string; data: string; ttl: number }[] = [];
  let offset = 12;

  const qCount = (raw[4] << 8) | raw[5];
  for (let i = 0; i < qCount; i++) {
    const { read } = decodeName(raw, offset);
    offset += read + 4;
  }

  for (let i = 0; i < ansCount; i++) {
    const { name, read: nameRead } = decodeName(raw, offset);
    offset += nameRead;

    const typeCode = (raw[offset] << 8) | raw[offset + 1];
    const ttl =
      (raw[offset + 4] << 24) |
      (raw[offset + 5] << 16) |
      (raw[offset + 6] << 8) |
      raw[offset + 7];
    const rdLength = (raw[offset + 8] << 8) | raw[offset + 9];
    offset += 10;

    const type = getQTypeName(typeCode);
    let data = "";

    if (type === "A" && rdLength === 4) {
      data = `${raw[offset]}.${raw[offset + 1]}.${raw[offset + 2]}.${raw[offset + 3]}`;
    } else if (type === "AAAA" && rdLength === 16) {
      const parts: string[] = [];
      for (let j = 0; j < 16; j += 2) {
        parts.push(
          ((raw[offset + j] << 8) | raw[offset + j + 1]).toString(16)
        );
      }
      // Locate the longest contiguous sequence of "0"s for IPv6 compression
      let bestStart = -1,
        bestLen = 0;
      let currentStart = -1,
        currentLen = 0;
      for (let j = 0; j < parts.length; j++) {
        if (parts[j] === "0") {
          if (currentStart === -1) currentStart = j;
          currentLen++;
        } else {
          if (currentLen > bestLen) {
            bestStart = currentStart;
            bestLen = currentLen;
          }
          currentStart = -1;
          currentLen = 0;
        }
      }
      if (currentLen > bestLen) {
        bestStart = currentStart;
        bestLen = currentLen;
      }

      if (bestLen > 1) {
        // Replace the longest "0" sequence with "::"
        const replacement =
          bestStart === 0 || bestStart + bestLen === parts.length ? ":" : "";
        parts.splice(bestStart, bestLen, replacement);
      }
      data = parts.join(":").replace(":::", "::");
    } else if (type === "CNAME" || type === "NS" || type === "PTR") {
      data = decodeName(raw, offset).name;
    } else if (type === "TXT") {
      // Process TXT records (which can contain multiple substrings)
      let txtOffset = offset;
      const txtParts: string[] = [];
      while (txtOffset < offset + rdLength) {
        const len = raw[txtOffset];
        txtParts.push(
          String.fromCharCode(
            ...raw.slice(txtOffset + 1, txtOffset + 1 + len)
          )
        );
        txtOffset += len + 1;
      }
      data = txtParts.join("");
    } else if (type === "HTTPS" || type === "SVCB") {
      // HTTPS/SVCB format: priority (2 bytes) + target name (variable) + parameters (variable)
      const priority = (raw[offset] << 8) | raw[offset + 1];
      const { name: target } = decodeName(raw, offset + 2);
      data = `priority: ${priority}, target: ${target || "."}`;
      if (rdLength > 2) data += ` [params: ${rdLength - 2} bytes]`;
    } else {
      data = `[Raw: ${rdLength} bytes]`;
    }

    results.push({ name, type, data, ttl });
    offset += rdLength;
  }

  return results;
}
