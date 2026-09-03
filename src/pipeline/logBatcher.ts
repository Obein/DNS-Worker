import { Env, ExecutionContext, ProfileSettings, ResolutionLog } from "../types";
import { LogModel } from "../models/log";
import { cacheUtils } from "../utils/cache";

/** In-memory batch queue of logs waiting to be flushed to D1 */
const logBatchQueue: ResolutionLog[] = [];

/** Maximum number of log statements in a single db.batch() transaction */
const MAX_BATCH_SIZE = 50;

/** Debounce time window for micro-batch flushing (10 seconds) */
const FLUSH_INTERVAL_MS = 10_000;

/** Circuit breaker cooldown duration when D1 write quota is exceeded (1 hour) */
const CIRCUIT_BREAKER_COOLDOWN_SEC = 3600;

/** In-memory timestamp until which write operations are silenced */
let memoryCircuitBreakerUntil = 0;

/** Whether a deferred flush timer has already been scheduled */
let isFlushScheduled = false;

/** Timestamp of the last successful or attempted flush */
let lastFlushTime = Date.now();

/**
 * Checks if the D1 write quota circuit breaker is currently active.
 *
 * @param cache Cloudflare Cache API instance
 * @returns boolean True if write operations are currently silenced
 */
export async function isWriteQuotaTripped(cache?: any): Promise<boolean> {
  const now = Date.now();
  if (memoryCircuitBreakerUntil > now) {
    return true;
  }

  if (cache) {
    try {
      const trippedUntil = await cacheUtils.get<number>(cache, "d1:write_quota_tripped");
      if (trippedUntil && trippedUntil > Math.floor(now / 1000)) {
        memoryCircuitBreakerUntil = trippedUntil * 1000;
        return true;
      }
    } catch {
      // Non-critical cache read error
    }
  }

  return false;
}

/**
 * Activates the write circuit breaker when a D1 write quota limit error occurs.
 *
 * @param cache Cloudflare Cache API instance
 */
export async function tripWriteCircuitBreaker(cache?: any): Promise<void> {
  const nowSec = Math.floor(Date.now() / 1000);
  const trippedUntilSec = nowSec + CIRCUIT_BREAKER_COOLDOWN_SEC;
  memoryCircuitBreakerUntil = trippedUntilSec * 1000;

  // Clear pending queue to prevent memory leaks while writes are blocked
  logBatchQueue.length = 0;
  isFlushScheduled = false;

  console.warn(
    `[LogBatcher] D1 write quota limit reached! Silencing log writes for ${CIRCUIT_BREAKER_COOLDOWN_SEC}s.`
  );

  if (cache) {
    try {
      await cacheUtils.set(cache, "d1:write_quota_tripped", trippedUntilSec, CIRCUIT_BREAKER_COOLDOWN_SEC);
    } catch {
      // Non-critical cache write error
    }
  }
}

/**
 * Flushes a batch of up to MAX_BATCH_SIZE logs to D1 via db.batch().
 *
 * @param env Cloudflare Worker environment bindings
 */
export async function flushLogBatch(env: Env): Promise<void> {
  isFlushScheduled = false;
  lastFlushTime = Date.now();

  if (logBatchQueue.length === 0) {
    return;
  }

  const cache = (caches as any).default;
  if (await isWriteQuotaTripped(cache)) {
    logBatchQueue.length = 0;
    return;
  }

  // Atomically extract up to MAX_BATCH_SIZE items from the front of the queue
  const logsToFlush = logBatchQueue.splice(0, MAX_BATCH_SIZE);
  if (logsToFlush.length === 0) {
    return;
  }

  const logModel = new LogModel(env.DB);
  const statements = logsToFlush.map((log) => logModel.createInsertStatement(log));

  try {
    await env.DB.batch(statements);
  } catch (err: any) {
    const errorMsg = String(err?.message || err);

    // Detect Cloudflare D1 row write quota exhaustion
    if (
      errorMsg.includes("exceeded D1's free tier daily row write limit") ||
      errorMsg.includes("row write limit") ||
      errorMsg.includes("daily write limit")
    ) {
      await tripWriteCircuitBreaker(cache);
    } else {
      console.warn(`[LogBatcher] Batch write failed (${logsToFlush.length} logs):`, errorMsg);
    }
  }

  // If there are still items remaining in the queue, schedule the next batch
  if (logBatchQueue.length > 0) {
    scheduleDeferredFlush(env);
  }
}

/**
 * Schedules a background deferred flush after FLUSH_INTERVAL_MS if one is not already pending.
 *
 * @param env Cloudflare Worker environment bindings
 */
function scheduleDeferredFlush(env: Env): void {
  if (isFlushScheduled) {
    return;
  }
  isFlushScheduled = true;

  // Use a promise timer resolved in background execution context
  new Promise((resolve) => setTimeout(resolve, FLUSH_INTERVAL_MS))
    .then(() => flushLogBatch(env))
    .catch((e) => {
      isFlushScheduled = false;
      console.error("[LogBatcher] Deferred flush error:", e);
    });
}

/**
 * Enqueues a DNS resolution log for 10-second micro-batching and quota protection.
 *
 * @param log ResolutionLog object to insert
 * @param settings Current profile settings
 * @param env Cloudflare Worker environment bindings
 * @param ctx ExecutionContext to extend background lifetime
 */
export function enqueueLog(
  log: ResolutionLog,
  settings: ProfileSettings | undefined,
  env: Env,
  ctx: ExecutionContext
): void {
  // 1. Zero-retention policy check: if log_retention_days is 0, completely skip logging
  if (settings && Number(settings.log_retention_days) === 0) {
    return;
  }

  // 2. Fast memory circuit-breaker check
  if (memoryCircuitBreakerUntil > Date.now()) {
    return;
  }

  // 3. Enqueue the log entry
  logBatchQueue.push(log);

  // 4. Determine if an immediate flush is required or a deferred flush should be scheduled
  const now = Date.now();
  if (logBatchQueue.length >= MAX_BATCH_SIZE || now - lastFlushTime >= FLUSH_INTERVAL_MS) {
    ctx.waitUntil(flushLogBatch(env));
  } else {
    scheduleDeferredFlush(env);
  }
}
