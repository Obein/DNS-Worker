import { Env } from "../../../types";
import { verifyPassword } from "../../../utils/crypto";
import { verifyTOTP } from "../../../lib/totp";
import { PasskeyModel } from "../../../models/passkey";
import { verifyAuthenticationResponse } from "../../../lib/webauthn";
import { cacheUtils } from "../../../utils/cache";

export interface ReauthPayload {
  password?: string;
  oldPassword?: string;
  totpTokenHash?: string;
  totpSalt?: string;
  passkeyAssertion?: any;
}

export interface ReauthResult {
  success: boolean;
  method?: "password" | "totp" | "passkey";
  error?: string;
  reason?: string;
}

/**
 * Re-authenticates the current user using one of: Passkey, TOTP, or Current Password.
 *
 * @param dbUser - Target database user record containing credentials.
 * @param payload - Inbound client re-authentication payload.
 * @param env - Cloudflare Worker environment bindings.
 * @param request - Current HTTP request for origin and header resolution.
 * @returns Verification result detailing success status, authentication method, and failure reasons.
 */
export async function verifyUserReauth(
  dbUser: any,
  payload: ReauthPayload,
  env: Env,
  request: Request
): Promise<ReauthResult> {
  // 1. Passkey assertion check
  if (payload.passkeyAssertion) {
    const cache = (caches as any).default;
    const cachedState = await cacheUtils.get<{ challenge: string; rpId: string }>(
      cache,
      `webauthn_auth_challenge:${dbUser.id}`
    );
    if (!cachedState) {
      return { success: false, error: "Passkey session expired, please try again", reason: "passkey_session_expired" };
    }

    const passkeyModel = new PasskeyModel(env.DB);
    const userPasskeys = await passkeyModel.listByUser(dbUser.id);
    const passkey = userPasskeys.find((p) => p.credential_id === payload.passkeyAssertion.id);
    if (!passkey) {
      return { success: false, error: "Passkey not found", reason: "passkey_not_found" };
    }

    const requestUrl = new URL(request.url);
    try {
      const { signCount } = await verifyAuthenticationResponse({
        clientDataJSON: payload.passkeyAssertion.response.clientDataJSON,
        authenticatorData: payload.passkeyAssertion.response.authenticatorData,
        signature: payload.passkeyAssertion.response.signature,
        publicKeySpki: passkey.public_key,
        algorithm: passkey.algorithm,
        expectedChallenge: cachedState.challenge,
        expectedOrigin: `${requestUrl.protocol}//${requestUrl.host}`,
        expectedRpId: cachedState.rpId,
        previousSignCount: passkey.sign_count
      });

      await passkeyModel.updateUsage(passkey.id, signCount);
      await cacheUtils.delete(cache, `webauthn_auth_challenge:${dbUser.id}`);
      return { success: true, method: "passkey" };
    } catch {
      return { success: false, error: "Invalid Passkey signature", reason: "invalid_passkey" };
    }
  }

  // 2. TOTP token hash check
  if (payload.totpTokenHash) {
    if (!dbUser.totp_enabled || !dbUser.totp_secret) {
      return { success: false, error: "TOTP is not enabled", reason: "totp_not_enabled" };
    }
    const valid = await verifyTOTP(dbUser.totp_secret, payload.totpTokenHash, payload.totpSalt);
    if (!valid) {
      return { success: false, error: "Invalid TOTP code", reason: "invalid_totp" };
    }
    return { success: true, method: "totp" };
  }

  // 3. Password check (oldPassword or password)
  const pwd = payload.oldPassword || payload.password;
  if (pwd) {
    const valid = await verifyPassword(pwd, dbUser.hashed_password, dbUser.password_version ?? 1);
    if (!valid) {
      return { success: false, error: "Current password is incorrect", reason: "wrong_current_password" };
    }
    return { success: true, method: "password" };
  }

  return { success: false, error: "Authentication required (Password, Passkey, or TOTP)", reason: "no_credentials_provided" };
}
