import { Env } from "../../types";
import { UserModel } from "../../models/user";
import { ActivityLogModel } from "../../models/activityLog";
import { PasskeyModel } from "../../models/passkey";
import { SessionModel } from "../../models/session";
import { SystemSettingsModel } from "../../models/systemSettings";
import { cacheUtils } from "../../utils/cache";
import { generateId, hashPassword } from "../../utils/crypto";
import { PASSWORD_REGEX } from "../../utils/validator";
import { verifyTurnstile } from "./utils";
import { generateWebAuthnChallenge, verifyAuthenticationResponse } from "../../lib/webauthn";
import { verifyTOTP, findMatchingRecoveryKey } from "../../lib/totp";

interface RecoveryState {
  userId: string;
  username: string;
  passkeyChallenge?: string | null;
  rpId: string;
  failedAttempts: number;
}

interface ResetState {
  userId: string;
  username: string;
}

/**
 * Handles the 3-step MFA-based Forgot Password flow:
 * 1. POST /api/auth/forgot-password/init   — identify user, return available MFA options & challenge
 * 2. POST /api/auth/forgot-password/verify — verify Passkey, TOTP, or Recovery Key, issue resetToken
 * 3. POST /api/auth/forgot-password/reset  — consume resetToken, set new password, revoke sessions
 */
