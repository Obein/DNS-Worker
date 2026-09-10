import { build, type PlistValue } from 'plist';

/**
 * Generates an Apple Configuration Profile (.mobileconfig) using plist 5.0.0.
 *
 * @param profileKey - The secret token or access point token.
 * @param profileName - The human-readable name of the profile or access point.
 * @param origin - The server origin URL (e.g. https://dns.example.com).
 * @returns The XML plist representation of the MobileConfig.
 */
export function generateMobileConfig(profileKey: string, profileName: string, origin: string): string {
  const dohUrl = `${origin}/${profileKey}`;
  const payloadUUID = crypto.randomUUID();
  const profileUUID = crypto.randomUUID();
  const rawName = profileName?.trim();
  const safeProfileName = rawName || "DNS Worker";
  const cleanOrigin = origin.trim();

  // Prominently display origin and profile name under DNS Worker
  const displayName = rawName && rawName !== "DNS Worker"
    ? `DNS Worker - ${safeProfileName} (${cleanOrigin})`
    : `DNS Worker (${cleanOrigin})`;

  const dohPayloadName = rawName && rawName !== "DNS Worker"
    ? `DNS Worker DoH - ${cleanOrigin} (${safeProfileName})`
    : `DNS Worker DoH - ${cleanOrigin}`;

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
        PayloadDescription: `Configures encrypted DNS over HTTPS (DoH) for ${safeProfileName} via ${cleanOrigin}`,
        PayloadDisplayName: dohPayloadName,
        PayloadIdentifier: `com.apple.dnsSettings.managed.${payloadUUID}`,
        PayloadName: dohPayloadName,
        PayloadType: 'com.apple.dnsSettings.managed',
        PayloadUUID: payloadUUID,
        PayloadVersion: 1,
      },
    ],
    PayloadDescription: `DNS Worker DoH configuration profile for ${safeProfileName} (${cleanOrigin})`,
    PayloadDisplayName: displayName,
    PayloadIdentifier: `com.dnsworker.profile.${profileKey}`,
    PayloadName: displayName,
    PayloadRemovalDisallowed: false,
    PayloadType: 'Configuration',
    PayloadUUID: profileUUID,
    PayloadVersion: 1,
  };

  return build(mobileConfig, { indent: '\t' });
}
