/**
 * @file presets.ts
 * @description Built-in canonical fallback presets and defaults for DNS Worker.
 * Ensures the system is fully functional out-of-the-box (zero-config) without external .env files.
 */

export interface PresetUpstream {
  label: string;
  url: string;
}

export interface PresetFilter {
  label: string;
  url: string;
}

export interface PresetRegionIp {
  ip: string;
  area: string;
}

/**
 * Built-in default preset upstream DNS servers.
 */
export const DEFAULT_PRESET_UPSTREAMS: readonly PresetUpstream[] = [
  { label: 'settings.presetCloudflareSecurity', url: 'https://security.cloudflare-dns.com/dns-query' },
  { label: 'settings.presetCloudflareFamilies', url: 'https://family.cloudflare-dns.com/dns-query' },
  { label: 'Cloudflare', url: 'https://cloudflare-dns.com/dns-query' },
  { label: 'settings.presetQuad9', url: 'https://dns.quad9.net/dns-query' },
  { label: 'settings.presetQuad9Ecs', url: 'https://dns11.quad9.net/dns-query' },
  { label: 'settings.presetControlDFree', url: 'https://freedns.controld.com/no-ads-malware-typo' },
  { label: 'settings.presetControlDUncensored', url: 'https://freedns.controld.com/uncensored' },
  { label: 'settings.presetAdGuard', url: 'https://dns.adguard-dns.com/dns-query' },
  { label: 'settings.presetAdGuardFamily', url: 'https://family.adguard-dns.com/dns-query' },
  { label: 'Cloudflare Security (1.1.1.2)', url: 'tcp://1.1.1.2:53' },
  { label: 'Cloudflare (1.1.1.1)', url: 'tcp://1.1.1.1:53' },
  { label: 'Quad9 ECS (9.9.9.11)', url: 'tcp://9.9.9.11:9953' },
  { label: 'Google (8.8.8.8)', url: 'tcp://8.8.8.8:53' }
];

/**
 * Built-in default preset blocklists and external filters.
 */
export const DEFAULT_PRESET_EXTERNAL_FILTERS: readonly PresetFilter[] = [
  { label: 'filtering.presetOisdBig', url: 'https://big.oisd.nl' },
  { label: 'filtering.presetOisdNsfw', url: 'https://nsfw.oisd.nl' },
  { label: 'filtering.presetAdGuard', url: 'https://adguardteam.github.io/AdguardFilters/BaseFilter/sections/adservers.txt' },
  { label: 'filtering.presetStevenBlack', url: 'https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts' }
];

/**
 * Built-in default region IPs for substitute domain mapping (China/Asia-Pacific fallback).
 */
export const DEFAULT_IP_REGION_CN: readonly PresetRegionIp[] = [
  { ip: '198.41.222.102', area: 'SG' },
  { ip: '173.245.59.246', area: 'SG' },
  { ip: '104.18.47.174', area: 'HK' },
  { ip: '104.19.50.3', area: 'HK' }
];

/**
 * Built-in default substitute domain for resolving DoH IPs.
 */
export const DEFAULT_SUBSTITUTE_DOMAIN = 'www.okx.com';

/**
 * Built-in default fail-open upstream address.
 */
export const DEFAULT_FAIL_OPEN_UPSTREAM = 'https://freedns.controld.com/no-ads-malware-typo';
