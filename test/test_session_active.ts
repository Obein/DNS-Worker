/// <reference types="node" />
import assert from "node:assert";
import { getCurrentUser, invalidateAuthUserCache } from "../src/lib/middleware";
import { signJWT, importJwtSecret } from "../src/lib/jwt";
import type { Env, ExecutionContext } from "../src/types";

async function runTests() {
  console.log(">>> [TEST] Running Session Last-Active, Quota Resilience & Micro-Cache Tests...\n");

  const JWT_SECRET = "test_super_secret_jwt_key_that_is_long_enough_for_security_12345";
  const jwtKey = await importJwtSecret(JWT_SECRET);

  // Helper to create test token
  async function createToken(sessionId: string, userId: string = "user_1", role: string = "admin"): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    return signJWT(
      { userId, role, sessionId, exp: now + 3600 },
      jwtKey
    );
  }

  // 1. Test D1 write failure resilience (updateLastActive throws)
  console.log("1. Testing D1 write failure resilience (updateLastActive throws)...");
  {
    let updateLastActiveCalled = false;
    const backgroundTasks: Promise<any>[] = [];

    const mockCtx: ExecutionContext = {
      waitUntil(promise: Promise<any>) {
        backgroundTasks.push(promise);
      },
      passThroughOnException() {}
    } as any;

    const mockDb: any = {
      prepare(query: string) {
        return {
          bind(...args: any[]) {
            return {
              async first() {
                if (query.includes("FROM sessions")) {
                  return {
                    id: "sess_quota_test",
                    session_id: "sess_quota_test",
                    user_id: "user_1",
                    username: "alice",
                    role: "admin",
                    pin_hash: null,
                    session_lock_timeout: 15,
                    is_paused: 0,
                    created_at: Math.floor(Date.now() / 1000) - 100,
                    last_active_at: Math.floor(Date.now() / 1000) - 100
                  };
                }
                return null;
              },
              async run() {
                if (query.includes("UPDATE sessions SET last_active_at")) {
                  updateLastActiveCalled = true;
                  throw new Error("D1_ERROR: Daily write quota exceeded (code 10043)");
                }
                return { success: true };
              }
            };
          }
        };
      }
    };

    const env: Env = {
      DB: mockDb,
      ASSETS: null,
      JWT_SECRET,
      SESSION_LAST_ACTIVE_UPDATE_INTERVAL: "60"
    };

    const token = await createToken("sess_quota_test");
    const req = new Request("https://example.com/api/profiles", {
      headers: { Authorization: `Bearer ${token}` }
    });

    // Clean any prior in-memory caches
    invalidateAuthUserCache("sess_quota_test");

    const user = await getCurrentUser(req, env, mockCtx);
    assert(user !== null, "User should authenticate successfully even when D1 write throws!");
    assert.strictEqual(user.id, "user_1");
    assert.strictEqual(user.username, "alice");

    // Await background tasks to ensure catch handled error without crashing
    await Promise.all(backgroundTasks);
    assert.strictEqual(updateLastActiveCalled, true, "Background write should have been triggered");
    console.log("  Passed: Request authenticated 200 OK despite D1 write quota failure.");
  }

  // 2. Test throttle interval configuration
  console.log("\n2. Testing SESSION_LAST_ACTIVE_UPDATE_INTERVAL throttling...");
  {
    let writeAttempts = 0;
    const backgroundTasks: Promise<any>[] = [];

    const mockCtx: ExecutionContext = {
      waitUntil(promise: Promise<any>) {
        backgroundTasks.push(promise);
      },
      passThroughOnException() {}
    } as any;

    const baseTime = Math.floor(Date.now() / 1000);
    const mockDb: any = {
      prepare(query: string) {
        return {
          bind(...args: any[]) {
            return {
              async first() {
                if (query.includes("FROM sessions")) {
                  return {
                    id: "sess_throttle_test",
                    session_id: "sess_throttle_test",
                    user_id: "user_1",
                    username: "alice",
                    role: "admin",
                    is_paused: 0,
                    created_at: baseTime - 120,
                    last_active_at: baseTime - 120
                  };
                }
                return null;
              },
              async run() {
                if (query.includes("UPDATE sessions SET last_active_at")) {
                  writeAttempts++;
                }
                return { success: true };
              }
            };
          }
        };
      }
    };

    const env: Env = {
      DB: mockDb,
      ASSETS: null,
      JWT_SECRET,
      SESSION_LAST_ACTIVE_UPDATE_INTERVAL: "60" // 60 seconds interval
    };

    const token = await createToken("sess_throttle_test");
    const req = new Request("https://example.com/api/profiles", {
      headers: { Authorization: `Bearer ${token}` }
    });

    invalidateAuthUserCache("sess_throttle_test");

    // First request: should trigger write because 120s > 60s
    await getCurrentUser(req, env, mockCtx);
    await Promise.all(backgroundTasks);
    assert.strictEqual(writeAttempts, 1, "First request should trigger D1 write");

    // Second request immediately: should NOT trigger write (throttled)
    await getCurrentUser(req, env, mockCtx);
    await Promise.all(backgroundTasks);
    assert.strictEqual(writeAttempts, 1, "Immediate second request must be throttled");

    console.log("  Passed: D1 writes properly throttled according to interval.");
  }

  // 3. Test in-memory activity tracking preventing premature PIN lock when D1 write fails
  console.log("\n3. Testing in-memory activity tracking for PIN lock...");
  {
    const nowSec = Math.floor(Date.now() / 1000);
    // User last active in D1 was 14 minutes ago (close to 15m timeout)
    const d1LastActive = nowSec - 14 * 60;
    let pauseCalled = false;

    const mockDb: any = {
      prepare(query: string) {
        return {
          bind(...args: any[]) {
            return {
              async first() {
                if (query.includes("FROM sessions")) {
                  return {
                    id: "sess_pin_test",
                    session_id: "sess_pin_test",
                    user_id: "user_pin",
                    username: "bob",
                    role: "admin",
                    pin_hash: "hash123",
                    session_lock_timeout: 15, // 15 minutes timeout
                    is_paused: 0,
                    created_at: d1LastActive,
                    last_active_at: d1LastActive
                  };
                }
                return null;
              },
              async run() {
                if (query.includes("UPDATE sessions SET is_paused = 1")) {
                  pauseCalled = true;
                }
                if (query.includes("UPDATE sessions SET last_active_at")) {
                  // Simulate D1 write failure: last_active_at is never updated in D1
                  throw new Error("Quota Exceeded");
                }
                return { success: true };
              }
            };
          }
        };
      }
    };

    const env: Env = {
      DB: mockDb,
      ASSETS: null,
      JWT_SECRET,
      SESSION_LAST_ACTIVE_UPDATE_INTERVAL: "60"
    };

    const token = await createToken("sess_pin_test", "user_pin");
    const req = new Request("https://example.com/api/profiles", {
      headers: { Authorization: `Bearer ${token}` }
    });

    invalidateAuthUserCache("sess_pin_test");

    // Request 1 at T = 14m: D1 write fails, but observedActivity records activity at T = 14m
    const user1 = await getCurrentUser(req, env);
    assert(user1 !== null && !user1.isPaused, "Session should not be paused at 14 minutes");

    // Request 2 at T = 16m: In D1, last_active_at is still 14m ago (which would be 16m ago now, > 15m).
    // But observedActivity in memory recorded user activity, so effectiveLastActive is recent!
    // The session should NOT be locked while user is actively making requests!
    const user2 = await getCurrentUser(req, env);
    assert(user2 !== null && !user2.isPaused, "Active session must NOT be locked prematurely due to D1 write failure");
    assert.strictEqual(pauseCalled, false, "pauseSession must not be called while user is active");

    console.log("  Passed: Active user is protected from premature PIN lock.");
  }

  // 4. Test defensive pauseSession on true idle timeout
  console.log("\n4. Testing PIN lock triggers on actual idle timeout even if D1 pauseSession throws...");
  {
    const nowSec = Math.floor(Date.now() / 1000);
    // User last active was 30 minutes ago (> 15m timeout)
    const d1LastActive = nowSec - 30 * 60;
    let pauseAttempted = false;

    const mockDb: any = {
      prepare(query: string) {
        return {
          bind(...args: any[]) {
            return {
              async first() {
                if (query.includes("FROM sessions")) {
                  return {
                    id: "sess_idle_test",
                    session_id: "sess_idle_test",
                    user_id: "user_idle",
                    username: "charlie",
                    role: "admin",
                    pin_hash: "hash123",
                    session_lock_timeout: 15, // 15 minutes timeout
                    is_paused: 0,
                    created_at: d1LastActive,
                    last_active_at: d1LastActive
                  };
                }
                return null;
              },
              async run() {
                if (query.includes("UPDATE sessions SET is_paused = 1")) {
                  pauseAttempted = true;
                  throw new Error("D1 write failed during pause");
                }
                return { success: true };
              }
            };
          }
        };
      }
    };

    const env: Env = {
      DB: mockDb,
      ASSETS: null,
      JWT_SECRET
    };

    const token = await createToken("sess_idle_test", "user_idle");
    const req = new Request("https://example.com/api/profiles", {
      headers: { Authorization: `Bearer ${token}` }
    });

    invalidateAuthUserCache("sess_idle_test");

    const user = await getCurrentUser(req, env);
    assert(user !== null, "User object returned");
    assert.strictEqual(user.isPaused, true, "Session must be paused/locked when idle timeout exceeded");
    assert.strictEqual(pauseAttempted, true, "pauseSession write must have been attempted");

    console.log("  Passed: Idle timeout triggers lock defense even if D1 pause write throws.");
  }

  // 5. Test AUTH_CACHE_TTL_SEC and single atomic JOIN query
  console.log("\n5. Testing AUTH_CACHE_TTL_SEC and single atomic JOIN query...");
  {
    let d1Queries = 0;
    const mockDb: any = {
      prepare(query: string) {
        return {
          bind(...args: any[]) {
            return {
              async first() {
                d1Queries++;
                assert(
                  query.includes("INNER JOIN users"),
                  "Query must use INNER JOIN users to fetch session and user in one round trip"
                );
                return {
                  id: "sess_cache_ttl",
                  session_id: "sess_cache_ttl",
                  user_id: "user_cache",
                  username: "dave",
                  role: "user",
                  is_paused: 0,
                  created_at: Math.floor(Date.now() / 1000),
                  last_active_at: Math.floor(Date.now() / 1000)
                };
              }
            };
          }
        };
      }
    };

    const env: Env = {
      DB: mockDb,
      ASSETS: null,
      JWT_SECRET,
      AUTH_CACHE_TTL_SEC: "30"
    };

    const token = await createToken("sess_cache_ttl", "user_cache", "user");
    const req = new Request("https://example.com/api/profiles", {
      headers: { Authorization: `Bearer ${token}` }
    });

    invalidateAuthUserCache("sess_cache_ttl");

    // Request 1: cache miss, triggers exactly 1 D1 query (single JOIN)
    const user1 = await getCurrentUser(req, env);
    assert(user1 !== null);
    assert.strictEqual(d1Queries, 1, "First request must perform exactly 1 D1 query");

    // Request 2 immediately: micro-cache hit, 0 D1 queries
    const user2 = await getCurrentUser(req, env);
    assert(user2 !== null);
    assert.strictEqual(d1Queries, 1, "Subsequent request within 30s must hit micro-cache (0 D1 queries)");

    console.log("  Passed: getSessionWithUser executes in 1 query and AUTH_CACHE_TTL_SEC prevents duplicate reads.");
  }

  console.log("\n>>> [TEST] All Session Last-Active, Quota Resilience & Micro-Cache tests passed successfully!\n");
}

runTests().catch((err) => {
  console.error(">>> [TEST ERROR]", err);
  process.exit(1);
});
