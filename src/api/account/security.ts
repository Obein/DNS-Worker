import { Env, User, ExecutionContext } from "../../types";
import { hashPassword, verifyPassword, generateSessionHash } from "../../utils/crypto";
import { generateTOTPSecret, getTOTPUri, generateRecoveryKeys, hashRecoveryKey, verifyTOTP } from "../../lib/totp";
import { UserModel } from "../../models/user";
import { ActivityLogModel } from "../../models/activityLog";
import { PASSWORD_REGEX } from "../../utils/validator";

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
      const uri = getTOTPUri(secret, dbUser?.username || 'user', 'DNS Worker');
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
      await activityLog.record(user.id, 'totp_setup', clientIp, userAgent, undefined, sessionHash);

      return new Response(JSON.stringify({ success: true, recovery_keys: plaintextKeys }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // PATCH /api/account/totp/settings — update skip_password toggle
    if (subAction === 'settings' && request.method === 'PATCH') {
      const dbUser = await userModel.getById(user.id);
      if (!dbUser?.totp_enabled) return new Response("TOTP is not enabled", { status: 400 });

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

      await userModel.removeTOTP(user.id);
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

  return new Response("Not Found", { status: 404 });
}
