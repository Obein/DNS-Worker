import { Env, User, ExecutionContext } from "../../../types";
import { hashPassword, generateSessionHash } from "../../../utils/crypto";
import { UserModel } from "../../../models/user";
import { ActivityLogModel } from "../../../models/activityLog";
import { PASSWORD_REGEX } from "../../../utils/validator";
import { verifyUserReauth, ReauthPayload } from "./reauth";

/**
 * Handles password management endpoints:
 * - POST /api/account/password (password change with multi-credential reauth)
 * - POST /api/account/migrate-password (password hash upgrade from v1 to v2)
 *
 * @param request - Inbound HTTP Request.
 * @param env - Cloudflare Worker environment bindings.
 * @param user - Current authenticated user.
 * @param pathParts - URL pathname components.
 * @param ctx - Execution context.
 * @returns Response indicating operation outcome.
 */
export async function handlePasswordRequest(
  request: Request,
  env: Env,
  user: User,
  pathParts: string[],
  _ctx: ExecutionContext
): Promise<Response> {
  const userModel = new UserModel(env.DB, env);
  const activityLog = new ActivityLogModel(env.DB);
  const clientIp = request.headers.get("CF-Connecting-IP") || "127.0.0.1";
  const userAgent = request.headers.get("User-Agent");
  const action = pathParts[2];
  const sessionHash = user.sessionId ? await generateSessionHash(user.sessionId, user.id) : null;

  // POST /api/account/password (password change supporting Old Password, Passkey, or TOTP)
  if (action === "password" && request.method === "POST") {
    const body = (await request.json()) as { newPassword?: string } & ReauthPayload;
    const { newPassword } = body;
    if (!newPassword || !PASSWORD_REGEX.test(newPassword)) {
      return new Response("Password format error", { status: 400 });
    }
    const dbUser = await userModel.getById(user.id);
    if (!dbUser) return new Response("User not found", { status: 404 });

    const authResult = await verifyUserReauth(dbUser, body, env, request);
    if (!authResult.success) {
      await activityLog.record(user.id, "password_change_fail", clientIp, userAgent, { reason: authResult.reason }, sessionHash);
      return new Response(authResult.error || "Authentication failed", { status: 400 });
    }

    const hashedPassword = await hashPassword(newPassword, 2);
    await userModel.updatePassword(user.id, hashedPassword, 2);
    await activityLog.record(user.id, "password_change_success", clientIp, userAgent, { method: authResult.method }, sessionHash);
    return new Response(JSON.stringify({ success: true }), {
      headers: { "Content-Type": "application/json" }
    });
  }

  // POST /api/account/migrate-password (password migration to v2)
  if (action === "migrate-password" && request.method === "POST") {
    const body = (await request.json()) as { clientHash?: string } & ReauthPayload;
    const { clientHash } = body;
    if (!clientHash) {
      return new Response("Missing clientHash", { status: 400 });
    }
    const dbUser = await userModel.getById(user.id);
    if (!dbUser) return new Response("User not found", { status: 404 });

    // Enforce re-authentication verification: must provide valid credentials (e.g. oldPassword)
    const authResult = await verifyUserReauth(dbUser, body, env, request);
    if (!authResult.success) {
      await activityLog.record(user.id, "password_change_fail", clientIp, userAgent, { reason: authResult.reason, flow: "migration" }, sessionHash);
      return new Response(authResult.error || "Authentication failed", { status: 400 });
    }

    if ((dbUser.password_version ?? 1) === 1) {
      const hashedPassword = await hashPassword(clientHash, 2);
      await userModel.updatePassword(user.id, hashedPassword, 2);
      await activityLog.record(user.id, "password_change_success", clientIp, userAgent, { method: "migration" }, sessionHash);
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { "Content-Type": "application/json" }
    });
  }

  return new Response("Not Found", { status: 404 });
}
