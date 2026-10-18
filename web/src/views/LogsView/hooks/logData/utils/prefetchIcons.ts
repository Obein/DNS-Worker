/**
 * @file prefetchIcons.ts
 * @description Background domain favicon prefetching via Service Worker.
 */

import type { LogEntry } from "../../../types";

export function prefetchDomainIcons(logs: LogEntry[]): void {
  if (!logs || logs.length === 0) return;
  if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
    const domains = Array.from(new Set(logs.map((log) => log.domain)));
    navigator.serviceWorker.controller.postMessage({
      type: "PREFETCH_ICONS",
      domains
    });
  }
}
