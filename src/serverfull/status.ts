/**
 * @file status.ts
 * @description Runtime status and service diagnostic inspector for Serverfull mode.
 */

import fs from 'node:fs';
import net from 'node:net';
import dgram from 'node:dgram';
import { DatabaseSync } from 'node:sqlite';
import { ServerfullConfig } from './config';
import { formatBanner, formatKeyValueSection } from './format';
import { isUsableJwtSecret, isStrongJwtSecret } from '../lib/jwt';

/**
 * Result of a network port accessibility probe.
 */
export type PortProbeState = 'active' | 'free' | 'disabled';

/**
 * Probes a TCP port to determine if a service is actively listening.
 *
 * @param port - TCP port number to probe.
 * @param host - Network address to connect to.
 * @param timeoutMs - Connection timeout in milliseconds.
 * @returns 'active' if listening, 'free' if connection is refused/times out.
 */
export function probeTcpPort(port: number, host: string, timeoutMs: number = 300): Promise<'active' | 'free'> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let isSettled = false;

    const finish = (state: 'active' | 'free') => {
      if (isSettled) return;
      isSettled = true;
      try { socket.destroy(); } catch {}
      resolve(state);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish('active'));
    socket.once('timeout', () => finish('free'));
    socket.once('error', () => finish('free'));

    // If host is wildcard 0.0.0.0 or ::, probe loopback
    const targetHost = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
    try {
      socket.connect(port, targetHost);
    } catch {
      finish('free');
    }
  });
}

/**
 * Probes a UDP port to determine if it is currently occupied or available to bind.
 *
 * @param port - UDP port number to probe.
 * @param host - Network host to test.
 * @returns 'active' if already occupied (EADDRINUSE), 'free' if available.
 */
export function probeUdpPort(port: number, host: string): Promise<'active' | 'free'> {
  return new Promise((resolve) => {
    const socket = dgram.createSocket('udp4');
    let isSettled = false;

    const finish = (state: 'active' | 'free') => {
      if (isSettled) return;
      isSettled = true;
      try { socket.close(); } catch {}
      resolve(state);
    };

    socket.once('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        finish('active');
      } else {
        finish('free');
      }
    });

    try {
      socket.bind(port, host, () => {
        finish('free');
      });
    } catch {
      finish('active');
    }
  });
}

/**
 * Information regarding SQLite database file and schema state.
 */
export interface DbStatusInfo {
  exists: boolean;
  sizeFormatted?: string;
  migrationsCount?: number;
  usersCount?: number;
  profilesCount?: number;
  statusText: string;
}

/**
 * Inspects the SQLite database file and queries metadata if available.
 *
 * @param dbPath - Path to the SQLite database file.
 * @returns Database status metrics.
 */
export function inspectDatabase(dbPath: string): DbStatusInfo {
  if (!fs.existsSync(dbPath)) {
    return {
      exists: false,
      statusText: 'Not Initialized (File does not exist yet; created on first start)'
    };
  }

  try {
    const stats = fs.statSync(dbPath);
    const sizeFormatted = stats.size > 1024 * 1024
      ? `${(stats.size / (1024 * 1024)).toFixed(2)} MB`
      : `${(stats.size / 1024).toFixed(1)} KB`;

    let migrationsCount = 0;
    let usersCount = 0;
    let profilesCount = 0;

    try {
      const rawDb = new DatabaseSync(dbPath, { readOnly: true });

      const migTable = rawDb.prepare("SELECT count(*) as cnt FROM sqlite_master WHERE type='table' AND name='d1_migrations'").get() as { cnt: number } | undefined;
      if (migTable && migTable.cnt > 0) {
        const migRow = rawDb.prepare('SELECT count(*) as count FROM d1_migrations').get() as { count: number } | undefined;
        migrationsCount = migRow?.count || 0;
      }

      const usersTable = rawDb.prepare("SELECT count(*) as cnt FROM sqlite_master WHERE type='table' AND name='users'").get() as { cnt: number } | undefined;
      if (usersTable && usersTable.cnt > 0) {
        const userRow = rawDb.prepare('SELECT count(*) as count FROM users').get() as { count: number } | undefined;
        usersCount = userRow?.count || 0;
      }

      const profTable = rawDb.prepare("SELECT count(*) as cnt FROM sqlite_master WHERE type='table' AND name='profiles'").get() as { cnt: number } | undefined;
      if (profTable && profTable.cnt > 0) {
        const profRow = rawDb.prepare('SELECT count(*) as count FROM profiles').get() as { count: number } | undefined;
        profilesCount = profRow?.count || 0;
      }

      rawDb.close();
    } catch {
      // Ignore database inspection query errors (e.g. locked database)
    }

    const details = [
      sizeFormatted,
      migrationsCount > 0 ? `${migrationsCount} migrations` : null,
      usersCount > 0 ? `${usersCount} user(s)` : null,
      profilesCount > 0 ? `${profilesCount} profile(s)` : null
    ].filter(Boolean).join(', ');

    return {
      exists: true,
      sizeFormatted,
      migrationsCount,
      usersCount,
      profilesCount,
      statusText: `Ready (${details})`
    };
  } catch (err: any) {
    return {
      exists: true,
      statusText: `Exists (Read warning: ${err.message || String(err)})`
    };
  }
}

