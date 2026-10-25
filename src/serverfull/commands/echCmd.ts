/**
 * @file echCmd.ts
 * @description Subcommand handler for `dns-worker ech`, displaying ECH parameters and RFC 9460 records.
 */

import { getServerfullConfig, ServerfullCliArgs } from '../config';
import { formatBanner, formatKeyValueSection, formatTip } from '../format';
import { buildCloudflareEchConfig } from '../../utils/ech';

/**
 * Handles `dns-worker ech` command, printing active ECH configuration, outer SNI, and RFC 9460 DNS records.
 *
 * @param cliArgs - Optional parsed CLI arguments.
 */
export function handleEchCommand(cliArgs?: ServerfullCliArgs): void {
  const { config } = getServerfullConfig(cliArgs);
  const frontingDomain = config.echFrontingDomain || 'cloudflare-ech.com';
  const echConfigBase64 = config.echConfig || buildCloudflareEchConfig(frontingDomain);
  const domain = config.dotDomain || 'dns.example.com';

  const banner = formatBanner({
    title: 'Encrypted Client Hello (ECH) & DNS Service Records',
    borderChar: '=',
    bullet: '• '
  });

  const section = formatKeyValueSection({
    title: '\nActive ECH Configuration & Outer SNI:',
    items: [
      { label: 'ECH Status', value: config.echEnabled ? 'Enabled (Active)' : 'Disabled' },
      { label: 'Fronting Domain (Outer SNI)', value: frontingDomain },
      { label: 'ECHConfigList (Base64)', value: echConfigBase64 },
      { label: 'Target Base Domain', value: domain },
      { label: 'HTTPS (H3) Port', value: String(config.httpsPort) },
      { label: 'DoT / DoQ Port', value: String(config.dotPort) }
    ]
  });

  const ddrRecord = `_dns.${domain}. 300 IN SVCB 1 . alpn="doq,dot" port=${config.dotPort} ech="${echConfigBase64}"`;
  const httpsRecord = `${domain}. 300 IN HTTPS 1 . alpn="h3,h2" port=${config.httpsPort} ech="${echConfigBase64}"`;

  const dnsSection = `\nStandard DNS Service Binding Records (RFC 9460 & RFC 9460 Section 8 DDR):
  • DDR SVCB Record (DoQ/DoT auto-discovery):
    ${ddrRecord}

  • HTTPS Service Record (HTTP/3 & ECH):
    ${httpsRecord}`;

  const tip = formatTip([
    'Publish the DDR SVCB record in your authoritative DNS zone to enable automatic DoQ & DoT discovery.',
    'Publish the HTTPS record to enable browser HTTP/3 (h3) and ECH negotiation without SNI leakage.',
    `Test client ECH support with: curl --ech true https://${domain}`
  ]);

  console.log([banner, section, dnsSection, tip].join('\n'));
}
