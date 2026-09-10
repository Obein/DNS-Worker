/**
 * @file dnsStamp.ts
 * @description RFC draft DNS Stamp (sdns://) parser for DNS Worker.
 * Decodes base64url DNS stamps into structured resolver configurations (DoH, DoT, Plain DNS, DNSCrypt).
 */

export interface DnsStamp {
  /** Resolved protocol type */
  protocol: 'dns' | 'dnscrypt' | 'doh' | 'dot' | 'doq' | 'odoh' | 'unknown';
  /** Raw protocol identifier byte */
  protocolId: number;
  /** Properties flags (DNSSEC, No-Log, No-Filter) */
  props: bigint;
  /** Server IP address or IP:port (optional in stamps) */
  serverAddress?: string;
  /** Hostname (SNI / vhost) */
  hostname?: string;
  /** URL path (for DoH/ODoH) */
  path?: string;
  /** SHA-256 certificate hashes (if present) */
  hashes?: string[];
  /** Provider name (for DNSCrypt) */
  providerName?: string;
  /** Equivalent standard URL (https://..., tls://..., tcp://...) */
  resolvedUrl: string;
}

/**
 * Decodes a DNS Stamp (sdns://...) into its protocol components and resolved URL.
 *
 * @param stampStr - The DNS Stamp string starting with sdns://
 * @returns Parsed DnsStamp object
 * @throws Error if stamp format or base64 decoding is invalid
 */
export function parseDnsStamp(stampStr: string): DnsStamp {
  const clean = stampStr.trim();
  if (!clean.startsWith('sdns://')) {
    throw new Error('Invalid DNS Stamp: must start with sdns://');
  }

  const b64 = clean.slice(7).replace(/=+$/, '');
  let binaryStr: string;

  if (typeof Buffer !== 'undefined') {
    binaryStr = Buffer.from(b64, 'base64url').toString('latin1');
  } else {
    // Cloudflare Workers Web runtime: URL-safe base64 conversion
    const standardB64 = b64.replace(/-/g, '+').replace(/_/g, '/');
    const padLen = standardB64.length % 4;
    const padded = padLen ? standardB64 + '='.repeat(4 - padLen) : standardB64;
    binaryStr = atob(padded);
  }

  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }

  if (bytes.length < 9) {
    throw new Error('DNS Stamp payload too short (minimum 9 bytes)');
  }

  let offset = 0;
  const protocolId = bytes[offset++];

  // 8 bytes props (little-endian uint64)
  let props = 0n;
  for (let i = 0; i < 8; i++) {
    props |= BigInt(bytes[offset++]) << BigInt(i * 8);
  }

  const readLpString = (): string => {
    if (offset >= bytes.length) return '';
    const len = bytes[offset++];
    if (offset + len > bytes.length) return '';
    const strBytes = bytes.slice(offset, offset + len);
    offset += len;
    return new TextDecoder().decode(strBytes);
  };

  const readHashes = (): string[] => {
    const hashes: string[] = [];
    while (offset < bytes.length) {
      const hLen = bytes[offset++];
      if (hLen === 0) break;
      const actualLen = hLen & 0x7f;
      if (offset + actualLen > bytes.length) break;
      const hashBytes = bytes.slice(offset, offset + actualLen);
      offset += actualLen;
      hashes.push(Array.from(hashBytes).map(b => b.toString(16).padStart(2, '0')).join(''));
      if ((hLen & 0x80) === 0) break;
    }
    return hashes;
  };

  let protocol: DnsStamp['protocol'] = 'unknown';
  let serverAddress: string | undefined;
  let hostname: string | undefined;
  let path: string | undefined;
  let hashes: string[] | undefined;
  let providerName: string | undefined;
  let resolvedUrl = '';

  switch (protocolId) {
    case 0x00: { // Plain DNS
      protocol = 'dns';
      serverAddress = readLpString();
      if (serverAddress) {
        resolvedUrl = serverAddress.includes(':') && !serverAddress.startsWith('[')
          ? `tcp://${serverAddress}`
          : `tcp://${serverAddress}:53`;
      }
      break;
    }
    case 0x01: { // DNSCrypt
      protocol = 'dnscrypt';
      serverAddress = readLpString();
      offset += 32; // Skip 32-byte provider public key
      providerName = readLpString();
      resolvedUrl = `dnscrypt://${providerName || serverAddress}`;
      break;
    }
    case 0x02: { // DoH (DNS over HTTPS)
      protocol = 'doh';
      serverAddress = readLpString();
      hashes = readHashes();
      hostname = readLpString();
      path = readLpString() || '/dns-query';
      const host = hostname || serverAddress;
      if (!path.startsWith('/')) path = `/${path}`;
      resolvedUrl = `https://${host}${path}`;
      break;
    }
    case 0x03: { // DoT (DNS over TLS)
      protocol = 'dot';
      serverAddress = readLpString();
      hashes = readHashes();
      hostname = readLpString();
      const host = hostname || serverAddress;
      const port = serverAddress && serverAddress.includes(':') ? serverAddress.split(':').pop() : '853';
      resolvedUrl = host?.includes(':') ? `tls://${host}` : `tls://${host}:${port}`;
      break;
    }
    case 0x04: { // DoQ (DNS over QUIC)
      protocol = 'doq';
      serverAddress = readLpString();
      hashes = readHashes();
      hostname = readLpString();
      resolvedUrl = `quic://${hostname || serverAddress}:853`;
      break;
    }
    case 0x05: { // Oblivious DoH Target
      protocol = 'odoh';
      serverAddress = readLpString();
      hashes = readHashes();
      hostname = readLpString();
      path = readLpString() || '/dns-query';
      resolvedUrl = `https://${hostname || serverAddress}${path}`;
      break;
    }
    default:
      resolvedUrl = clean;
      break;
  }

  return {
    protocol,
    protocolId,
    props,
    serverAddress: serverAddress || undefined,
    hostname: hostname || undefined,
    path: path || undefined,
    hashes: hashes && hashes.length > 0 ? hashes : undefined,
    providerName: providerName || undefined,
    resolvedUrl
  };
}
