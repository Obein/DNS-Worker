/**
 * @file e2eeService.ts
 * @description Local E2EE orchestration service for batch re-decrypting local encrypted logs.
 */

import type { LogEntry } from '../../views/LogsView/types';
import type { LocalDbWorkerBridge } from './workerBridge';
import { e2ee } from '../e2ee';

/**
 * Service managing client-side decryption of local logs stored in SQLite WASM.
 */
export class LocalDbE2eeService {
  private readonly bridge: LocalDbWorkerBridge;

  constructor(bridge: LocalDbWorkerBridge) {
    this.bridge = bridge;
  }

  /**
   * Re-decrypts any local logs that were previously stored encrypted.
   * Called when the user unlocks their Passkey or Recovery key.
   *
   * @param profileId - Profile identifier.
   * @returns Number of successfully re-decrypted records.
   */
  async reDecryptLocalLogs(profileId: string): Promise<number> {
    await this.bridge.init();
    const res = await this.bridge.sendRequest<{ rows: LogEntry[] }>('GET_ENCRYPTED_LOGS', {
      profileId,
      limit: 1000
    });
    if (!res.rows || res.rows.length === 0) return 0;

    const decrypted = await e2ee.decryptLogsBatch(profileId, res.rows);
    const successfullyDecrypted = decrypted.filter((l) => (l.encrypt_version ?? 0) === 0);
    if (successfullyDecrypted.length === 0) return 0;

    const updateRes = await this.bridge.sendRequest<{ updated: number }>('UPDATE_LOGS_BATCH', {
      profileId,
      logs: successfullyDecrypted
    });
    return updateRes.updated;
  }
}
