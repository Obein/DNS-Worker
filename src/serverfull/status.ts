/**
 * @file status.ts
 * @description Runtime status and service diagnostic inspector for Serverfull mode.
 * Re-exports probe and database inspection utilities.
 */

import {
  ServerfullConfig,
  getDefaultDataDir,
  getDefaultConfigDir,
  getDefaultConfigFilePath,
  getLoadedEnvFiles
} from './config';
import { formatBanner, formatKeyValueSection, formatTip } from './format';
import { getPortOccupant, formatOccupantSummary } from './port';
import { isUsableJwtSecret, isStrongJwtSecret } from '../lib/jwt';
import { inspectTlsCertificate, getCertbotCommand } from './cert';
import { maskDatabaseUrl } from '../lib/turso';
import { probeTcpPort, probeUdpPort } from './status/probe';
import { inspectDatabase, inspectTursoDatabase } from './status/database';

export * from './status/probe';
export * from './status/database';

/**
 * Inspects all Serverfull service ports, database, and configurations, printing a declarative status report.
 *
 * @param config - The parsed serverfull configuration.
 * @param envJwtSecret - The JWT_SECRET environment variable value.
 */
export async function showServerfullStatus(config: ServerfullConfig, envJwtSecret?: string): Promise<void> {
  const certInfo = inspectTlsCertificate(config.tlsCertPath, config.tlsKeyPath);
  const canProbeHttps = !config.disableHttps && certInfo.configured && certInfo.filesExist;
  const isTurso = config.databaseService === 'Turso';
  const dbStatusPromise = isTurso
    ? (config.tursoDatabaseUrl && config.tursoAuthToken
        ? inspectTursoDatabase(config.tursoDatabaseUrl, config.tursoAuthToken)
        : Promise.resolve({ exists: false, statusText: 'Configuration Error (TURSO_DATABASE_URL or TURSO_AUTH_TOKEN missing)' }))
    : Promise.resolve(inspectDatabase(config.dbPath));

  const [httpState, httpsState, udpState, dotState, dbStatus] = await Promise.all([
    probeTcpPort(config.httpPort, config.host),
    canProbeHttps ? probeTcpPort(config.httpsPort, config.host) : Promise.resolve('disabled' as const),
    !config.disableUdp ? probeUdpPort(config.udpPort, config.host) : Promise.resolve('disabled' as const),
    !config.disableDot ? probeTcpPort(config.dotPort, config.host) : Promise.resolve('disabled' as const),
    dbStatusPromise
  ]);

  let jwtStatus = 'Default (Insecure fallback, please configure JWT_SECRET)';
  if (isUsableJwtSecret(envJwtSecret)) {
    jwtStatus = isStrongJwtSecret(envJwtSecret)
      ? 'Configured (Strong, >= 32 characters)'
      : 'Configured (Warning: Shorter than 32 characters)';
  }

  const httpOccupant = httpState === 'active' ? getPortOccupant(config.httpPort, 'TCP') : null;
  const httpOccupantText = httpOccupant ? `: ${formatOccupantSummary(httpOccupant)}` : '';
  const httpStatusText = httpState === 'active'
    ? `http://${config.host}:${config.httpPort} [Active / Listening${httpOccupantText}]`
    : `http://${config.host}:${config.httpPort} [Stopped / Port Available]`;

  let httpsStatusText = '';
  if (config.disableHttps) {
    httpsStatusText = 'Disabled (--disable-https)';
  } else if (!certInfo.configured) {
    httpsStatusText = `https://${config.host}:${config.httpsPort} [Disabled - TLS Certificates Not Configured]`;
  } else if (!certInfo.filesExist) {
    httpsStatusText = `https://${config.host}:${config.httpsPort} [Warning - TLS Certificate Files Missing]`;
  } else if (httpsState === 'active') {
    const httpsOccupant = getPortOccupant(config.httpsPort, 'TCP');
    const httpsOccupantText = httpsOccupant ? `: ${formatOccupantSummary(httpsOccupant)}` : '';
    httpsStatusText = `https://${config.host}:${config.httpsPort} [Active / Listening${httpsOccupantText}]`;
  } else {
    httpsStatusText = `https://${config.host}:${config.httpsPort} [Stopped / Port Available]`;
  }

  const udpOccupant = (!config.disableUdp && udpState === 'active') ? getPortOccupant(config.udpPort, 'UDP') : null;
  const udpOccupantText = udpOccupant ? `: ${formatOccupantSummary(udpOccupant)}` : '';
  const udpStatusText = config.disableUdp
    ? 'Disabled (--disable-udp)'
    : udpState === 'active'
      ? `udp://${config.host}:${config.udpPort} [Active / In Use${udpOccupantText}]`
      : `udp://${config.host}:${config.udpPort} [Stopped / Port Available]`;

  let dotStatusText = '';
  const domainPart = config.dotDomain ? ` (${config.dotDomain})` : '';
  if (config.disableDot) {
    dotStatusText = 'Disabled (--disable-dot)';
  } else if (!certInfo.configured) {
    dotStatusText = `tls://${config.host}:${config.dotPort}${domainPart} [Disabled - TLS Certificates Not Configured]`;
  } else if (!certInfo.filesExist) {
    dotStatusText = `tls://${config.host}:${config.dotPort}${domainPart} [Warning - TLS Certificate Files Missing]`;
  } else if (!certInfo.isWildcard) {
    dotStatusText = `tls://${config.host}:${config.dotPort}${domainPart} [Paused - Requires Wildcard Certificate (*.domain)]`;
  } else if (dotState === 'active') {
    const dotOccupant = getPortOccupant(config.dotPort, 'TCP');
    const dotOccupantText = dotOccupant ? `: ${formatOccupantSummary(dotOccupant)}` : '';
    dotStatusText = `tls://${config.host}:${config.dotPort}${domainPart} [Active / Listening${dotOccupantText}]`;
  } else {
    dotStatusText = `tls://${config.host}:${config.dotPort}${domainPart} [Stopped / Port Available]`;
  }

  const defaultProfileText = config.defaultProfileKey
    ? `Explicit (${config.defaultProfileKey})`
    : 'Auto (Database default profile)';

  const banner = formatBanner({
    title: 'DNS Worker Runtime Status (Serverfull Mode)',
    borderChar: '=',
    bullet: '• '
  });

  const servicesSection = formatKeyValueSection({
    title: '\nService Transports:',
    items: [
      { label: 'Web Dashboard (HTTP)', value: httpStatusText },
      { label: 'Web Dashboard (HTTPS)', value: httpsStatusText },
      { label: 'Classic UDP DNS', value: udpStatusText },
      { label: 'DNS over TLS (DoT)', value: dotStatusText }
    ]
  });

  const loadedEnvs = getLoadedEnvFiles();
  const configSourceText = loadedEnvs.length > 0
    ? `${loadedEnvs.join(', ')} [Loaded]`
    : `None found (Using built-in presets & defaults; default path: ${getDefaultConfigFilePath()})`;

  const databaseItems = isTurso
    ? [
        { label: 'Database Service', value: `${config.databaseService} (Turso libSQL over HTTP)` },
        { label: 'Turso URL', value: maskDatabaseUrl(config.tursoDatabaseUrl) },
        { label: 'Database Status', value: dbStatus.statusText }
      ]
    : [
        { label: 'Database Service', value: `${config.databaseService} (Local SQLite via node:sqlite)` },
        { label: 'SQLite Path', value: config.dbPath },
        { label: 'Database Status', value: dbStatus.statusText },
        { label: 'Persistent Data Dir', value: getDefaultDataDir() }
      ];

  const databaseSection = formatKeyValueSection({
    title: '\nDatabase & Storage:',
    items: databaseItems
  });

  let tlsCertText = 'Not Configured (HTTP only, HTTPS & DoT disabled)';
  if (certInfo.configured) {
    if (!certInfo.filesExist) {
      tlsCertText = 'Configured [Files Missing]';
    } else if (certInfo.error) {
      tlsCertText = `Configured [Invalid Certificate: ${certInfo.error}]`;
    } else {
      const typeStr = certInfo.isWildcard ? 'Wildcard (*.domain)' : 'Single Domain';
      const expireStr = certInfo.expiresAt ? certInfo.expiresAt.toISOString().split('T')[0] : 'Unknown';
      tlsCertText = `Valid (${typeStr}, Expires: ${expireStr})`;
    }
  }

  const dotDomainText = config.dotDomain
    ? `${config.dotDomain} (Wildcard / Single-domain compatible)`
    : 'Not Configured (Auto SNI prefix matching)';

  const http3Status = (!config.disableHttps && certInfo.configured && certInfo.filesExist)
    ? `Enabled via Alt-Svc (UDP :${config.httpsPort}, RFC 9114)`
    : 'Disabled (Requires active HTTPS with TLS certificate)';

  const doqStatus = (certInfo.configured && certInfo.filesExist)
    ? `Compatible (RFC 9250 / RFC 9460 DDR, UDP :${config.dotPort})`
    : 'Disabled (Requires TLS certificate)';

  const echStatus = config.echEnabled
    ? `Enabled (RFC 9460, Outer SNI: ${config.echFrontingDomain || 'cloudflare-ech.com'})`
    : 'Disabled';

  const envSection = formatKeyValueSection({
    title: '\nEnvironment & Security:',
    items: [
      { label: 'Node.js Runtime', value: `v${process.versions.node} (${process.platform} ${process.arch})` },
      { label: 'Config Directory', value: getDefaultConfigDir() },
      { label: 'Config Source', value: configSourceText },
      { label: 'TLS Certificate', value: tlsCertText },
      { label: 'JWT Secret', value: jwtStatus },
      { label: 'DoT Base Domain', value: dotDomainText },
      { label: 'HTTP/3 (h3)', value: http3Status },
      { label: 'DNS over QUIC (DoQ)', value: doqStatus },
      { label: 'ECH (Encrypted Client Hello)', value: echStatus },
      { label: 'Default Profile Key', value: defaultProfileText }
    ]
  });

  const tips: string[] = [];
  if (httpState === 'free' && (udpState === 'free' || config.disableUdp)) {
    const serviceInstallCmd = process.platform === 'win32'
      ? 'dns-worker service install (in Administrator terminal)'
      : 'sudo dns-worker service install';

    tips.push('Services are currently stopped.');
    tips.push(`To run continuously as a persistent background daemon: ${serviceInstallCmd}`);
  }

  const certbotCmd = getCertbotCommand(config.dotDomain);
  if (!certInfo.configured || !certInfo.filesExist) {
    tips.push(`To enable secure HTTPS (port ${config.httpsPort}) and DoT (port ${config.dotPort}):`);
    tips.push(`  ${certbotCmd}`);
  } else if (!certInfo.isWildcard) {
    tips.push('Current certificate is single-domain. To support per-profile DoT (<profile>.domain):');
    tips.push(`  ${certbotCmd}`);
  }

  tips.push("Run 'dns-worker ech' to view active ECH configuration, outer SNI, and RFC 9460 DNS records.");

  const tipSection = tips.length > 0 ? formatTip(tips) : '';

  const report = [banner, servicesSection, databaseSection, envSection, tipSection]
    .filter(Boolean)
    .join('\n');

  console.log(report);
}
