import { build, type PlistValue } from 'plist';

/**
 * Configuration options for generating an Apple MobileConfig profile.
 */
export interface GenerateMobileConfigOptions {
  /** The secret token or access point token. */
  profileKey: string;
  /** The human-readable name of the profile (e.g. "Default", "Family"). */
  profileName?: string;
  /** The human-readable name of the access point (e.g. "iPhone", "MacBook"). */
  accessPointName?: string;
  /** The server origin URL (e.g. "https://dns.example.com"). */
  origin: string;
}

/**
 * Extracts pure domain (hostname) from an origin URL or host string.
 *
 * @example
 * extractDomain("https://dns.example.com") // "dns.example.com"
 * extractDomain("http://localhost:5173") // "localhost"
 * extractDomain("https://dns.example.com:8443") // "dns.example.com"
 */
export function extractDomain(origin: string): string {
  const trimmed = origin.trim();
  try {
    const url = new URL(trimmed.startsWith('http://') || trimmed.startsWith('https://') ? trimmed : `https://${trimmed}`);
    return url.hostname || trimmed;
  } catch {
    return trimmed.replace(/^https?:\/\//, '').split('/')[0].split(':')[0] || trimmed;
  }
}

/**
 * Formats profile name and access point name cleanly without nested parentheses.
 *
 * @example
 * formatProfileLabel("Default", "iPhone") // "Default - iPhone"
 * formatProfileLabel("Default", "Default") // "Default"
 * formatProfileLabel("DNS Worker", "iPhone") // "iPhone"
 * formatProfileLabel("Default (iPhone)", undefined) // "Default - iPhone" (legacy unpack)
 */
export function formatProfileLabel(profileName?: string, accessPointName?: string): string {
  let p = (profileName || '').trim();
  let ap = (accessPointName || '').trim();

  // If a compound string with nested parentheses was passed in legacy calls (e.g., "Default (iPhone)")
  if (!ap && p.includes('(') && p.endsWith(')')) {
    const match = p.match(/^(.+?)\s*\((.+?)\)$/);
    if (match) {
      p = match[1].trim();
      ap = match[2].trim();
    }
  }

  const cleanP = p && p !== 'DNS Worker' ? p : '';
  const cleanAp = ap && ap !== 'DNS Worker' ? ap : '';

  if (cleanP && cleanAp) {
    if (cleanP.toLowerCase() === cleanAp.toLowerCase()) {
      return cleanP;
    }
    return `${cleanP} - ${cleanAp}`;
  }

  return cleanP || cleanAp || '';
}

/**
 * Generates an Apple Configuration Profile (.mobileconfig) using plist 5.0.0.
 *
 * Supports both object options parameter and legacy positional arguments.
 *
 * @param profileKeyOrOptions - Token string or options object.
 * @param profileName - Optional profile name (when using positional arguments).
 * @param origin - Origin URL (when using positional arguments).
 * @param accessPointName - Optional access point name (when using positional arguments).
 * @returns The XML plist representation of the MobileConfig.
 */
export function generateMobileConfig(
  profileKeyOrOptions: string | GenerateMobileConfigOptions,
  profileName?: string,
  origin?: string,
  accessPointName?: string
): string {
  let key: string;
  let pName: string | undefined;
  let apName: string | undefined;
  let rawOrigin: string;

  if (typeof profileKeyOrOptions === 'object') {
    key = profileKeyOrOptions.profileKey;
    pName = profileKeyOrOptions.profileName;
    apName = profileKeyOrOptions.accessPointName;
    rawOrigin = profileKeyOrOptions.origin;
  } else {
    key = profileKeyOrOptions;
    pName = profileName;
    rawOrigin = origin || '';
    apName = accessPointName;
  }

  const cleanOrigin = rawOrigin.trim();
  const domain = extractDomain(cleanOrigin);
  const dohUrl = `${cleanOrigin}/${key}`;
  const label = formatProfileLabel(pName, apName);
  const payloadUUID = crypto.randomUUID();
  const profileUUID = crypto.randomUUID();

  // Outer profile display name (visible in iOS Profiles / VPN & Management)
  const displayName = label
    ? `DNS Worker - ${domain} (${label})`
    : `DNS Worker (${domain})`;

  // Inner DoH DNS Settings payload name (visible in iOS DNS provider selection)
  const dohPayloadName = label
    ? `DNS Worker DoH - ${domain} (${label})`
    : `DNS Worker DoH - ${domain}`;

  // Human-readable descriptions with no nested parentheses
  const description = label
    ? `DNS Worker DoH configuration profile for ${label} via ${domain}`
    : `DNS Worker DoH configuration profile via ${domain}`;

  const payloadDescription = label
    ? `Configures encrypted DNS over HTTPS (DoH) for ${label} via ${domain}`
    : `Configures encrypted DNS over HTTPS (DoH) via ${domain}`;

  const mobileConfig: PlistValue = {
    PayloadContent: [
      {
        DNSSettings: {
          DNSProtocol: 'HTTPS',
          ServerHTTPVersion: 3,
          ServerURL: dohUrl,
        },
        OnDemandRules: [
          {
            Action: 'Connect',
            InterfaceTypeMatch: 'WiFi',
          },
          {
            Action: 'Connect',
            InterfaceTypeMatch: 'Cellular',
          },
          {
            Action: 'Disconnect',
          },
        ],
        PayloadDescription: payloadDescription,
        PayloadDisplayName: dohPayloadName,
        PayloadIdentifier: `com.apple.dnsSettings.managed.${payloadUUID}`,
        PayloadName: dohPayloadName,
        PayloadType: 'com.apple.dnsSettings.managed',
        PayloadUUID: payloadUUID,
        PayloadVersion: 1,
      },
    ],
    PayloadDescription: description,
    PayloadDisplayName: displayName,
    PayloadIdentifier: `com.dnsworker.profile.${key}`,
    PayloadName: displayName,
    PayloadRemovalDisallowed: false,
    PayloadType: 'Configuration',
    PayloadUUID: profileUUID,
    PayloadVersion: 1,
  };

  return build(mobileConfig, { indent: '\t' });
}
