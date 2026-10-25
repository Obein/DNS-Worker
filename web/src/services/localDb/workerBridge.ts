/**
 * @file workerBridge.ts
 * @description Web Worker communication bridge and RPC message router for SQLite WASM.
 */

import SqliteWorker from '../../workers/sqlite.worker?worker';

interface PendingRequest {
  resolve: (val: any) => void;
  reject: (err: any) => void;
}

/**
 * Manages the background SQLite WASM Web Worker lifecycle and RPC requests.
 */
export class LocalDbWorkerBridge {
  private worker: Worker | null = null;
  private pendingRequests = new Map<string, PendingRequest>();
  private initPromise: Promise<boolean> | null = null;
  private isOpfs = false;
  private workerFailed = false;

  /**
   * Lazily spawns and configures the SQLite Web Worker event handlers.
   *
   * @returns Active Worker instance.
   */
  private getWorker(): Worker {
    if (!this.worker) {
      try {
        this.worker = new SqliteWorker();

        this.worker.onmessage = (e: MessageEvent) => {
          const { id, success, data, error } = e.data;
          const pending = this.pendingRequests.get(id);
          if (pending) {
            this.pendingRequests.delete(id);
            if (success) {
              pending.resolve(data);
            } else {
              pending.reject(new Error(error || 'Worker execution error'));
            }
          }
        };

        this.worker.onerror = (err: ErrorEvent) => {
          console.error('[LocalDbWorkerBridge] Worker fatal error:', err);
          this.workerFailed = true;
          for (const [, pending] of this.pendingRequests.entries()) {
            pending.reject(new Error(`SQLite Worker error: ${err.message || 'Load failure'}`));
          }
          this.pendingRequests.clear();
        };
      } catch (err) {
        console.error('[LocalDbWorkerBridge] Failed to instantiate worker:', err);
        this.workerFailed = true;
        throw err;
      }
    }
    return this.worker;
  }

  /**
   * Dispatches a typed RPC request to the SQLite worker and waits for response.
   *
   * @param type - Worker action type.
   * @param payload - Optional data payload.
   * @returns Promise resolving to the typed worker response.
   */
  sendRequest<T = any>(type: string, payload?: unknown): Promise<T> {
    const worker = this.getWorker();
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      worker.postMessage({ id, type, payload });
    });
  }

  /**
   * Initializes the client SQLite WASM engine and OPFS storage with a 12s timeout guard.
   *
   * @returns Promise resolving to true if SQLite WASM is ready.
   */
  async init(): Promise<boolean> {
    if (this.workerFailed) return false;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      try {
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('SQLite Worker init timed out (12s)')), 12000)
        );
        const res = await Promise.race([
          this.sendRequest<{ ready: boolean; isOpfs: boolean }>('INIT'),
          timeoutPromise,
        ]);
        this.isOpfs = res.isOpfs;
        console.log(`[LocalDbWorkerBridge] Initialized (OPFS storage: ${this.isOpfs ? 'ENABLED' : 'IN-MEMORY'})`);
        return res.ready;
      } catch (err) {
        console.warn('[LocalDbWorkerBridge] SQLite engine unavailable, falling back to server:', err);
        this.workerFailed = true;
        return false;
      }
    })();

    return this.initPromise;
  }

  /**
   * Returns whether persistent OPFS storage is active in the current browser.
   */
  getIsOpfs(): boolean {
    return this.isOpfs;
  }

  /**
   * Returns whether the worker has experienced a fatal initialization failure.
   */
  hasWorkerFailed(): boolean {
    return this.workerFailed;
  }
}
