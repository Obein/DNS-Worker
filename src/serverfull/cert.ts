/**
 * @file cert.ts
 * @description TLS certificate validation, wildcard detection, and certbot guidance utilities for Serverfull mode.
 */

import fs from 'node:fs';
import crypto from 'node:crypto';
import { formatDiagnostic, DiagnosticConfig } from './format';

export interface TlsCertificateInfo {
  configured: boolean;
  filesExist: boolean;
  certPath: string;
  keyPath: string;
  isWildcard: boolean;
  domains: string[];
  expiresAt: Date | null;
  error?: string;
}

/**
 * Inspects certificate files on disk and checks if they contain a wildcard domain (*.domain).
 *
 * @param certPath - Path to certificate PEM file.
 * @param keyPath - Path to private key PEM file.
 * @returns TlsCertificateInfo with detailed inspection results.
 */
export function inspectTlsCertificate(certPath: string, keyPath: string): TlsCertificateInfo {
  const configured = Boolean(certPath && keyPath);
  if (!configured) {
    return {
      configured: false,
      filesExist: false,
      certPath: certPath || '',
      keyPath: keyPath || '',
      isWildcard: false,
      domains: [],
      expiresAt: null
    };
  }

  const filesExist = fs.existsSync(certPath) && fs.existsSync(keyPath);
  if (!filesExist) {
    return {
      configured: true,
      filesExist: false,
      certPath,
      keyPath,
      isWildcard: false,
      domains: [],
      expiresAt: null
    };
  }

  try {
    const certContent = fs.readFileSync(certPath, 'utf-8');
    const x509 = new crypto.X509Certificate(certContent);

    const domains: string[] = [];
    let isWildcard = false;

    // Check Subject Alternative Names (SANs)
    if (x509.subjectAltName) {
      const parts = x509.subjectAltName.split(',').map((p) => p.trim());
      for (const part of parts) {
        if (part.startsWith('DNS:')) {
          const d = part.slice(4).trim().toLowerCase();
          if (!domains.includes(d)) {
            domains.push(d);
          }
          if (d.startsWith('*.')) {
            isWildcard = true;
          }
        }
      }
    }

    // Check Common Name (CN) from subject if not already captured
    if (x509.subject) {
      const match = x509.subject.match(/CN=([^,\n\/]+)/i);
      if (match) {
        const cn = match[1].trim().toLowerCase();
        if (!domains.includes(cn)) {
          domains.push(cn);
        }
        if (cn.startsWith('*.')) {
          isWildcard = true;
        }
      }
    }

    const expiresAt = new Date(x509.validTo);

    return {
      configured: true,
      filesExist: true,
      certPath,
      keyPath,
      isWildcard,
      domains,
      expiresAt
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      configured: true,
      filesExist: true,
      certPath,
      keyPath,
      isWildcard: false,
      domains: [],
      expiresAt: null,
      error: errorMsg
    };
  }
}

/**
 * Builds the canonical certbot wildcard registration command.
 *
 * @param targetDomain - Base domain or fallback to 'your.domain'.
 * @returns Shell command string for certbot DNS challenge.
 */
export function getCertbotCommand(targetDomain?: string): string {
  const cleanDomain = targetDomain ? targetDomain.replace(/^\*\./, '').trim() : 'your.domain';
  return `certbot certonly -d *.${cleanDomain} --manual --preferred-challenges dns`;
}

/**
 * Generates formatted diagnostic guidance for obtaining or upgrading a TLS certificate via Certbot.
 *
 * @param reason - 'missing' | 'non_wildcard'
 * @param targetDomain - Optional base domain to personalize the command.
 * @returns DiagnosticOptions formatted for formatDiagnostic().
 */
export function getCertbotDiagnosticOptions(
  reason: 'missing' | 'non_wildcard',
  targetDomain?: string
): DiagnosticConfig {
  const cmd = getCertbotCommand(targetDomain);

  if (reason === 'missing') {
    return {
      level: 'warning',
      title: 'TLS Certificate Not Configured / Missing',
      message: 'No valid TLS certificate detected. HTTPS Web UI (port 10443) and DoT (port 853) are disabled.',
      details: [
        'Plain HTTP Web UI (port 10080) and Classic UDP DNS (port 53) remain fully operational.'
      ],
      solutions: [
        'To enable HTTPS and DoT with per-profile routing, register a free wildcard certificate using certbot:',
        `  ${cmd}`,
        'Then configure SERVERFULL_TLS_CERT_PATH and SERVERFULL_TLS_KEY_PATH in your .env file.'
      ]
    };
  }

  return {
    level: 'info',
    title: 'Non-Wildcard TLS Certificate Detected',
    message: 'The current certificate is valid for single domains, but does not cover wildcard subdomains (*.domain).',
    details: [
      'Single-domain certificates will route all incoming DoT queries to your default profile.',
      'To enable per-profile Android Private DNS routing (<profileKey>.your.domain), a wildcard certificate is recommended.'
    ],
    solutions: [
      'You can register a wildcard certificate using Certbot via DNS challenge:',
      `  ${cmd}`,
      'Then update SERVERFULL_TLS_CERT_PATH and SERVERFULL_TLS_KEY_PATH.'
    ]
  };
}
