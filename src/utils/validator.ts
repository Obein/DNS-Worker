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

import { isIPv4, isIPv6, createCidrMatcher } from "./cidr";

export { isIPv4, isIPv6 } from "./cidr";

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
 * Hardcoded standard private, loopback, link-local, multicast, and reserved CIDR ranges
 * for IPv4 and IPv6 according to RFC 6890, RFC 1918, RFC 6598, RFC 4291, RFC 4193, etc.
 */
export const PRIVATE_AND_RESERVED_CIDRS: readonly string[] = [
  // IPv4 Special/Private Ranges
  "0.0.0.0/8",         // "This host on this network" (RFC 1122)
  "10.0.0.0/8",        // Private-Use (RFC 1918)
  "100.64.0.0/10",     // Shared Address Space / CGNAT (RFC 6598)
  "127.0.0.0/8",       // Loopback (RFC 1122)
  "169.254.0.0/16",    // Link-Local (RFC 3927)
  "172.16.0.0/12",     // Private-Use (RFC 1918)
  "192.0.0.0/24",      // IETF Protocol Assignments (RFC 6890)
  "192.0.2.0/24",      // TEST-NET-1 (RFC 5737)
  "192.88.99.0/24",    // 6to4 Relay Anycast (RFC 3068)
  "192.168.0.0/16",    // Private-Use (RFC 1918)
  "198.18.0.0/15",     // Benchmarking (RFC 2544)
  "198.51.100.0/24",   // TEST-NET-2 (RFC 5737)
  "203.0.113.0/24",    // TEST-NET-3 (RFC 5737)
  "224.0.0.0/4",       // Multicast (RFC 5771)
  "240.0.0.0/4",       // Reserved (RFC 1112)
  "255.255.255.255/32",// Limited Broadcast (RFC 919)

  // IPv6 Special/Private Ranges
  "::/128",            // Unspecified (RFC 4291)
  "::1/128",           // Loopback (RFC 4291)
  "64:ff9b::/96",      // IPv4-IPv6 Translation (RFC 6052)
  "100::/64",          // Discard Prefix (RFC 6666)
  "2001:db8::/32",     // Documentation (RFC 3849)
  "fc00::/7",          // Unique Local (RFC 4193)
  "fe80::/10",         // Link-Local (RFC 4291)
  "ff00::/8"           // Multicast (RFC 4291)
];

const isPrivateOrReservedIp: (ip: string) => boolean = createCidrMatcher(PRIVATE_AND_RESERVED_CIDRS);

/**
 * Checks whether an IP address is a publicly routable Internet IP.
 * Uses CIDR matching against standard private and reserved IP blocks.
 * Handles IPv4, IPv6, and IPv4-mapped IPv6 (::ffff:x.x.x.x).
 *
 * @param ip - The IP string to validate.
 * @returns True if public Internet IP, false if private, reserved, or invalid.
 */
export function isPublicInternetIP(ip: string): boolean {
  if (!ip || typeof ip !== "string") return false;

  const cleanIp = ip.trim();

  // If IPv4-mapped IPv6 (e.g. ::ffff:192.168.1.1)
  if (cleanIp.includes(":") && cleanIp.includes(".")) {
    const lastColon = cleanIp.lastIndexOf(":");
    const ipv4Part = cleanIp.substring(lastColon + 1);
    if (!isIPv4(ipv4Part)) return false;
    return !isPrivateOrReservedIp(ipv4Part);
  }

  // Validate that it's a valid IPv4 or IPv6
  if (!isIPv4(cleanIp) && !isIPv6(cleanIp)) {
    return false;
  }

  return !isPrivateOrReservedIp(cleanIp);
}

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
    let parseableUrl: string;
    if (urlString.startsWith('tcp://')) {
      parseableUrl = urlString.replace('tcp://', 'http://');
    } else if (urlString.startsWith('http://') || urlString.startsWith('https://')) {
      parseableUrl = urlString;
    } else {
      parseableUrl = `http://${urlString}`;
    }

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
