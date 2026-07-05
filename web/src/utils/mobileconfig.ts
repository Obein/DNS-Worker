export function generateMobileConfig(profileKey: string, profileName: string, origin: string): string {
  const dohUrl = `${origin}/${profileKey}`;
  const payloadUUID = crypto.randomUUID();
  const profileUUID = crypto.randomUUID();
  
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
			<string>DNS Worker protects your network traffic</string>
			<key>PayloadDisplayName</key>
			<string>Obex DoH (${profileName})</string>
			<key>PayloadIdentifier</key>
			<string>com.apple.dnsSettings.managed.${payloadUUID}</string>
			<key>PayloadName</key>
			<string>Obex DoH (${profileName})</string>
			<key>PayloadType</key>
			<string>com.apple.dnsSettings.managed</string>
			<key>PayloadUUID</key>
			<string>${payloadUUID}</string>
			<key>PayloadVersion</key>
			<integer>1</integer>
		</dict>
	</array>
	<key>PayloadDescription</key>
	<string>DNS Worker protects your network traffic</string>
	<key>PayloadDisplayName</key>
	<string>Obex - ${profileName}</string>
	<key>PayloadIdentifier</key>
	<string>obex.dns.profile</string>
	<key>PayloadName</key>
	<string>Obex - ${profileName}</string>
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
