/**
 * @file sqlite.worker.ts
 * @description Dedicated Web Worker running official SQLite WASM with OPFS persistence.
 * Acts as the message routing controller, dispatching tasks to specialized domain modules.
 */

import type {
  WorkerMessageRequest,
  WorkerMessageResponse,
  SyncBatchPayload,
  UpdateLogsBatchPayload,
  GetEncryptedLogsPayload,
  GetWatermarkPayload,
  WorkerQueryLogsParams,
  WorkerAnalyticsParams,
  CleanupPayload,
  ClearProfilePayload,
  InitResult,
} from './sqlite/types';

import { initDatabase } from './sqlite/database';
import {
  handleSyncBatch,
  handleUpdateLogsBatch,
  handleGetEncryptedLogs,
  handleGetWatermark,
} from './sqlite/sync';
import { handleQueryLogs } from './sqlite/query';
import { handleQueryAnalytics } from './sqlite/analytics';
import {
  handleCleanup,
  handleGetStorageInfo,
  handleClearProfile,
} from './sqlite/maintenance';

// Re-export types for backward compatibility
export type * from './sqlite/types';

/**
 * Main Web Worker message router.
 */
self.onmessage = async (e: MessageEvent<WorkerMessageRequest>): Promise<void> => {
  const { id, type, payload } = e.data;

  try {
    let result: unknown = null;

    switch (type) {
      case 'INIT': {
        const opfsReady = await initDatabase();
        result = { ready: true, isOpfs: opfsReady } satisfies InitResult;
        break;
      }
      case 'SYNC_BATCH':
        result = handleSyncBatch(payload as SyncBatchPayload);
        break;
      case 'UPDATE_LOGS_BATCH':
        result = handleUpdateLogsBatch(payload as UpdateLogsBatchPayload);
        break;
      case 'GET_ENCRYPTED_LOGS':
        result = handleGetEncryptedLogs(payload as GetEncryptedLogsPayload);
        break;
      case 'GET_WATERMARK':
        result = handleGetWatermark(payload as GetWatermarkPayload);
        break;
      case 'QUERY_LOGS':
        result = handleQueryLogs(payload as WorkerQueryLogsParams);
        break;
      case 'QUERY_ANALYTICS':
        result = handleQueryAnalytics(payload as WorkerAnalyticsParams);
        break;
      case 'CLEANUP':
        result = handleCleanup(payload as CleanupPayload);
        break;
      case 'GET_STORAGE_INFO':
        result = handleGetStorageInfo();
        break;
      case 'CLEAR_PROFILE':
        result = handleClearProfile(payload as ClearProfilePayload);
        break;
      default:
        throw new Error(`Unknown worker message type: ${type}`);
    }

    self.postMessage({ id, success: true, data: result } satisfies WorkerMessageResponse);
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[SQLite Worker] Error executing ${type}:`, err);
    self.postMessage({
      id,
      success: false,
      error: errorMessage
    } satisfies WorkerMessageResponse);
  }
};

self.onerror = (event: Event | string): void => {
  console.error('[SQLite Worker] Uncaught worker runtime error:', event);
};

self.onunhandledrejection = (e: PromiseRejectionEvent): void => {
  console.error('[SQLite Worker] Unhandled promise rejection in worker:', e.reason);
};