export async function handleForgotPasswordRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const userModel = new UserModel(env.DB, env);
  const activityLog = new ActivityLogModel(env.DB);
  const cache = (caches as any).default;
  const clientIp = request.headers.get("CF-Connecting-IP") || "127.0.0.1";
  const userAgent = request.headers.get("User-Agent");

  // Step 1: Init recovery session
  if (path === '/api/auth/forgot-password/init' && request.method === 'POST') {
    if (await cacheUtils.isRateLimited(cache, `forgot_pw_ip:${clientIp}`, 10, 600)) {
      return new Response("Too many attempts", { status: 429 });
    }

    const { username, turnstileToken } = await request.json() as any;
    if (!username) {
      return new Response("Username is required", { status: 400 });
    }

    // Verify Turnstile if enabled
    const settingsModel = new SystemSettingsModel(env.DB);
    const [secretKey, enabled] = await Promise.all([
      settingsModel.get('turnstile_secret_key'),
      settingsModel.get('turnstile_enabled_login')
    ]);
    if (enabled === 'true' && secretKey) {
      if (!await verifyTurnstile(turnstileToken, secretKey, clientIp)) {
        return new Response("Verification failed", { status: 400 });
      }
    }

    const user = await userModel.getByUsername(username);
    if (!user) {
      await cacheUtils.isRateLimited(cache, `forgot_pw_ip:${clientIp}`, 100, 600); // penalty
      return new Response("User not found", { status: 404 });
    }

    // Check available MFA credentials
    const passkeyModel = new PasskeyModel(env.DB);
    const passkeys = await passkeyModel.listByUser(user.id);
    const has_passkey = passkeys.length > 0;
    const has_totp = !!user.totp_enabled && !!user.totp_secret;

    let has_recovery_keys = false;
    if (user.totp_recovery_keys) {
      try {
        const parsed = JSON.parse(user.totp_recovery_keys);
        has_recovery_keys = Array.isArray(parsed) && parsed.length > 0;
      } catch {}
    }

    // If no MFA configured at all, user cannot self-reset
    if (!has_passkey && !has_totp && !has_recovery_keys) {
      return new Response(JSON.stringify({
        can_reset: false,
        reason: "no_mfa_configured"
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }

    // Prepare WebAuthn options if user has Passkeys
    let passkey_challenge: string | null = null;
    let passkey_options: any = null;
    if (has_passkey) {
      passkey_challenge = generateWebAuthnChallenge();
      passkey_options = {
        challenge: passkey_challenge,
        rpId: url.hostname,
        allowCredentials: passkeys.map(p => ({
          id: p.credential_id,
          type: "public-key",
          transports: p.transports ? JSON.parse(p.transports) : undefined
        })),
        timeout: 60000,
        userVerification: "preferred"
      };
    }

    const recoveryToken = generateId(32);
    const recoveryState: RecoveryState = {
      userId: user.id,
      username: user.username,
      passkeyChallenge: passkey_challenge,
      rpId: url.hostname,
      failedAttempts: 0
    };

    // Cache recovery state for 5 minutes (300s)
    await cacheUtils.set(cache, `forgot_pw_state:${recoveryToken}`, recoveryState, 300);

    return new Response(JSON.stringify({
      can_reset: true,
      recoveryToken,
      has_passkey,
      passkey_options,
      has_totp,
      has_recovery_keys
    }), {
      headers: { "Content-Type": "application/json" }
    });
  }

  // Step 2: Verify MFA identity
  if (path === '/api/auth/forgot-password/verify' && request.method === 'POST') {
    const { recoveryToken, passkeyAssertion, totpTokenHash, totpSalt, recoveryKey } = await request.json() as any;
    if (!recoveryToken) {
      return new Response("Recovery token is required", { status: 400 });
    }

    const cacheKey = `forgot_pw_state:${recoveryToken}`;
    const state = await cacheUtils.get<RecoveryState>(cache, cacheKey);
    if (!state) {
      return new Response("Recovery session expired or invalid", { status: 400 });
    }

    if (state.failedAttempts >= 3) {
      await cacheUtils.delete(cache, cacheKey);
      return new Response("Too many failed attempts. Please start over.", { status: 429 });
    }

    const user = await userModel.getById(state.userId);
    if (!user) {
      await cacheUtils.delete(cache, cacheKey);
      return new Response("User not found", { status: 404 });
    }

    // Verify Passkey
    if (passkeyAssertion && state.passkeyChallenge) {
      const passkeyModel = new PasskeyModel(env.DB);
      const passkeys = await passkeyModel.listByUser(user.id);
      const passkey = passkeys.find(p => p.credential_id === passkeyAssertion.id);

      if (!passkey) {
        state.failedAttempts++;
        await cacheUtils.set(cache, cacheKey, state, 300);
        return new Response("Passkey not recognized", { status: 400 });
      }

      try {
        const { signCount } = await verifyAuthenticationResponse({
          clientDataJSON: passkeyAssertion.response.clientDataJSON,
          authenticatorData: passkeyAssertion.response.authenticatorData,
          signature: passkeyAssertion.response.signature,
          publicKeySpki: passkey.public_key,
          algorithm: passkey.algorithm,
          expectedChallenge: state.passkeyChallenge,
          expectedOrigin: request.headers.get("origin") || `https://${state.rpId}`,
          expectedRpId: state.rpId,
          previousSignCount: passkey.sign_count
        });

        await passkeyModel.updateUsage(passkey.id, signCount);
        await activityLog.record(user.id, 'passkey_verify_success', clientIp, userAgent, { flow: 'forgot_password' });
      } catch (err: any) {
        state.failedAttempts++;
        await cacheUtils.set(cache, cacheKey, state, 300);
        return new Response("Passkey verification failed", { status: 400 });
      }
    }
    // Verify Recovery Key
    else if (recoveryKey) {
      let storedHashes: string[] = [];
      try {
        storedHashes = JSON.parse(user.totp_recovery_keys || '[]');
      } catch {}

      const matchIndex = await findMatchingRecoveryKey(recoveryKey, storedHashes);
      if (matchIndex === -1) {
        state.failedAttempts++;
        await cacheUtils.set(cache, cacheKey, state, 300);
        return new Response("Invalid recovery key", { status: 400 });
      }

      await userModel.consumeRecoveryKey(user.id, matchIndex, storedHashes);
      await activityLog.record(user.id, 'recovery_key_used', clientIp, userAgent, { flow: 'forgot_password', remaining: storedHashes.length - 1 });
    }
    // Verify TOTP
    else if (totpTokenHash && user.totp_secret) {
      const isValid = await verifyTOTP(user.totp_secret, totpTokenHash, totpSalt);
      if (!isValid) {
        state.failedAttempts++;
        await cacheUtils.set(cache, cacheKey, state, 300);
        return new Response("Invalid TOTP code", { status: 400 });
      }

      await activityLog.record(user.id, 'totp_verify_success', clientIp, userAgent, { flow: 'forgot_password' });
    }
    else {
      return new Response("No valid MFA credential provided", { status: 400 });
    }

    // MFA verified! Invalidate recovery session and issue single-use resetToken
    await cacheUtils.delete(cache, cacheKey);

    const resetToken = generateId(32);
    const resetState: ResetState = {
      userId: user.id,
      username: user.username
    };
    await cacheUtils.set(cache, `forgot_pw_reset:${resetToken}`, resetState, 300);

    return new Response(JSON.stringify({ success: true, resetToken }), {
      headers: { "Content-Type": "application/json" }
    });
  }

  // Step 3: Reset password
  if (path === '/api/auth/forgot-password/reset' && request.method === 'POST') {
    const { resetToken, newPassword } = await request.json() as any;
    if (!resetToken || !newPassword) {
      return new Response("Reset token and new password are required", { status: 400 });
    }

    if (!PASSWORD_REGEX.test(newPassword)) {
      return new Response("Password format error", { status: 400 });
    }

    const resetKey = `forgot_pw_reset:${resetToken}`;
    const resetState = await cacheUtils.get<ResetState>(cache, resetKey);
    if (!resetState) {
      return new Response("Reset token expired or invalid", { status: 400 });
    }

    // Immediately consume reset token
    await cacheUtils.delete(cache, resetKey);

    const user = await userModel.getById(resetState.userId);
    if (!user) {
      return new Response("User not found", { status: 404 });
    }

    // Hash and update password (v2)
    const hashedPassword = await hashPassword(newPassword, 2);
    await userModel.updatePassword(user.id, hashedPassword, 2);

    // Revoke all existing sessions for security
    const sessionModel = new SessionModel(env.DB);
    await sessionModel.deleteAllByUserId(user.id);

    await activityLog.record(user.id, 'password_change_success', clientIp, userAgent, { method: 'forgot_password_reset' });

    return new Response(JSON.stringify({ success: true }), {
      headers: { "Content-Type": "application/json" }
    });
  }

  return new Response("Not Found", { status: 404 });
}
