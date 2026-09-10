import { Env, User, ExecutionContext } from "../../types";
import { generateId } from "../../lib/auth";
import { hashPassword } from "../../utils/crypto";
import { UserModel } from "../../models/user";
import { ProfileModel } from "../../models/profile";
import { SessionModel } from "../../models/session";
import { SystemSettingsModel } from "../../models/systemSettings";
import { PASSWORD_REGEX, USERNAME_REGEX } from "../../utils/validator";

/**
 * Handle admin requests to /api/admin/...
 */
export async function handleAdminRequest(
  request: Request,
  env: Env,
  user: User,
  pathParts: string[],
  ctx: ExecutionContext
): Promise<Response> {
  const userModel = new UserModel(env.DB, env);
  const profileModel = new ProfileModel(env.DB);

  if (pathParts[2] === 'users') {
    if (request.method === 'GET') {
      const users = await userModel.listAll();
      return new Response(JSON.stringify(users), { headers: { 'Content-Type': 'application/json' } });
    }

    if (request.method === 'POST') {
      const { username, password, role } = await request.json() as any;
      if (!username || !USERNAME_REGEX.test(username)) {
        return new Response("Invalid username format", { status: 400 });
      }
      if (!password || !PASSWORD_REGEX.test(password)) {
        return new Response("Password format error", { status: 400 });
      }
      const hashedPassword = await hashPassword(password, 2);
      const userId = generateId(15);
      try {
        await userModel.create({ id: userId, username, passwordHash: hashedPassword, role: role || 'user', passwordVersion: 2 });
        return new Response(JSON.stringify({ id: userId }), { status: 201 });
      } catch (e: any) {
        return new Response(e.message, { status: 400 });
      }
    }

    if (request.method === 'POST' && pathParts[3] && pathParts[4] === 'reset-password') {
      const targetId = pathParts[3];
      const targetUser = await userModel.getById(targetId);
      if (!targetUser) return new Response("User not found", { status: 404 });

      const { newPassword } = await request.json() as any;
      if (!newPassword || !PASSWORD_REGEX.test(newPassword)) {
        return new Response("Password format error", { status: 400 });
      }

      const hashedPassword = await hashPassword(newPassword, 2);
      await userModel.updatePassword(targetId, hashedPassword, 2);

      const sessionModel = new SessionModel(env.DB);
      await sessionModel.deleteAllByUserId(targetId);

      return new Response(JSON.stringify({ success: true }));
    }

    if (request.method === 'DELETE' && pathParts[3]) {
      const targetId = pathParts[3];
      if (targetId === user.id) return new Response("Cannot delete yourself", { status: 400 });
      await profileModel.deleteByOwner(targetId);
      await userModel.delete(targetId);
      return new Response(null, { status: 204 });
    }
  }

  // 系统设置接口: /api/admin/settings
  if (pathParts[2] === 'settings') {
    const systemSettings = new SystemSettingsModel(env.DB);
    if (request.method === 'GET') {
      const settings = await systemSettings.getAll();
      // 敏感配置脱敏，jwt_secret 绝不能暴露给外部/客户端
      delete settings.jwt_secret;
      return new Response(JSON.stringify(settings), { headers: { 'Content-Type': 'application/json' } });
    }
    if (request.method === 'PATCH') {
      const body = await request.json() as Record<string, string>;
      // 禁止修改/覆盖敏感的 jwt_secret
      delete body.jwt_secret;
      await systemSettings.setMany(body);
      return new Response(JSON.stringify({ success: true }));
    }
  }

  return new Response("Not Found", { status: 404 });
}
