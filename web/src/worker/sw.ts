/**
 * sw.ts - Service Worker Entry & Event Router (TypeScript)
 *
 * This file orchestrates the Service Worker lifecycle and routes events
 * to appropriate domain-specific sub-services (like sw-icon-cache.ts).
 */

import {
  isIconRequest,
  handleIconFetch,
  handleIconPrefetch,
  cleanExpiredCache,
} from "./sw-icon-cache.ts";

// TypeScript declaration for Service Worker global scope
declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: any;
};

// Access the manifest placeholder to satisfy vite-plugin-pwa compilation requirements
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const manifest = self.__WB_MANIFEST;

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      cleanExpiredCache()
    ])
  );
});

// Router for fetch requests
self.addEventListener("fetch", (event) => {
  const url = event.request.url;

  // Intercept DuckDuckGo icon requests
  if (isIconRequest(url)) {
    event.respondWith(handleIconFetch(event));
  }
});

// Router for cross-thread messages
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "PREFETCH_ICONS") {
    handleIconPrefetch(event.data.domains);
  }
});
