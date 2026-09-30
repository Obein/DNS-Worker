/**
 * @file e2ee.ts
 * @description API router for Profile Log End-to-End Encryption (E2EE) key management.
 * Handles public key publishing, Passkey envelope wrapped key storage, and key rotation.
 */

import { Env, User, Profile, ExecutionContext } from "../../types";
import { PasskeyModel } from "../../models/passkey";
import { invalidateProfileLogKeyCache } from "../../pipeline/logBatcher";

/**
 * Routes /api/profiles/:id/e2ee/* endpoints.
 */
export async function handleProfileE2eeRequest(
  request: Request,
  env: Env,
  user: User,
  profile: Profile,
  pathParts: string[],
  _ctx: ExecutionContext
): Promise<Response> {
  const passkeyModel = new PasskeyModel(env.DB);
  const subResource = pathParts[4]; // e.g. status, wrapped-key, init, wrap

  // 1. GET /api/profiles/:id/e2ee/status
  if (subResource === "status" && request.method === "GET") {
    const [logKey, wrappedKeys, recoveryKey, passkeys] = await Promise.all([
      env.DB.prepare("SELECT public_key, created_at FROM user_log_keys WHERE profile_id = ?")
        .bind(profile.id)
        .first<{ public_key: string; created_at: number }>(),
      env.DB.prepare(`
        SELECT upwk.passkey_id 
        FROM user_passkey_wrapped_keys upwk
        JOIN passkeys pk ON upwk.passkey_id = pk.id
        WHERE pk.user_id = ?
      `)
        .bind(user.id)
        .all<{ passkey_id: string }>(),
      env.DB.prepare("SELECT profile_id FROM user_recovery_wrapped_keys WHERE profile_id = ?")
        .bind(profile.id)
        .first<{ profile_id: string }>(),
      passkeyModel.listByUser(user.id),
    ]);

    return Response.json({
      enabled: Boolean(logKey),
      publicKey: logKey?.public_key || null,
      wrappedPasskeys: (wrappedKeys.results || []).map((w) => w.passkey_id),
      hasRecoveryKey: Boolean(recoveryKey),
      userPasskeyCount: passkeys.length,
      createdAt: logKey?.created_at || null,
    });
  }

  // 2. GET /api/profiles/:id/e2ee/wrapped-key?passkey_id=...
  if (subResource === "wrapped-key" && request.method === "GET") {
    const url = new URL(request.url);
    const passkeyId = url.searchParams.get("passkey_id");

    if (!passkeyId) {
      return new Response("Missing passkey_id parameter", { status: 400 });
    }

    const passkey = await passkeyModel.getByIdOrCredentialId(passkeyId, user.id);
    if (!passkey) {
      return new Response("Passkey not found or unauthorized", { status: 403 });
    }

    const wrapped = await env.DB.prepare(
      "SELECT encrypted_sk, iv FROM user_passkey_wrapped_keys WHERE passkey_id = ?"
    )
      .bind(passkey.id)
      .first<{ encrypted_sk: string; iv: string }>();

    if (!wrapped) {
      return new Response("Wrapped key not found for this passkey", { status: 404 });
    }

    return Response.json({
      encryptedSk: wrapped.encrypted_sk,
      iv: wrapped.iv,
    });
  }

  // 3. POST /api/profiles/:id/e2ee/init (Enable E2EE)
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

    // Verify the passkey belongs to this user
    let passkey = await passkeyModel.getByIdOrCredentialId(passkeyId, user.id);
    if (!passkey) {
      const userPasskeys = await passkeyModel.listByUser(user.id);
      if (userPasskeys.length > 0) {
        passkey = userPasskeys[0];
      }
    }
    if (!passkey) {
      return new Response("Passkey not found or unauthorized", { status: 403 });
    }

    const now = Math.floor(Date.now() / 1000);
    const publicKeyStr = typeof publicKey === "string" ? publicKey : JSON.stringify(publicKey);

    const stmts = [
      env.DB.prepare(
        "INSERT INTO user_log_keys (profile_id, public_key, created_at) VALUES (?, ?, ?) ON CONFLICT(profile_id) DO UPDATE SET public_key = excluded.public_key, created_at = excluded.created_at"
      ).bind(profile.id, publicKeyStr, now),
      env.DB.prepare(
        "INSERT INTO user_passkey_wrapped_keys (passkey_id, profile_id, encrypted_sk, iv, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(passkey_id) DO UPDATE SET encrypted_sk = excluded.encrypted_sk, iv = excluded.iv, created_at = excluded.created_at"
      ).bind(passkey.id, profile.id, encryptedSk, iv, now),
    ];

    if (recovery && recovery.encryptedSk && recovery.iv && recovery.salt) {
      stmts.push(
        env.DB.prepare(
          "INSERT INTO user_recovery_wrapped_keys (profile_id, encrypted_sk, iv, salt, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(profile_id) DO UPDATE SET encrypted_sk = excluded.encrypted_sk, iv = excluded.iv, salt = excluded.salt, created_at = excluded.created_at"
        ).bind(profile.id, recovery.encryptedSk, recovery.iv, recovery.salt, now)
      );
    }

    await env.DB.batch(stmts);
    invalidateProfileLogKeyCache(profile.id);

    return Response.json({ success: true });
  }

  // 4. POST /api/profiles/:id/e2ee/wrap (Wrap existing SK for a newly registered passkey)
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

    let passkey = await passkeyModel.getByIdOrCredentialId(passkeyId, user.id);
    if (!passkey) {
      const userPasskeys = await passkeyModel.listByUser(user.id);
      if (userPasskeys.length > 0) {
        passkey = userPasskeys[0];
      }
    }
    if (!passkey) {
      return new Response("Passkey not found or unauthorized", { status: 403 });
    }

    const now = Math.floor(Date.now() / 1000);
    await env.DB.prepare(
      "INSERT INTO user_passkey_wrapped_keys (passkey_id, profile_id, encrypted_sk, iv, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(passkey_id) DO UPDATE SET encrypted_sk = excluded.encrypted_sk, iv = excluded.iv, created_at = excluded.created_at"
    )
      .bind(passkey.id, profile.id, encryptedSk, iv, now)
      .run();

    return Response.json({ success: true });
  }

  // 5. DELETE /api/profiles/:id/e2ee (Disable E2EE for this profile)
  if (request.method === "DELETE" && (!subResource || subResource === "keys")) {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM user_log_keys WHERE profile_id = ?").bind(profile.id),
      env.DB.prepare("DELETE FROM user_passkey_wrapped_keys WHERE profile_id = ?").bind(profile.id),
      env.DB.prepare("DELETE FROM user_recovery_wrapped_keys WHERE profile_id = ?").bind(profile.id),
    ]);

    invalidateProfileLogKeyCache(profile.id);
    return Response.json({ success: true });
  }

  return new Response("Not Found", { status: 404 });
}
