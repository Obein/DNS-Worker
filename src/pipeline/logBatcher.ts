import { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import { Env, ExecutionContext, ProfileSettings, ResolutionLog } from "../types";
import { LogModel, generateLogId } from "../models/log";
import { cacheUtils } from "../utils/cache";
import { encryptSensitiveLogData } from "../lib/crypto/e2ee";

/** In-memory cache for profile E2EE public keys with 5-minute TTL */
const profileKeyCache = new Map<string, { key: JsonWebKey | null; expiresAt: number }>();

/**
 * Retrieves the E2EE public key for a profile, using an in-memory cache to avoid repeated D1 reads.
 */
export async function getProfileLogPublicKey(
  db: D1Database,
  profileId: string
): Promise<JsonWebKey | null> {
  const now = Date.now();
  const cached = profileKeyCache.get(profileId);
  if (cached && cached.expiresAt > now) {
    return cached.key;
  }

  try {
    const row = await db
      .prepare("SELECT public_key FROM user_log_keys WHERE profile_id = ?")
      .bind(profileId)
      .first<{ public_key: string }>();

    const key = row?.public_key ? (JSON.parse(row.public_key) as JsonWebKey) : null;
    profileKeyCache.set(profileId, { key, expiresAt: now + 5 * 60 * 1000 });
    return key;
  } catch (err) {
    console.error(`[E2EE] Failed to fetch log public key for profile ${profileId}:`, err);
    return null;
  }
}

/**
 * Invalidates the in-memory E2EE public key cache for a profile.
 */
export function invalidateProfileLogKeyCache(profileId: string): void {
  profileKeyCache.delete(profileId);
}

/** In-memory batch queue of logs waiting to be flushed to D1 */
const logBatchQueue: ResolutionLog[] = [];

/** Maximum number of statements in a single db.batch() transaction */
const MAX_BATCH_SIZE = 50;

/** Debounce time window for micro-batch flushing (15 seconds) */
const FLUSH_INTERVAL_MS = 15_000;

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
 * Flushes a batch of logs to D1 via db.batch().
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

  // Atomically extract up to MAX_BATCH_SIZE raw logs from the front of the queue
  const logsToFlush = logBatchQueue.splice(0, MAX_BATCH_SIZE);

  if (logsToFlush.length === 0) {
    return;
  }

  const logModel = new LogModel(env.DB);
  const statements: D1PreparedStatement[] = [];

  // Group logs by profile to batch E2EE public key lookup
  const profileIds = Array.from(new Set(logsToFlush.map((l) => l.profile_id)));
  const keyMap = new Map<string, JsonWebKey | null>();
  await Promise.all(
    profileIds.map(async (pid) => {
      const pubKey = await getProfileLogPublicKey(env.DB, pid);
      if (pubKey) keyMap.set(pid, pubKey);
    })
  );

  for (const log of logsToFlush) {
    const pubKey = keyMap.get(log.profile_id);
    if (pubKey) {
      try {
        const encrypted = await encryptSensitiveLogData(pubKey, {
          domain: log.domain,
          client_ip: log.client_ip,
          geo_country: log.geo_country,
          answer: log.answer,
          dest_geoip: log.dest_geoip,
          dest_country_code: log.dest_country_code,
          dest_country: log.dest_country,
          dest_isp: log.dest_isp,
          ecs: log.ecs,
          upstream: log.upstream,
          reason: log.reason,
        });

        log.is_encrypted = 1;
        log.encrypted_payload = encrypted;
        log.domain = "";
        log.client_ip = "";
        log.geo_country = "";
        log.answer = undefined;
        log.dest_geoip = undefined;
        log.dest_country_code = null;
        log.dest_country = null;
        log.dest_isp = null;
        log.ecs = undefined;
        log.upstream = undefined;
        log.reason = undefined;
      } catch (encErr) {
        console.error(`[LogBatcher] Encryption failed for profile ${log.profile_id}:`, encErr);
      }
    }
    statements.push(logModel.createInsertStatement(log));
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

  // If there are still items remaining in queue, schedule the next batch
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
 * Enqueues a DNS resolution log for 15-second micro-batching and quota protection.
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

  // 2. Skip logging for PASS queries when skip_log_on_pass is enabled
  const action = (log.action || "PASS").toUpperCase();
  if (settings?.skip_log_on_pass && action === "PASS") {
    return;
  }

  // 3. Fast memory circuit-breaker check
  if (memoryCircuitBreakerUntil > Date.now()) {
    return;
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
    now - lastFlushTime >= FLUSH_INTERVAL_MS
  ) {
    ctx.waitUntil(flushLogBatch(env));
  } else {
    scheduleDeferredFlush(env);
  }
}
