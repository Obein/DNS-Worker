/**
 * Parses an IPv6 address string into an array of 16 bytes.
 */
export function parseIPv6Bytes(ip: string): number[] {
  const bytes = new Uint8Array(16);
  if (ip.includes("::")) {
    const [left, right] = ip.split("::");
    const leftParts = left ? left.split(":").filter(Boolean) : [];
    const rightParts = right ? right.split(":").filter(Boolean) : [];

    let i = 0;
    for (const part of leftParts) {
      const v = parseInt(part, 16);
      bytes[i++] = (v >> 8) & 0xff;
      bytes[i++] = v & 0xff;
    }

    i = 16 - rightParts.length * 2;
    for (const part of rightParts) {
      const v = parseInt(part, 16);
      bytes[i++] = (v >> 8) & 0xff;
      bytes[i++] = v & 0xff;
    }
  } else {
    const parts = ip.split(":");
    let i = 0;
    for (const part of parts) {
      const v = parseInt(part, 16);
      bytes[i++] = (v >> 8) & 0xff;
      bytes[i++] = v & 0xff;
    }
  }
  return Array.from(bytes);
}

/**
 * Encodes structured HTTPS/SVCB parameters into standard RFC 9460 RDATA byte sequence.
 */
export function encodeHttpsRDataFromParams(options: {
  priority?: number;
  target?: string;
  alpn?: string[];
  ipv4hints?: string[];
  ipv6hints?: string[];
  echBase64?: string;
}): number[] {
  const {
    priority = 1,
    target = ".",
    alpn = ["h3", "h2"],
    ipv4hints = [],
    ipv6hints = [],
    echBase64 = null
  } = options;

  const bytes: number[] = [];

  // 1. Priority (uint16)
  bytes.push((priority >> 8) & 0xff, priority & 0xff);

  // 2. Target Name (wire format DNS name, 0x00 for root ".")
  if (!target || target === ".") {
    bytes.push(0x00);
  } else {
    const labels = target.split(".");
    for (const label of labels) {
      bytes.push(label.length);
      for (let i = 0; i < label.length; i++) {
        bytes.push(label.charCodeAt(i));
      }
    }
    bytes.push(0x00);
  }

  // 3. SvcParams strictly ordered by key in ascending order (RFC 9460 Section 2.2):
  // Key 1: alpn
  if (alpn && alpn.length > 0) {
    const alpnVal: number[] = [];
    for (const proto of alpn) {
      alpnVal.push(proto.length);
      for (let i = 0; i < proto.length; i++) {
        alpnVal.push(proto.charCodeAt(i));
      }
    }
    bytes.push(0x00, 0x01); // Key 1
    bytes.push((alpnVal.length >> 8) & 0xff, alpnVal.length & 0xff);
    bytes.push(...alpnVal);
  }

  // Key 4: ipv4hint
  if (ipv4hints && ipv4hints.length > 0) {
    const ipBytes: number[] = [];
    for (const ip of ipv4hints) {
      const parts = ip.split(".").map(Number);
      if (parts.length === 4 && parts.every((p) => !isNaN(p) && p >= 0 && p <= 255)) {
        ipBytes.push(...parts);
      }
    }
    if (ipBytes.length > 0) {
      bytes.push(0x00, 0x04); // Key 4
      bytes.push((ipBytes.length >> 8) & 0xff, ipBytes.length & 0xff);
      bytes.push(...ipBytes);
    }
  }

  // Key 5: ech
  if (echBase64) {
    try {
      const binaryStr = atob(echBase64);
      const echBytes: number[] = [];
      for (let i = 0; i < binaryStr.length; i++) {
        echBytes.push(binaryStr.charCodeAt(i));
      }
      bytes.push(0x00, 0x05); // Key 5
      bytes.push((echBytes.length >> 8) & 0xff, echBytes.length & 0xff);
      bytes.push(...echBytes);
    } catch (e) {
      console.error("Failed to decode base64 ech config:", e);
    }
  }

  // Key 6: ipv6hint
  if (ipv6hints && ipv6hints.length > 0) {
    const ip6Bytes: number[] = [];
    for (const ip of ipv6hints) {
      const raw16 = parseIPv6Bytes(ip);
      if (raw16 && raw16.length === 16) {
        ip6Bytes.push(...raw16);
      }
    }
    if (ip6Bytes.length > 0) {
      bytes.push(0x00, 0x06); // Key 6
      bytes.push((ip6Bytes.length >> 8) & 0xff, ip6Bytes.length & 0xff);
      bytes.push(...ip6Bytes);
    }
  }

  return bytes;
}

/**
 * Encodes a standard textual HTTPS/SVCB presentation string (e.g. "1 . alpn=h3,h2 ipv4hint=... ech=...")
 * into RFC 9460 RDATA binary bytes.
 *
 * @param value - The textual presentation string.
 * @returns Array of RDATA bytes.
 */
export function encodeHttpsRDataFromString(value: string): number[] {
  const tokens = value.trim().split(/\s+/);
  const priority = parseInt(tokens[0], 10) || 1;
  const target = tokens[1] || ".";

  let alpn: string[] | undefined;
  let ipv4hints: string[] | undefined;
  let echBase64: string | undefined;
  let ipv6hints: string[] | undefined;

  for (let i = 2; i < tokens.length; i++) {
    const token = tokens[i];
    const eqIdx = token.indexOf("=");
    if (eqIdx === -1) continue;
    const k = token.substring(0, eqIdx);
    const v = token.substring(eqIdx + 1);
    if (k === "alpn") {
      alpn = v.split(",");
    } else if (k === "ipv4hint") {
      ipv4hints = v.split(",");
    } else if (k === "ech") {
      echBase64 = v;
    } else if (k === "ipv6hint") {
      ipv6hints = v.split(",");
    }
  }

  return encodeHttpsRDataFromParams({
    priority,
    target,
    alpn,
    ipv4hints,
    ipv6hints,
    echBase64
  });
}
