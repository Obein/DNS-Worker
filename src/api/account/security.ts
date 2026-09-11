import { Env, User, ExecutionContext } from "../../types";
import { hashPassword, verifyPassword, generateSessionHash } from "../../utils/crypto";
import { generateTOTPSecret, getTOTPUri, generateRecoveryKeys, hashRecoveryKey, verifyTOTP } from "../../lib/totp";
import { UserModel } from "../../models/user";
import { ActivityLogModel } from "../../models/activityLog";
import { PASSWORD_REGEX, PASSKEY_NAME_REGEX } from "../../utils/validator";
import { PasskeyModel } from "../../models/passkey";
import {
  generateWebAuthnChallenge,
  base64UrlEncode,
  verifyRegistrationResponse
} from "../../lib/webauthn";
import { cacheUtils } from "../../utils/cache";

/**
 * Handle security credentials requests to /api/account/password and /api/account/totp/...
 */
export async function handleSecurityRequest(
  request: Request,
  env: Env,
  user: User,
  pathParts: string[],
  ctx: ExecutionContext
): Promise<Response> {
  const userModel = new UserModel(env.DB, env);
  const activityLog = new ActivityLogModel(env.DB);
  const clientIp = request.headers.get("CF-Connecting-IP") || "127.0.0.1";
  const userAgent = request.headers.get("User-Agent");
  const action = pathParts[2];

  const sessionHash = user.sessionId ? await generateSessionHash(user.sessionId, user.id) : null;

  // POST /api/account/password (password change)
  if (action === 'password' && request.method === 'POST') {
    const { oldPassword, totpTokenHash, totpSalt, newPassword } = await request.json() as any;
    if (!newPassword || !PASSWORD_REGEX.test(newPassword)) {
      return new Response("Password format error", { status: 400 });
    }
    const dbUser = await userModel.getById(user.id);
    if (!dbUser) return new Response("User not found", { status: 404 });

    let authenticated = false;

    // 如果提供了 TOTP Token，并且用户启用了 TOTP，则使用 TOTP 校验
    if (totpTokenHash && dbUser.totp_enabled && dbUser.totp_secret) {
      authenticated = await verifyTOTP(dbUser.totp_secret, totpTokenHash, totpSalt);
      if (!authenticated) {
        await activityLog.record(user.id, 'password_change_fail', clientIp, userAgent, { reason: 'invalid_totp' }, sessionHash);
        return new Response("Invalid TOTP code", { status: 400 });
      }
    } 
    // 否则使用旧密码校验
    else if (oldPassword) {
      authenticated = await verifyPassword(oldPassword, dbUser.hashed_password, dbUser.password_version ?? 1);
      if (!authenticated) {
        await activityLog.record(user.id, 'password_change_fail', clientIp, userAgent, { reason: 'wrong_current_password' }, sessionHash);
        return new Response("Current password is incorrect", { status: 400 });
      }
    } 
    else {
      return new Response("Authentication required (Old Password or TOTP)", { status: 400 });
    }

    const hashedPassword = await hashPassword(newPassword, 2);
    await userModel.updatePassword(user.id, hashedPassword, 2);
    await activityLog.record(user.id, 'password_change_success', clientIp, userAgent, { method: totpTokenHash ? 'totp' : 'password' }, sessionHash);
    return new Response(JSON.stringify({ success: true }));
  }

  // POST /api/account/migrate-password (password migration to v2)
  if (action === 'migrate-password' && request.method === 'POST') {
    const { clientHash } = await request.json() as any;
    if (!clientHash) {
      return new Response("Missing clientHash", { status: 400 });
    }
    const dbUser = await userModel.getById(user.id);
    if (!dbUser) return new Response("User not found", { status: 404 });

    if ((dbUser.password_version ?? 1) === 1) {
      const hashedPassword = await hashPassword(clientHash, 2);
      await userModel.updatePassword(user.id, hashedPassword, 2);
      await activityLog.record(user.id, 'password_change_success', clientIp, userAgent, { method: 'migration' }, sessionHash);
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // ─── TOTP 管理接口 (/api/account/totp/...) ───
  if (action === 'totp') {
    const subAction = pathParts[3];

    // GET /api/account/totp/setup — generate new TOTP secret (not yet saved)
    if (subAction === 'setup' && request.method === 'GET') {
      const dbUser = await userModel.getById(user.id);
      if (dbUser?.totp_enabled) {
        return new Response("TOTP is already enabled", { status: 409 });
      }
      const secret = generateTOTPSecret();
      const host = new URL(request.url).hostname;
      const uri = getTOTPUri(secret, dbUser?.username || 'user', host);
      return new Response(JSON.stringify({ secret, uri }), { headers: { 'Content-Type': 'application/json' } });
    }

    // POST /api/account/totp/confirm — verify TOTP code and activate
    if (subAction === 'confirm' && request.method === 'POST') {
      const { secret, totpTokenHash, salt } = await request.json() as { secret: string; totpTokenHash: string; salt?: string };
      if (!secret || !totpTokenHash) return new Response("Missing secret or token", { status: 400 });

      const isValid = await verifyTOTP(secret, totpTokenHash, salt);
      if (!isValid) return new Response("Invalid TOTP code", { status: 400 });

      // Generate 8 recovery keys, hash them for storage, return plaintext once
      const plaintextKeys = generateRecoveryKeys();
      const hashedKeys = await Promise.all(plaintextKeys.map(hashRecoveryKey));

      await userModel.updateTOTP(user.id, secret, hashedKeys);
      // Default to passwordless login upon enabling MFA
      await userModel.updateTOTPSettings(user.id, true);
      await activityLog.record(user.id, 'totp_setup', clientIp, userAgent, undefined, sessionHash);

      return new Response(JSON.stringify({ success: true, recovery_keys: plaintextKeys }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // PATCH /api/account/totp/settings — update skip_password toggle (supported when TOTP or Passkey is configured)
    if (subAction === 'settings' && request.method === 'PATCH') {
      const dbUser = await userModel.getById(user.id);
      const passkeyModel = new PasskeyModel(env.DB);
      const passkeys = await passkeyModel.listByUser(user.id);
      const hasMfa = !!dbUser?.totp_enabled || passkeys.length > 0;
      if (!hasMfa) return new Response("MFA is not enabled", { status: 400 });

      const { skip_password } = await request.json() as { skip_password: boolean };
      await userModel.updateTOTPSettings(user.id, !!skip_password);
      return new Response(JSON.stringify({ success: true }));
    }

    // DELETE /api/account/totp — disable TOTP (requires password verification)
    if (!subAction && request.method === 'DELETE') {
      const { password } = await request.json() as { password: string };
      const dbUser = await userModel.getById(user.id);
      if (!dbUser) return new Response("User not found", { status: 404 });

      // If the user is in skip_password mode, they may not have a usable password — allow
      // them to disable via TOTP token instead
      if (!dbUser.totp_skip_password) {
        if (!password || !(await verifyPassword(password, dbUser.hashed_password, dbUser.password_version ?? 1))) {
          return new Response("Incorrect password", { status: 400 });
        }
      }

      const passkeyModel = new PasskeyModel(env.DB);
      const passkeys = await passkeyModel.listByUser(user.id);
      const hasPasskey = passkeys.length > 0;

      await userModel.removeTOTP(user.id, hasPasskey);
      await activityLog.record(user.id, 'totp_removed', clientIp, userAgent, undefined, sessionHash);
      return new Response(JSON.stringify({ success: true }));
    }
  }

  // ─── PIN 管理接口 (/api/account/pin) ───
  if (action === 'pin') {
    const dbUser = await userModel.getById(user.id);
    if (!dbUser) return new Response("User not found", { status: 404 });

    const body = await request.json() as any;
    const { password, totpTokenHash, totpSalt } = body;

    // 验证用户身份 (密码或 TOTP)
    let authenticated = false;
    if (totpTokenHash && dbUser.totp_enabled && dbUser.totp_secret) {
      authenticated = await verifyTOTP(dbUser.totp_secret, totpTokenHash, totpSalt);
      if (!authenticated) {
        return new Response("Invalid TOTP code", { status: 400 });
      }
    } else if (password) {
      authenticated = await verifyPassword(password, dbUser.hashed_password, dbUser.password_version ?? 1);
      if (!authenticated) {
        return new Response("Incorrect password", { status: 400 });
      }
    } else {
      return new Response("Authentication required", { status: 400 });
    }

    if (request.method === 'POST') {
      const { pinHash } = body;
      // 验证 PIN 格式是否为 64 位十六进制哈希
      if (!pinHash || !/^[a-fA-F0-9]{64}$/.test(pinHash)) {
        return new Response("Invalid PIN hash format", { status: 400 });
      }

      // Store the client-side PIN hash directly to support challenge-response unlock verification
      await userModel.updatePinHash(user.id, pinHash);
      return new Response(JSON.stringify({ success: true }));
    }

    if (request.method === 'DELETE') {
      await userModel.updatePinHash(user.id, null);
      return new Response(JSON.stringify({ success: true }));
    }
  }

  // ─── Passkey 管理接口 (/api/account/passkeys/...) ───
  if (action === 'passkeys') {
    const passkeyModel = new PasskeyModel(env.DB);
    const subAction = pathParts[3];

    // GET /api/account/passkeys — 列出当前用户的所有通行密钥
    if (!subAction && request.method === 'GET') {
      const passkeys = await passkeyModel.listByUser(user.id);
      return new Response(JSON.stringify(passkeys), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // POST /api/account/passkeys/register/options — 生成通行密钥注册挑战与参数
    if (subAction === 'register' && pathParts[4] === 'options' && request.method === 'POST') {
      const existingPasskeys = await passkeyModel.listByUser(user.id);
      const challenge = generateWebAuthnChallenge();
      const originHeader = request.headers.get("origin");
      const host = originHeader ? new URL(originHeader).hostname : request.headers.get("host")?.split(":")[0] || new URL(request.url).hostname;
      const rpId = host;
      const cache = (caches as any).default;
      await cacheUtils.set(cache, `webauthn_reg_challenge:${user.id}`, { challenge, rpId }, 300);

      const dbUser = await userModel.getById(user.id);
      const username = dbUser?.username || user.username || "";
      const userDisplayName = username ? `${username} (${rpId})` : rpId;

      const options = {
        challenge,
        rp: {
          name: rpId,
          id: rpId
        },
        user: {
          id: base64UrlEncode(new TextEncoder().encode(user.id)),
          name: username || rpId,
          displayName: userDisplayName
        },
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },  // ES256
          { type: "public-key", alg: -257 } // RS256
        ],
        authenticatorSelection: {
          userVerification: "preferred",
          residentKey: "preferred"
        },
        timeout: 60000,
        excludeCredentials: existingPasskeys.map(p => ({
          id: p.credential_id,
          type: "public-key",
          transports: p.transports ? JSON.parse(p.transports) : undefined
        }))
      };

      return new Response(JSON.stringify(options), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // POST /api/account/passkeys/register/verify — 验证注册响应并保存通行密钥
    if (subAction === 'register' && pathParts[4] === 'verify' && request.method === 'POST') {
      const cache = (caches as any).default;
      const cachedState = await cacheUtils.get<{ challenge: string; rpId: string }>(cache, `webauthn_reg_challenge:${user.id}`);
      if (!cachedState) {
        return new Response("Registration session expired, please try again", { status: 400 });
      }
      await cacheUtils.delete(cache, `webauthn_reg_challenge:${user.id}`);

      const body = await request.json() as any;
      const { name, credential } = body;
      if (!credential || !credential.response) {
        return new Response("Invalid credential data", { status: 400 });
      }

      try {
        const parsed = await verifyRegistrationResponse({
          clientDataJSON: credential.response.clientDataJSON,
          attestationObject: credential.response.attestationObject,
          expectedChallenge: cachedState.challenge,
          expectedOrigin: request.headers.get("origin") || `https://${cachedState.rpId}`,
          expectedRpId: cachedState.rpId
        });

        // Check if credential ID is already registered
        const existing = await passkeyModel.getByCredentialId(parsed.credentialId);
        if (existing) {
          return new Response("This passkey is already registered", { status: 409 });
        }

        const passkeyName = (name || "").trim();
        if (!PASSKEY_NAME_REGEX.test(passkeyName)) {
          return new Response("Invalid Passkey name format", { status: 400 });
        }
        const transports = Array.isArray(credential.response.transports) ? credential.response.transports : undefined;

        const created = await passkeyModel.create({
          userId: user.id,
          name: passkeyName,
          credentialId: parsed.credentialId,
          publicKey: parsed.publicKeySpki,
          algorithm: parsed.algorithm,
          signCount: parsed.signCount,
          transports,
          aaguid: parsed.aaguid
        });

        // Default to passwordless login upon enabling MFA
        await userModel.updateTOTPSettings(user.id, true);

        const dbUser = await userModel.getById(user.id);
        let recoveryKeys: string[] | undefined = undefined;
        if (dbUser && !dbUser.totp_recovery_keys) {
          const plaintextKeys = generateRecoveryKeys();
          const hashedKeys = await Promise.all(plaintextKeys.map(hashRecoveryKey));
          await userModel.updateRecoveryKeys(user.id, hashedKeys);
          recoveryKeys = plaintextKeys;
        }

        await activityLog.record(user.id, 'passkey_registered', clientIp, userAgent, { name: passkeyName }, sessionHash);
        return new Response(JSON.stringify({ ...created, recovery_keys: recoveryKeys }), { status: 201, headers: { 'Content-Type': 'application/json' } });
      } catch (err: any) {
        console.warn("[Passkey Registration] Verification failed:", err.message || err);
        return new Response(err.message || "Passkey registration failed", { status: 400 });
      }
    }

    // PATCH /api/account/passkeys/:id — 重命名通行密钥
    if (subAction && request.method === 'PATCH') {
      const passkeyId = subAction;
      const { name } = await request.json() as { name: string };
      const trimmedName = (name || "").trim();
      if (!trimmedName || !PASSKEY_NAME_REGEX.test(trimmedName)) {
        return new Response("Invalid Passkey name format", { status: 400 });
      }

      const passkey = await passkeyModel.getById(passkeyId, user.id);
      if (!passkey) return new Response("Passkey not found", { status: 404 });

      const success = await passkeyModel.updateName(passkeyId, user.id, trimmedName);
      return new Response(JSON.stringify({ success }), { headers: { 'Content-Type': 'application/json' } });
    }

    // DELETE /api/account/passkeys/:id — 删除通行密钥
    if (subAction && request.method === 'DELETE') {
      const passkeyId = subAction;
      const passkey = await passkeyModel.getById(passkeyId, user.id);
      if (!passkey) return new Response("Passkey not found", { status: 404 });

      await passkeyModel.delete(passkeyId, user.id);
      await activityLog.record(user.id, 'passkey_deleted', clientIp, userAgent, { name: passkey.name }, sessionHash);

      // 若用户不再拥有任何 Passkey 且未启用 TOTP，则自动关闭无密码登录
      const remainingPasskeys = await passkeyModel.countByUser(user.id);
      const dbUser = await userModel.getById(user.id);
      if (remainingPasskeys === 0 && !dbUser?.totp_enabled) {
        await userModel.updateTOTPSettings(user.id, false);
      }

      return new Response(JSON.stringify({ success: true }));
    }
  }

  // ─── 统一 MFA 设置接口 (/api/account/mfa/settings) ───
  if (action === 'mfa' && pathParts[3] === 'settings' && request.method === 'PATCH') {
    const dbUser = await userModel.getById(user.id);
    const passkeyModel = new PasskeyModel(env.DB);
    const passkeys = await passkeyModel.listByUser(user.id);
    const hasMfa = !!dbUser?.totp_enabled || passkeys.length > 0;
    if (!hasMfa) return new Response("MFA is not enabled", { status: 400 });

    const { skip_password } = await request.json() as { skip_password: boolean };
    await userModel.updateTOTPSettings(user.id, !!skip_password);
    return new Response(JSON.stringify({ success: true }));
  }

  return new Response("Not Found", { status: 404 });
}
