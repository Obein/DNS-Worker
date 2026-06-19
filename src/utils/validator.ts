/**
 * @file validator.ts
 * @description Utility functions for validating inputs and ensuring security.
 * This includes regex patterns for usernames, passwords, access keys, and TOTP tokens,
 * as well as functions to validate URLs against SSRF attacks and check IP address types.
 * 
 * The URL validation function checks for:
 * - Allowed protocols (http, https, tcp)
 * - Forbidden hostnames (localhost, metadata services)
 * - IP addresses in private, loopback, or link-local ranges
 * - Common URL parsing bypass techniques (user info in URLs)
 */

/**
 * Password validation regular expression.
 * Requirements: 12-100 characters containing letters, numbers, and special characters.
 * Allowed special characters: ~`!@#$%^&*()_-+={[}]|\:;"'<,>.?/
 */
export const PASSWORD_REGEX = /^[a-zA-Z\d~`!@#$%^&*()_\-+={[}\]|\\:;"'<,>.?\/]{12,100}$/;
/**
 * Username validation regular expression.
 * Requirements: 5-32 characters, starting with a letter or underscore, followed by letters, numbers, underscores, or hyphens.
 */
export const USERNAME_REGEX = /^[a-z_][a-z0-9_-]{4,31}$/;
/**
 * Access point name validation regular expression.
 * Requirements: 1-30 characters, containing letters, numbers, underscores, or hyphens.
 */
export const AP_NAME_REGEX = /^[a-zA-Z0-9_-]{1,30}$/;
/**
 * Profile name validation regular expression.
 * Requirements: 1-30 characters, containing letters, numbers, underscores, or hyphens.
 */
export const PROFILE_NAME_REGEX = /^[\p{L}\p{N}_ -]{1,30}$/u;
/**
 * Access key validation regular expression.
 * Requirements: 6-12 characters, containing only letters and numbers.
 */
export const ACCESS_KEY_REGEX = /^[a-zA-Z0-9]{6,12}$/;
/**
 * TOTP token validation regular expression.
 * Requirements: exactly 6 digits.
 */
export const TOTP_TOKEN_REGEX = /^\d{6}$/;

const FORBIDDEN_HOSTNAMES = [
  'localhost',
  'metadata.google.internal', // GCP
  '169.254.169.254',          // AWS/GCP/Azure IMDS
];

/**
 * Checks whether the given URL is safe to fetch (prevents SSRF).
 * - Restricts to HTTP/HTTPS/TCP protocols.
 * - Blocks local, loopback, and private IP ranges.
 * - Blocks common metadata hostnames.
 * @param urlString The URL to validate.
 * @returns boolean True if safe, false otherwise.
 */
export function isSafeUrl(urlString: string): boolean {
  try {
    // Allows parsing tcp:// by temporarily pretending it's http:// for URL parser
    const parseableUrl = urlString.startsWith('tcp://') ? urlString.replace('tcp://', 'http://') : urlString;
    const url = new URL(parseableUrl);

    if (FORBIDDEN_HOSTNAMES.includes(url.hostname.toLowerCase())) {
      return false;
    }

    // Check if hostname is an IP and matches forbidden ranges
    if ((isIPv4(url.hostname) || isIPv6(url.hostname)) && !isPublicInternetIP(url.hostname)) {
      return false;
    }

    // Additional safeguard: If it contains special characters often used to bypass parsers
    if (url.hostname.includes('@') || url.username || url.password) {
      return false;
    }

    return true;
  } catch (e) {
    return false; // Invalid URL
  }
}

export function isIPv4(ip: string): boolean {
  return ipv4ToNumeric(ip) !== null;
}

export function isIPv6(ip: string): boolean {
  return ipv6ToBigInt(ip) !== null;
}

export function ipv4ToNumeric(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;

  let hasError = false;
  const val = parts.reduce((ipInt, octet) => {
    const num = Number(octet);
    if (octet === '' || isNaN(num) || num < 0 || num > 255 || String(num) !== octet) {
      hasError = true;
    }
    return (ipInt << 8) + num;
  }, 0) >>> 0;

  return hasError ? null : val;
}

export function ipv6ToBigInt(ip: string): bigint | null {
  let cleanIp = ip.trim().toLowerCase();

  // Extract mapped IPv4 part if present
  let ipv4Part = "";
  if (cleanIp.includes('.')) {
    const lastColon = cleanIp.lastIndexOf(':');
    if (lastColon === -1) return null;
    ipv4Part = cleanIp.substring(lastColon + 1);
    cleanIp = cleanIp.substring(0, lastColon) + ":0:0";
  }

  // A valid IPv6 can only have at most one "::"
  const doubleColonParts = cleanIp.split('::');
  if (doubleColonParts.length > 2) return null;

  let fullIp = cleanIp;
  if (doubleColonParts.length === 2) {
    const leftParts = doubleColonParts[0] ? doubleColonParts[0].split(':') : [];
    const rightParts = doubleColonParts[1] ? doubleColonParts[1].split(':') : [];
    // Ensure we don't have empty strings in left/right parts (consecutive colons)
    if (leftParts.includes('') || rightParts.includes('')) return null;

    const missingLength = 8 - (leftParts.length + rightParts.length);
    if (missingLength < 0) return null;

    const middle = new Array(missingLength).fill('0').join(':');
    fullIp = [...leftParts, middle, ...rightParts].filter(Boolean).join(':');
  }

  const parts = fullIp.split(':');
  if (parts.length !== 8) return null;

  if (ipv4Part) {
    const ipv4Val = ipv4ToNumeric(ipv4Part);
    if (ipv4Val === null) return null;
    parts[6] = (ipv4Val >>> 16).toString(16);
    parts[7] = (ipv4Val & 0xFFFF).toString(16);
  }

  // Validate and pad hex parts
  let hexString = "";
  for (const part of parts) {
    if (part === '' || part.length > 4) return null;
    const parsed = parseInt(part, 16);
    if (
      isNaN(parsed) ||
      parsed < 0 ||
      parsed > 0xFFFF ||
      part.toLowerCase() !== parsed.toString(16).padStart(part.length, '0')
    ) {
      return null;
    }
    hexString += part.padStart(4, '0');
  }

  try {
    return BigInt('0x' + hexString);
  } catch {
    return null;
  }
}

export function isPublicIPv4Val(ipVal: number): boolean {
  // Check private and non-routable ranges using numeric values
  if (ipVal >>> 24 === 0) return false; // 0.0.0.0/8
  if (ipVal >>> 24 === 10) return false; // 10.0.0.0/8
  if (ipVal >= 0x64400000 && ipVal <= 0x647FFFFF) return false; // 100.64.0.0/10
  if (ipVal >>> 24 === 127) return false; // 127.0.0.0/8
  if (ipVal >= 0xA9FE0000 && ipVal <= 0xA9FEFFFF) return false; // 169.254.0.0/16
  if (ipVal >= 0xAC100000 && ipVal <= 0xAC1FFFFF) return false; // 172.16.0.0/12
  if (ipVal >= 0xC0000000 && ipVal <= 0xC00000FF) return false; // 192.0.0.0/24
  if (ipVal >= 0xC0000200 && ipVal <= 0xC00002FF) return false; // 192.0.2.0/24
  if (ipVal >= 0xC0586300 && ipVal <= 0xC05863FF) return false; // 192.88.99.0/24
  if (ipVal >= 0xC0A80000 && ipVal <= 0xC0A8FFFF) return false; // 192.168.0.0/16
  if (ipVal >= 0xC6120000 && ipVal <= 0xC613FFFF) return false; // 198.18.0.0/15
  if (ipVal >= 0xC6336400 && ipVal <= 0xC63367FF) return false; // 198.51.100.0/22
  if (ipVal >= 0xCB007100 && ipVal <= 0xCB0071FF) return false; // 203.0.113.0/24
  if (ipVal >= 0xE0000000) return false; // 224.0.0.0/4 (Multicast) & 240.0.0.0/4 (Reserved)

  return true;
}

export function isPublicInternetIP(ip: string): boolean {
  if (!ip) return false;

  if (ip.includes('.')) {
    // Could be IPv4 or IPv4-mapped IPv6
    if (ip.includes(':')) {
      const ipv6Val = ipv6ToBigInt(ip);
      if (ipv6Val === null) return false;
      // Check if it's IPv4-mapped IPv6 (::ffff:0:0/96)
      if (ipv6Val >> 32n === 0xffffn) {
        const ipv4Val = Number(ipv6Val & 0xffffffffn);
        return isPublicIPv4Val(ipv4Val);
      }
      return false; // Other IPv4-mapped forms or invalid
    } else {
      const ipv4Val = ipv4ToNumeric(ip);
      if (ipv4Val === null) return false;
      return isPublicIPv4Val(ipv4Val);
    }
  }

  if (ip.includes(':')) {
    const ipv6Val = ipv6ToBigInt(ip);
    if (ipv6Val === null) return false;

    // Unspecified (::)
    if (ipv6Val === 0n) return false;
    // Loopback (::1)
    if (ipv6Val === 1n) return false;
    // fc00::/7 (Unique Local Address)
    if (ipv6Val >> 121n === 0x7en) return false;
    // fe80::/10 (Link-Local)
    if (ipv6Val >> 118n === 0x3fan) return false;
    // ff00::/8 (Multicast)
    if (ipv6Val >> 120n === 0xffn) return false;

    return true;
  }

  return false;
}
