/**
 * @file probe.ts
 * @description Network port probing utilities (TCP and UDP) for service status inspection.
 */

import net from 'node:net';
import dgram from 'node:dgram';

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

    socket.once('error', (err: unknown) => {
      const code = (err as { code?: string })?.code;
      if (code === 'EADDRINUSE') {
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
