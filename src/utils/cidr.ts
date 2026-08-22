/**
 * @file cidr.ts
 * @description High-performance IPv4 and IPv6 CIDR parsing, matching, and validation utilities.
 */

/**
 * Pre-compiled IPv4 CIDR range structure.
 */
export interface ParsedCidrV4 {
  version: 4;
  net: number;
  mask: number;
}

/**
 * Pre-compiled IPv6 CIDR range structure.
 */
export interface ParsedCidrV6 {
  version: 6;
  net: bigint;
  mask: bigint;
}

export type ParsedCidr = ParsedCidrV4 | ParsedCidrV6;

/**
 * Converts an IPv4 address string into a 32-bit unsigned integer, or null if invalid.
 *
 * @param ip - The IPv4 string to convert.
 * @returns 32-bit unsigned integer or null.
 */
export function ipv4ToNumeric(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;

  let hasError = false;
  const val = parts.reduce((ipInt, octet) => {
    const num = Number(octet);
    if (octet === "" || isNaN(num) || num < 0 || num > 255 || String(num) !== octet) {
      hasError = true;
    }
    return (ipInt << 8) + num;
  }, 0) >>> 0;

  return hasError ? null : val;
}

/**
 * Converts an IPv6 address string into a 128-bit BigInt, or null if invalid.
 *
 * @param ip - The IPv6 string to convert.
 * @returns 128-bit BigInt or null.
 */
export function ipv6ToBigInt(ip: string): bigint | null {
  let cleanIp = ip.trim().toLowerCase();

  // Extract mapped IPv4 part if present
  let ipv4Part = "";
  if (cleanIp.includes(".")) {
    const lastColon = cleanIp.lastIndexOf(":");
    if (lastColon === -1) return null;
    ipv4Part = cleanIp.substring(lastColon + 1);
    cleanIp = cleanIp.substring(0, lastColon) + ":0:0";
  }

  // A valid IPv6 can only have at most one "::"
  const doubleColonParts = cleanIp.split("::");
  if (doubleColonParts.length > 2) return null;

  let fullIp = cleanIp;
  if (doubleColonParts.length === 2) {
    const leftParts = doubleColonParts[0] ? doubleColonParts[0].split(":") : [];
    const rightParts = doubleColonParts[1] ? doubleColonParts[1].split(":") : [];
    if (leftParts.includes("") || rightParts.includes("")) return null;

    const missingLength = 8 - (leftParts.length + rightParts.length);
    if (missingLength < 0) return null;

    const middle = new Array(missingLength).fill("0").join(":");
    fullIp = [...leftParts, middle, ...rightParts].filter(Boolean).join(":");
  }

  const parts = fullIp.split(":");
  if (parts.length !== 8) return null;

  if (ipv4Part) {
    const ipv4Val = ipv4ToNumeric(ipv4Part);
    if (ipv4Val === null) return null;
    parts[6] = (ipv4Val >>> 16).toString(16);
    parts[7] = (ipv4Val & 0xffff).toString(16);
  }

  let hexString = "";
  for (const part of parts) {
    if (part === "" || part.length > 4) return null;
    const parsed = parseInt(part, 16);
    if (
      isNaN(parsed) ||
      parsed < 0 ||
      parsed > 0xffff ||
      part.toLowerCase() !== parsed.toString(16).padStart(part.length, "0")
    ) {
      return null;
    }
    hexString += part.padStart(4, "0");
  }

  try {
    return BigInt("0x" + hexString);
  } catch {
    return null;
  }
}

/**
 * Checks if a string is a valid IPv4 address.
 *
 * @param ip - String to test.
 * @returns True if valid IPv4.
 */
export function isIPv4(ip: string): boolean {
  return ipv4ToNumeric(ip) !== null;
}

/**
 * Checks if a string is a valid IPv6 address.
 *
 * @param ip - String to test.
 * @returns True if valid IPv6.
 */
