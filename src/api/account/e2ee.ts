/**
 * @file e2ee.ts
 * @description API router for User/Account-level End-to-End Encryption (E2EE) key management.
 * Provides user-scoped endpoints to inspect status, store Passkey wrapped private keys,
 * and enable/disable E2EE across all user profiles simultaneously.
 */

import { Env, User, ExecutionContext } from "../../types";
import { PasskeyModel } from "../../models/passkey";
import { ProfileModel } from "../../models/profile";
import { invalidateProfileLogKeyCache } from "../../pipeline/logBatcher";

/**
 * Routes /api/account/e2ee/* endpoints.
 *
 * @param request Incoming HTTP request
 * @param env Cloudflare worker environment bindings
 * @param user Authenticated user context
 * @param pathParts URL pathname segments
 * @param _ctx Worker execution context
 * @returns JSON response or HTTP error status
 */
export async function handleAccountE2eeRequest(
  request: Request,
  env: Env,
  user: User,
  pathParts: string[],
  _ctx: ExecutionContext
): Promise<Response> {
  const passkeyModel = new PasskeyModel(env.DB);
  const profileModel = new ProfileModel(env.DB);
  const subResource = pathParts[3]; // e.g. /api/account/e2ee/status -> subResource = "status"

  // 1. GET /api/account/e2ee/status
  if (subResource === "status" && request.method === "GET") {
    const [profiles, passkeys] = await Promise.all([
      profileModel.listByOwner(user.id),
      passkeyModel.listByUser(user.id),
    ]);

    let logKey: { public_key: string; created_at: number } | null = null;
    let wrappedKeys: { passkey_id: string }[] = [];
    let recoveryKey: { profile_id: string } | null = null;

    if (profiles.length > 0) {
      const [keyRes, wrappedRes, recRes] = await Promise.all([
        env.DB.prepare(
          "SELECT public_key, created_at FROM user_log_keys WHERE profile_id IN (SELECT id FROM profiles WHERE owner_id = ?) LIMIT 1"
        )
          .bind(user.id)
          .first<{ public_key: string; created_at: number }>(),
        env.DB.prepare(`
          SELECT upwk.passkey_id 
          FROM user_passkey_wrapped_keys upwk
          JOIN passkeys pk ON upwk.passkey_id = pk.id
          WHERE pk.user_id = ?
        `)
          .bind(user.id)
          .all<{ passkey_id: string }>(),
        env.DB.prepare(
          "SELECT profile_id FROM user_recovery_wrapped_keys WHERE profile_id IN (SELECT id FROM profiles WHERE owner_id = ?) LIMIT 1"
        )
          .bind(user.id)
          .first<{ profile_id: string }>(),
      ]);

      logKey = keyRes;
      wrappedKeys = wrappedRes.results || [];
      recoveryKey = recRes;
    }

    return Response.json({
      enabled: Boolean(logKey),
      publicKey: logKey?.public_key || null,
      wrappedPasskeys: wrappedKeys.map((w) => w.passkey_id),
      hasRecoveryKey: Boolean(recoveryKey),
      userPasskeyCount: passkeys.length,
      createdAt: logKey?.created_at || null,
    });
  }

  // 2. GET /api/account/e2ee/wrapped-key?passkey_id=...
  if (subResource === "wrapped-key" && request.method === "GET") {
    const url = new URL(request.url);
    const passkeyId = url.searchParams.get("passkey_id");

    if (!passkeyId) {
      return new Response("Missing passkey_id parameter", { status: 400 });
    }

    const passkey = await passkeyModel.getById(passkeyId, user.id);
    if (!passkey) {
      return new Response("Passkey not found or unauthorized", { status: 403 });
    }

    const wrapped = await env.DB.prepare(
      "SELECT encrypted_sk, iv FROM user_passkey_wrapped_keys WHERE passkey_id = ?"
    )
      .bind(passkeyId)
      .first<{ encrypted_sk: string; iv: string }>();

    if (!wrapped) {
      return new Response("Wrapped key not found for this passkey", { status: 404 });
    }

    return Response.json({
      encryptedSk: wrapped.encrypted_sk,
      iv: wrapped.iv,
    });
  }

  // 3. POST /api/account/e2ee/init (Enable E2EE across all user profiles)
  if (subResource === "init" && request.method === "POST") {
    let body: any;
    try {
      body = await request.json();
    } catch {
      return new Response("Invalid JSON body", { status: 400 });
    }

    const { publicKey, passkeyId, encryptedSk, iv, recovery } = body;
    if (!publicKey || !passkeyId || !encryptedSk || !iv) {
      return new Response("Missing required fields (publicKey, passkeyId, encryptedSk, iv)", {
        status: 400,
      });
    }

    const passkey = await passkeyModel.getById(passkeyId, user.id);
    if (!passkey) {
      return new Response("Passkey not found or unauthorized", { status: 403 });
    }

    const profiles = await profileModel.listByOwner(user.id);
    const now = Math.floor(Date.now() / 1000);
    const publicKeyStr = typeof publicKey === "string" ? publicKey : JSON.stringify(publicKey);

    const stmts: any[] = [];
    const primaryProfileId = profiles.length > 0 ? profiles[0].id : null;

    if (primaryProfileId) {
      // 1. Store wrapped key linked to primary profile
      stmts.push(
        env.DB.prepare(
          "INSERT INTO user_passkey_wrapped_keys (passkey_id, profile_id, encrypted_sk, iv, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(passkey_id) DO UPDATE SET encrypted_sk = excluded.encrypted_sk, iv = excluded.iv, created_at = excluded.created_at"
        ).bind(passkeyId, primaryProfileId, encryptedSk, iv, now)
      );

      // 2. Set public keys for all user profiles
      for (const p of profiles) {
        stmts.push(
          env.DB.prepare(
            "INSERT INTO user_log_keys (profile_id, public_key, created_at) VALUES (?, ?, ?) ON CONFLICT(profile_id) DO UPDATE SET public_key = excluded.public_key, created_at = excluded.created_at"
          ).bind(p.id, publicKeyStr, now)
        );

        if (recovery && recovery.encryptedSk && recovery.iv && recovery.salt) {
          stmts.push(
            env.DB.prepare(
              "INSERT INTO user_recovery_wrapped_keys (profile_id, encrypted_sk, iv, salt, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(profile_id) DO UPDATE SET encrypted_sk = excluded.encrypted_sk, iv = excluded.iv, salt = excluded.salt, created_at = excluded.created_at"
            ).bind(p.id, recovery.encryptedSk, recovery.iv, recovery.salt, now)
          );
        }
      }
    }

    if (stmts.length > 0) {
      await env.DB.batch(stmts);
    }

    for (const p of profiles) {
      invalidateProfileLogKeyCache(p.id);
    }

    return Response.json({ success: true });
  }

  // 4. POST /api/account/e2ee/wrap (Wrap existing SK for newly registered passkey)
  if (subResource === "wrap" && request.method === "POST") {
    let body: any;
    try {
      body = await request.json();
    } catch {
      return new Response("Invalid JSON body", { status: 400 });
    }

    const { passkeyId, encryptedSk, iv } = body;
    if (!passkeyId || !encryptedSk || !iv) {
      return new Response("Missing required fields (passkeyId, encryptedSk, iv)", { status: 400 });
    }

    const passkey = await passkeyModel.getById(passkeyId, user.id);
    if (!passkey) {
      return new Response("Passkey not found or unauthorized", { status: 403 });
    }

    const profiles = await profileModel.listByOwner(user.id);
    const primaryProfileId = profiles.length > 0 ? profiles[0].id : null;
    if (!primaryProfileId) {
      return new Response("No profiles found for user", { status: 400 });
    }

    const now = Math.floor(Date.now() / 1000);
    await env.DB.prepare(
      "INSERT INTO user_passkey_wrapped_keys (passkey_id, profile_id, encrypted_sk, iv, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(passkey_id) DO UPDATE SET encrypted_sk = excluded.encrypted_sk, iv = excluded.iv, created_at = excluded.created_at"
    )
      .bind(passkeyId, primaryProfileId, encryptedSk, iv, now)
      .run();

    return Response.json({ success: true });
  }

  // 5. DELETE /api/account/e2ee (Disable E2EE across all user profiles)
  if (request.method === "DELETE" && (!subResource || subResource === "keys")) {
    const profiles = await profileModel.listByOwner(user.id);

    await env.DB.batch([
      env.DB.prepare("DELETE FROM user_log_keys WHERE profile_id IN (SELECT id FROM profiles WHERE owner_id = ?)").bind(user.id),
      env.DB.prepare("DELETE FROM user_passkey_wrapped_keys WHERE passkey_id IN (SELECT id FROM passkeys WHERE user_id = ?)").bind(user.id),
      env.DB.prepare("DELETE FROM user_recovery_wrapped_keys WHERE profile_id IN (SELECT id FROM profiles WHERE owner_id = ?)").bind(user.id),
    ]);

    for (const p of profiles) {
      invalidateProfileLogKeyCache(p.id);
    }

    return Response.json({ success: true });
  }

  return new Response("Not Found", { status: 404 });
}
