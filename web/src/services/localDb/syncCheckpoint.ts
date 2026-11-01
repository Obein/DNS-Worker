/**
 * @file syncCheckpoint.ts
 * @description Manages persistence, retrieval, and clearing of resumable sync checkpoints in localStorage.
 */

export interface SyncCheckpoint {
  since: number;
  until: number;
  checkpointBefore: number;
  syncedCount: number;
  totalExpected: number;
  updatedAt: number;
}

/**
 * Service managing synchronization checkpoints for resumable chunked data transfers.
 */
export class SyncCheckpointManager {
  private readonly storagePrefix = "obex_sync_checkpoint_";

  /**
   * Retrieves any active synchronization checkpoint for the given profile and exact time range.
   *
   * @param profileId - Profile identifier.
   * @param since - Start boundary in seconds.
   * @param until - End boundary in seconds.
   * @returns Active valid checkpoint or null.
   */
  getCheckpoint(profileId: string, since: number, until: number): SyncCheckpoint | null {
    try {
      const raw = localStorage.getItem(`${this.storagePrefix}${profileId}`);
      if (!raw) return null;
      const parsed: SyncCheckpoint = JSON.parse(raw);
      if (
        parsed &&
        parsed.since === since &&
        parsed.until === until &&
        typeof parsed.checkpointBefore === "number" &&
        parsed.checkpointBefore > since &&
        parsed.checkpointBefore < until
      ) {
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Saves a synchronization checkpoint so sync can resume from the last committed batch cursor.
   *
   * @param profileId - Profile identifier.
   * @param checkpoint - Checkpoint state object.
   */
  saveCheckpoint(profileId: string, checkpoint: SyncCheckpoint): void {
    try {
      localStorage.setItem(`${this.storagePrefix}${profileId}`, JSON.stringify(checkpoint));
    } catch {
      // Ignore localStorage write failures (e.g. private browsing storage quota)
    }
  }

  /**
   * Clears the synchronization checkpoint upon completion or invalidation.
   *
   * @param profileId - Profile identifier.
   */
  clearCheckpoint(profileId: string): void {
    try {
      localStorage.removeItem(`${this.storagePrefix}${profileId}`);
    } catch {
      // Ignore localStorage removal errors
    }
  }
}
