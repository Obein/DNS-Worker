/**
 * @file port.ts
 * @description Cross-platform network port occupant and process resolver (Linux & Windows).
 * Identifies the process name, PID, and service occupying a given TCP/UDP port when EADDRINUSE occurs.
 */

import fs from 'node:fs';
import { execSync } from 'node:child_process';

/**
 * Details of a process or service occupying a network port.
 */
export interface PortOccupant {
  pid?: number;
  processName: string;
  serviceName?: string;
}

/**
 * Resolves the process occupying a specific TCP or UDP port on Windows via netstat and tasklist.
 *
 * @param port - Network port number.
 * @param protocol - Transport protocol ('TCP' | 'UDP').
 * @returns PortOccupant details or null if no occupant is found.
 */
export function getWindowsPortOccupant(port: number, protocol: 'TCP' | 'UDP'): PortOccupant | null {
  try {
    const protoFlag = protocol.toLowerCase();
    const stdout = execSync(`netstat -ano -p ${protoFlag}`, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3000
    });

    let foundPid: number | null = null;
    const lines = stdout.split(/\r?\n/);

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.toUpperCase().startsWith(protocol)) continue;

      const parts = line.split(/\s+/);
      if (parts.length < 4) continue;

      const localAddr = parts[1];
      if (!localAddr) continue;

      // Handle IPv4 (0.0.0.0:53, 127.0.0.1:53) and IPv6 ([::]:53, [::1]:53)
      const isPortMatch = localAddr.endsWith(`:${port}`) || localAddr.endsWith(`]:${port}`);
      if (isPortMatch) {
        // For TCP, ensure the connection is in LISTENING state
        if (protocol === 'TCP' && parts[3] !== 'LISTENING') {
          continue;
        }

        const pidStr = parts[parts.length - 1];
        const parsed = parseInt(pidStr, 10);
        if (!isNaN(parsed) && parsed > 0) {
          foundPid = parsed;
          break;
        }
      }
    }

    if (!foundPid) return null;

    let processName = `PID ${foundPid}`;
    let serviceName: string | undefined;

    try {
      const taskOut = execSync(`tasklist /SVC /FI "PID eq ${foundPid}" /FO CSV /NH`, {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 2500
      });

      // Output format: "svchost.exe","3512","SharedAccess"
      const match = taskOut.trim().match(/"([^"]+)"\s*,\s*"(\d+)"\s*(?:,\s*"([^"]+)")?/);
      if (match) {
        processName = match[1];
        if (match[3] && match[3] !== 'N/A') {
          serviceName = match[3];
        }
      }
    } catch {
      /* Gracefully ignore tasklist lookup errors */
    }

    return {
      pid: foundPid,
      processName,
      serviceName
    };
  } catch {
    return null;
  }
}

/**
 * Resolves the process occupying a specific TCP or UDP port on Linux via ss, lsof, or fuser.
 *
 * @param port - Network port number.
 * @param protocol - Transport protocol ('TCP' | 'UDP').
 * @returns PortOccupant details or null if no occupant is found.
 */