export function isIPv6(ip: string): boolean {
  return ipv6ToBigInt(ip) !== null;
}

/**
 * Parses an IPv4 or IPv6 CIDR string into numeric net and mask representations.
 *
 * @param cidr - The CIDR string (e.g. "192.168.0.0/16" or "2606:4700::/32").
 * @returns Parsed CIDR structure, or null if invalid format.
 */
export function parseCidr(cidr: string): ParsedCidr | null {
  if (!cidr || typeof cidr !== "string") return null;
  const slashIdx = cidr.lastIndexOf("/");
  if (slashIdx === -1) return null;

  const ipPart = cidr.slice(0, slashIdx).trim();
  const prefixStr = cidr.slice(slashIdx + 1).trim();
  const prefixLen = parseInt(prefixStr, 10);
  if (isNaN(prefixLen) || prefixLen < 0) return null;

  if (ipPart.includes(":")) {
    if (prefixLen > 128) return null;
    const ipVal = ipv6ToBigInt(ipPart);
    if (ipVal === null) return null;
    const mask = prefixLen === 0 ? 0n : ((~0n << BigInt(128 - prefixLen)) & ((1n << 128n) - 1n));
    const net = ipVal & mask;
    return { version: 6, net, mask };
  } else {
    if (prefixLen > 32) return null;
    const ipVal = ipv4ToNumeric(ipPart);
    if (ipVal === null) return null;
    const mask = prefixLen === 0 ? 0 : (~0 << (32 - prefixLen)) >>> 0;
    const net = (ipVal & mask) >>> 0;
    return { version: 4, net, mask };
  }
}

/**
 * Checks whether an IP address belongs to a specified CIDR range.
 *
 * @param ip - The IP address string to check (IPv4 or IPv6).
 * @param cidr - The CIDR block string (IPv4 or IPv6).
 * @returns True if the IP is contained within the CIDR range.
 */
export function ipInCidr(ip: string, cidr: string): boolean {
  const parsed = parseCidr(cidr);
  if (!parsed) return false;

  if (parsed.version === 4) {
    const ipVal = ipv4ToNumeric(ip);
    if (ipVal === null) return false;
    return ((ipVal & parsed.mask) >>> 0) === parsed.net;
  } else {
    const ipVal = ipv6ToBigInt(ip);
    if (ipVal === null) return false;
    return (ipVal & parsed.mask) === parsed.net;
  }
}

/**
 * Checks whether an IP address belongs to any of the specified CIDR ranges.
 *
 * @param ip - The IP address string to check.
 * @param cidrs - Array of CIDR strings.
 * @returns True if the IP matches any CIDR range.
 */
export function ipInCidrs(ip: string, cidrs: readonly string[]): boolean {
  return cidrs.some((cidr) => ipInCidr(ip, cidr));
}

/**
 * Compiles a list of CIDR strings into an optimized high-throughput matcher function.
 *
 * @param cidrs - Array of CIDR strings (can contain both IPv4 and IPv6 ranges).
 * @returns A matcher function (ip: string) => boolean.
 */
export function createCidrMatcher(cidrs: readonly string[]): (ip: string) => boolean {
  const v4Ranges: ParsedCidrV4[] = [];
  const v6Ranges: ParsedCidrV6[] = [];

  for (const cidr of cidrs) {
    const parsed = parseCidr(cidr);
    if (parsed) {
      if (parsed.version === 4) {
        v4Ranges.push(parsed);
      } else {
        v6Ranges.push(parsed);
      }
    }
  }

  return (ip: string): boolean => {
    if (!ip) return false;
    if (ip.includes(":")) {
      const ipVal = ipv6ToBigInt(ip);
      if (ipVal === null) return false;
      return v6Ranges.some((r) => (ipVal & r.mask) === r.net);
    } else {
      const ipVal = ipv4ToNumeric(ip);
      if (ipVal === null) return false;
      return v4Ranges.some((r) => ((ipVal & r.mask) >>> 0) === r.net);
    }
  };
}
