/**
 * @file index.ts
 * @description Unified Facade and OS Dispatcher for background service management.
 */

import { ServiceAction } from './types';
import { getServiceExecDetails } from './env';
import { generateSystemdUnit, handleLinuxSystemd } from './systemd';
import { handleWindowsTask } from './schtasks';
import { formatDiagnostic, formatLogBox } from '../format';

export * from './types';
export * from './env';
export * from './systemd';
export * from './schtasks';

/**
 * Handles 'dns-worker service <action>' subcommands across Linux and Windows.
 *
 * @param action - Action verb: 'install' | 'uninstall' | 'start' | 'stop' | 'restart' | 'status' | 'logs'
 */
export async function handleServiceAction(action: ServiceAction | string): Promise<void> {
  if (process.platform === 'win32') {
    await handleWindowsTask(action);
  } else if (process.platform === 'linux') {
    await handleLinuxSystemd(action);
  } else {
    // macOS or other platform
    const details = getServiceExecDetails();
    const unitContent = generateSystemdUnit(details);

    console.log(formatDiagnostic({
      level: 'info',
      title: 'Platform Service Notice',
      message: `Automatic service management is supported on Linux (systemd) and Windows (schtasks). Current platform: ${process.platform}.`,
      details: [
        'A systemd service unit template is provided below for manual reference:'
      ]
    }));
    console.log(formatLogBox({
      title: 'systemd service unit template',
      content: unitContent.trim(),
      borderChar: '-'
    }));
  }
}