export function getLinuxPortOccupant(port: number, protocol: 'TCP' | 'UDP'): PortOccupant | null {
  // Strategy 1: Modern ss (iproute2) tool
  try {
    const protoFlag = protocol === 'TCP' ? '-lptn' : '-lpun';
    const stdout = execSync(`ss ${protoFlag} "sport = :${port}"`, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3000
    });

    for (const rawLine of stdout.split(/\r?\n/)) {
      const line = rawLine.trim();
      // Match pattern: users:(("process-name",pid=123,fd=4))
      const match = line.match(/users:\(\("([^"]+)",pid=(\d+)/);
      if (match) {
        return {
          processName: match[1],
          pid: parseInt(match[2], 10)
        };
      }
    }

    // Special case: on Ubuntu/Debian, systemd-resolved binds local stub resolver on 127.0.0.53:53
    if (port === 53 && stdout.includes('127.0.0.53')) {
      return {
        processName: 'systemd-resolved',
        serviceName: 'DNSStubListener (127.0.0.53)'
      };
    }
  } catch {
    /* Fall through to secondary detection mechanisms */
  }

  // Strategy 2: lsof command
  try {
    const lsofArg = protocol === 'TCP' ? `-iTCP:${port} -sTCP:LISTEN` : `-iUDP:${port}`;
    const stdout = execSync(`lsof -nP ${lsofArg}`, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3000
    });

    const lines = stdout.trim().split(/\r?\n/);
    if (lines.length > 1) {
      // Header: COMMAND PID USER ...
      const dataLine = lines[1].trim();
      const parts = dataLine.split(/\s+/);
      if (parts.length >= 2) {
        const processName = parts[0];
        const pid = parseInt(parts[1], 10);
        return {
          processName,
          pid: !isNaN(pid) ? pid : undefined
        };
      }
    }
  } catch {
    /* Fall through to tertiary mechanism */
  }

  // Strategy 3: fuser command and /proc inspection
  try {
    const protoLower = protocol.toLowerCase();
    const stdout = execSync(`fuser ${port}/${protoLower}`, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2000
    });

    const match = stdout.trim().match(/(\d+)/);
    if (match) {
      const pid = parseInt(match[1], 10);
      let processName = `PID ${pid}`;
      try {
        if (fs.existsSync(`/proc/${pid}/comm`)) {
          processName = fs.readFileSync(`/proc/${pid}/comm`, 'utf-8').trim();
        }
      } catch {
        /* Ignore proc read errors */
      }
      return {
        pid,
        processName
      };
    }
  } catch {
    /* Fall through to known daemon detection */
  }

  // Strategy 4: Check if systemd-resolved is active when inspecting DNS port 53
  if (port === 53) {
    try {
      const statusOut = execSync('systemctl is-active systemd-resolved', {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 1000
      }).trim();

      if (statusOut === 'active') {
        return {
          processName: 'systemd-resolved',
          serviceName: 'DNSStubListener'
        };
      }
    } catch {
      /* Ignore systemctl error */
    }
  }

  return null;
}

/**
 * Resolves the process occupying a specific TCP or UDP port on macOS/BSD via lsof.
 *
 * @param port - Network port number.
 * @param protocol - Transport protocol ('TCP' | 'UDP').
 * @returns PortOccupant details or null if no occupant is found.
 */
export function getBsdPortOccupant(port: number, protocol: 'TCP' | 'UDP'): PortOccupant | null {
  try {
    const lsofArg = protocol === 'TCP' ? `-iTCP:${port} -sTCP:LISTEN` : `-iUDP:${port}`;
    const stdout = execSync(`lsof -nP ${lsofArg}`, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3000
    });

    const lines = stdout.trim().split(/\r?\n/);
    if (lines.length > 1) {
      const dataLine = lines[1].trim();
      const parts = dataLine.split(/\s+/);
      if (parts.length >= 2) {
        const processName = parts[0];
        const pid = parseInt(parts[1], 10);
        return {
          processName,
          pid: !isNaN(pid) ? pid : undefined
        };
      }
    }
  } catch {
    /* Ignore lookup errors */
  }
  return null;
}

/**
 * Cross-platform entry point to detect process occupying a network port.
 *
 * @param port - Network port number.
 * @param protocol - Transport protocol ('TCP' | 'UDP').
 * @returns PortOccupant or null if not detected.
 */
export function getPortOccupant(port: number, protocol: 'TCP' | 'UDP'): PortOccupant | null {
  if (process.platform === 'win32') {
    return getWindowsPortOccupant(port, protocol);
  } else if (process.platform === 'linux') {
    return getLinuxPortOccupant(port, protocol);
  } else {
    return getBsdPortOccupant(port, protocol);
  }
}

/**
 * Formats a PortOccupant object into a clean user-facing string.
 *
 * @param occupant - PortOccupant object.
 * @returns Formatted occupant summary (e.g. "named (PID 1234)", "svchost.exe (PID 3512) [SharedAccess]").
 */
export function formatOccupantSummary(occupant: PortOccupant): string {
  let summary = occupant.processName;
  if (occupant.pid) {
    summary += ` (PID ${occupant.pid})`;
  }
  if (occupant.serviceName && occupant.serviceName !== occupant.processName) {
    summary += ` [${occupant.serviceName}]`;
  }
  return summary;
}