/**
 * Inspects all Serverfull service ports, database, and configurations, printing a declarative status report.
 *
 * @param config - The parsed serverfull configuration.
 * @param envJwtSecret - The JWT_SECRET environment variable value.
 */
export async function showServerfullStatus(config: ServerfullConfig, envJwtSecret?: string): Promise<void> {
  const [httpState, udpState, dotState] = await Promise.all([
    probeTcpPort(config.httpPort, config.host),
    !config.disableUdp ? probeUdpPort(config.udpPort, config.host) : Promise.resolve('disabled' as const),
    !config.disableDot ? probeTcpPort(config.dotPort, config.host) : Promise.resolve('disabled' as const)
  ]);

  const dbStatus = inspectDatabase(config.dbPath);

  const tlsConfigured = Boolean(config.tlsKeyPath && config.tlsCertPath);
  const tlsFilesExist = tlsConfigured && fs.existsSync(config.tlsKeyPath) && fs.existsSync(config.tlsCertPath);

  let jwtStatus = 'Default (Insecure fallback, please configure JWT_SECRET)';
  if (isUsableJwtSecret(envJwtSecret)) {
    jwtStatus = isStrongJwtSecret(envJwtSecret)
      ? 'Configured (Strong, >= 32 characters)'
      : 'Configured (Warning: Shorter than 32 characters)';
  }

  const httpStatusText = httpState === 'active'
    ? `http://${config.host}:${config.httpPort} [Active / Listening]`
    : `http://${config.host}:${config.httpPort} [Stopped / Port Available]`;

  const udpStatusText = config.disableUdp
    ? 'Disabled (--disable-udp)'
    : udpState === 'active'
      ? `udp://${config.host}:${config.udpPort} [Active / In Use]`
      : `udp://${config.host}:${config.udpPort} [Stopped / Port Available]`;

  let dotStatusText = '';
  if (config.disableDot) {
    dotStatusText = 'Disabled (--disable-dot)';
  } else if (!tlsConfigured) {
    dotStatusText = `tls://${config.host}:${config.dotPort} [Disabled - TLS Certificates Not Configured]`;
  } else if (!tlsFilesExist) {
    dotStatusText = `tls://${config.host}:${config.dotPort} [Warning - TLS Certificate Files Missing]`;
  } else if (dotState === 'active') {
    dotStatusText = `tls://${config.host}:${config.dotPort} [Active / Listening]`;
  } else {
    dotStatusText = `tls://${config.host}:${config.dotPort} [Stopped / Port Available]`;
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
      { label: 'Web Dashboard & DoH', value: httpStatusText },
      { label: 'Classic UDP DNS', value: udpStatusText },
      { label: 'DNS over TLS (DoT)', value: dotStatusText }
    ]
  });

  const databaseSection = formatKeyValueSection({
    title: '\nDatabase & Storage:',
    items: [
      { label: 'SQLite Path', value: config.dbPath },
      { label: 'Database Status', value: dbStatus.statusText }
    ]
  });

  const envSection = formatKeyValueSection({
    title: '\nEnvironment & Security:',
    items: [
      { label: 'Node.js Runtime', value: `v${process.versions.node} (${process.platform} ${process.arch})` },
      { label: 'JWT Secret', value: jwtStatus },
      { label: 'Default Profile Key', value: defaultProfileText }
    ]
  });

  console.log([banner, servicesSection, databaseSection, envSection, ''].join('\n'));
}
