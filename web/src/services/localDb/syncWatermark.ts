/**
 * @file syncWatermark.ts
 * @description Manages profile synchronization watermarks and time boundaries in local SQLite.
 */

import type { SyncWatermark } from "./types";
import type { LocalDbWorkerBridge } from "./workerBridge";

/**
 * Service managing synchronization watermarks (earliest, latest, and last_synced timestamps)
 * via the local SQLite worker bridge.
 */
export class SyncWatermarkManager {
  private readonly bridge: LocalDbWorkerBridge;

  constructor(bridge: LocalDbWorkerBridge) {
    this.bridge = bridge;
  }

  /**
   * Retrieves the sync watermark for a given profile.
   *
   * @param profileId - Profile identifier.
   * @returns Watermark row or null.
   */
  async getWatermark(profileId: string): Promise<SyncWatermark | null> {
    await this.bridge.init();
    return this.bridge.sendRequest<SyncWatermark | null>("GET_WATERMARK", { profileId });
  }

  /**
   * Updates or expands the watermark time boundaries for a profile.
   *
   * @param profileId - Profile identifier.
   * @param start - Start timestamp in seconds.
   * @param end - End timestamp in seconds.
   */
  async updateWatermarkBounds(profileId: string, start: number, end: number): Promise<void> {
    await this.bridge.init();
    await this.bridge.sendRequest("UPDATE_WATERMARK_BOUNDS", { profileId, start, end });
  }
}
