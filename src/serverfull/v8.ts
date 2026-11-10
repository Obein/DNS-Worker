/**
 * @file v8.ts
 * @description V8 runtime engine tuning for high-throughput, low-latency DNS resolution.
 */

import v8 from 'node:v8';

/**
 * Tunes V8 engine runtime parameters when running under Node.js.
 * Enables TurboFan Fast API calls for native Node.js socket and buffer bindings.
 */
export function tuneV8Engine(): void {
  const isBun = Boolean((process.versions as Record<string, string | undefined>).bun);
  if (isBun) {
    return; // Bun uses JavaScriptCore (JSC) instead of V8
  }

  try {
    // Enable fast API calls in V8 for high-performance native socket/buffer calls
    v8.setFlagsFromString('--turbo-fast-api-calls');
  } catch {
    /* Gracefully ignore if V8 runtime flags are locked */
  }
}
