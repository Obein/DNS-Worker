/**
 * Escapes special XML characters to prevent malformed mobileconfig plist payloads.
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function generateMobileConfig(profileKey: string, profileName: string, origin: string): string {
  const dohUrl = `${origin}/${profileKey}`;
  const payloadUUID = crypto.randomUUID();
  const profileUUID = crypto.randomUUID();
  const rawName = profileName?.trim();
  const safeProfileName = escapeXml(rawName || "DNS Worker");
  const safeOrigin = escapeXml(origin.trim());

  // Prominently display origin and profile name under DNS Worker
  const displayName = rawName && rawName !== "DNS Worker"
    ? `DNS Worker - ${safeProfileName} (${safeOrigin})`
    : `DNS Worker (${safeOrigin})`;

  const dohPayloadName = rawName && rawName !== "DNS Worker"
    ? `DNS Worker DoH - ${safeOrigin} (${safeProfileName})`
    : `DNS Worker DoH - ${safeOrigin}`;
  
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>PayloadContent</key>
	<array>
		<dict>
			<key>DNSSettings</key>
			<dict>
				<key>DNSProtocol</key>
				<string>HTTPS</string>
				<key>ServerHTTPVersion</key>
				<string>3</string>
				<key>ServerURL</key>
				<string>${dohUrl}</string>
			</dict>
			<key>OnDemandRules</key>
			<array>
				<dict>
					<key>Action</key>
					<string>Connect</string>
					<key>InterfaceTypeMatch</key>
					<string>WiFi</string>
				</dict>
				<dict>
					<key>Action</key>
					<string>Connect</string>
					<key>InterfaceTypeMatch</key>
					<string>Cellular</string>
				</dict>
				<dict>
					<key>Action</key>
					<string>Disconnect</string>
				</dict>
			</array>
			<key>PayloadDescription</key>
			<string>Configures encrypted DNS over HTTPS (DoH) for ${safeProfileName} via ${safeOrigin}</string>
			<key>PayloadDisplayName</key>
			<string>${dohPayloadName}</string>
			<key>PayloadIdentifier</key>
			<string>com.apple.dnsSettings.managed.${payloadUUID}</string>
			<key>PayloadName</key>
			<string>${dohPayloadName}</string>
			<key>PayloadType</key>
			<string>com.apple.dnsSettings.managed</string>
			<key>PayloadUUID</key>
			<string>${payloadUUID}</string>
			<key>PayloadVersion</key>
			<integer>1</integer>
		</dict>
	</array>
	<key>PayloadDescription</key>
	<string>DNS Worker DoH configuration profile for ${safeProfileName} (${safeOrigin})</string>
	<key>PayloadDisplayName</key>
	<string>${displayName}</string>
	<key>PayloadIdentifier</key>
	<string>com.dnsworker.profile.${profileKey}</string>
	<key>PayloadName</key>
	<string>${displayName}</string>
	<key>PayloadRemovalDisallowed</key>
	<false/>
	<key>PayloadType</key>
	<string>Configuration</string>
	<key>PayloadUUID</key>
	<string>${profileUUID}</string>
	<key>PayloadVersion</key>
	<integer>1</integer>
</dict>
</plist>`;
}
