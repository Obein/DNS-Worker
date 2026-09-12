import { D1PreparedStatement } from "@cloudflare/workers-types";
import { Env, ExecutionContext, ProfileSettings, ResolutionLog } from "../types";
import { LogModel, generateLogId } from "../models/log";
import { cacheUtils } from "../utils/cache";

/** In-memory batch queue of logs waiting to be flushed to D1 */
const logBatchQueue: ResolutionLog[] = [];

/** In-memory map of pre-aggregated domain counts waiting for UPSERT flush: `${profile_id}\t${hourTimestamp}\t${domain}\t${action}` -> count */
const domainRollupQueue = new Map<string, number>();

/** Maximum number of statements of each category in a single db.batch() transaction */
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

  // Clear pending queues to prevent memory leaks while writes are blocked
  logBatchQueue.length = 0;
  domainRollupQueue.clear();
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
 * Flushes a batch of logs and pre-aggregated domain rollups to D1 via db.batch().
 *
 * @param env Cloudflare Worker environment bindings
 */
export async function flushLogBatch(env: Env): Promise<void> {
  isFlushScheduled = false;
  lastFlushTime = Date.now();

  if (logBatchQueue.length === 0 && domainRollupQueue.size === 0) {
    return;
  }

  const cache = (caches as any).default;
  if (await isWriteQuotaTripped(cache)) {
    logBatchQueue.length = 0;
    domainRollupQueue.clear();
    return;
  }

  // Atomically extract up to MAX_BATCH_SIZE raw logs from the front of the queue
  const logsToFlush = logBatchQueue.splice(0, MAX_BATCH_SIZE);

  // Atomically extract up to MAX_BATCH_SIZE domain rollups from the queue
  const rollupsToFlush: { profileId: string; action: string; hourTimestamp: number; domain: string; count: number }[] = [];
  for (const [key, count] of domainRollupQueue.entries()) {
    const [profileId, action, hourTimestampStr, domain] = key.split("\t");
    rollupsToFlush.push({
      profileId,
      action,
      hourTimestamp: parseInt(hourTimestampStr, 10),
      domain,
      count
    });
    domainRollupQueue.delete(key);
    if (rollupsToFlush.length >= MAX_BATCH_SIZE) {
      break;
    }
  }

  if (logsToFlush.length === 0 && rollupsToFlush.length === 0) {
    return;
  }

  const logModel = new LogModel(env.DB);
  const statements: D1PreparedStatement[] = [];

  for (const log of logsToFlush) {
    statements.push(logModel.createInsertStatement(log));
  }
  for (const rollup of rollupsToFlush) {
    statements.push(
      logModel.createDomainRollupUpsertStatement(
        rollup.profileId,
        rollup.action,
        rollup.hourTimestamp,
        rollup.domain,
        rollup.count
      )
    );
  }

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
      console.warn(`[LogBatcher] Batch write failed (${statements.length} stmts):`, errorMsg);
    }
  }

  // If there are still items remaining in either queue, schedule the next batch
  if (logBatchQueue.length > 0 || domainRollupQueue.size > 0) {
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
 * Enqueues a DNS resolution log for 10-second micro-batching, in-memory stream pre-aggregation,
 * and quota protection.
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

  // 3. In-memory stream pre-aggregation for domain hourly rollups
  const domain = (log.domain || "").trim().toLowerCase();
  if (domain && domain.length <= 253 && log.profile_id) {
    const action = (log.action || "PASS").toUpperCase();
    const hourTimestamp = Math.floor((log.timestamp || Math.floor(Date.now() / 1000)) / 3600) * 3600;
    const rollupKey = `${log.profile_id}\t${action}\t${hourTimestamp}\t${domain}`;
    domainRollupQueue.set(rollupKey, (domainRollupQueue.get(rollupKey) || 0) + 1);
  }

  // 4. Ensure unique id is assigned before queueing raw log
  if (!log.id) {
    log.id = generateLogId();
  }

  // 5. Enqueue the raw log entry
  logBatchQueue.push(log);

  // 6. Determine if an immediate flush is required or a deferred flush should be scheduled
  const now = Date.now();
  if (
    logBatchQueue.length >= MAX_BATCH_SIZE ||
    domainRollupQueue.size >= MAX_BATCH_SIZE ||
    now - lastFlushTime >= FLUSH_INTERVAL_MS
  ) {
    ctx.waitUntil(flushLogBatch(env));
  } else {
    scheduleDeferredFlush(env);
  }
}
