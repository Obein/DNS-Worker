/**
 * System and deployment runtime configuration types.
 */

export type DeploymentMode = 'serverfull' | 'cloudflare';

export interface DnsWorkerConfig {
  nonce?: string;
  isDbMissing?: boolean;
  isJwtSecretMissing?: boolean;
  isServerfull?: boolean;
  mode?: DeploymentMode;
}

declare global {
  interface Window {
    DNS_WORKER_CONFIG?: DnsWorkerConfig;
  }
}

export interface DomainDnsIps {
  ipv4: string[];
  ipv6: string[];
}
