import { Env, User, ExecutionContext } from "../../types";
import { generateId } from "../../lib/auth";
import { hashPassword } from "../../utils/crypto";
import { UserModel } from "../../models/user";
import { ProfileModel } from "../../models/profile";
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
  const userModel = new UserModel(env.DB);
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
      const hashedPassword = await hashPassword(password);
      const userId = generateId(15);
      try {
        await userModel.create({ id: userId, username, passwordHash: hashedPassword, role: role || 'user' });
        return new Response(JSON.stringify({ id: userId }), { status: 201 });
      } catch (e: any) {
        return new Response(e.message, { status: 400 });
      }
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
      return new Response(JSON.stringify(settings), { headers: { 'Content-Type': 'application/json' } });
    }
    if (request.method === 'PATCH') {
      const body = await request.json() as Record<string, string>;
      await systemSettings.setMany(body);
      return new Response(JSON.stringify({ success: true }));
    }
  }

  return new Response("Not Found", { status: 404 });
}
