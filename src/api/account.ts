import { Env, User, ExecutionContext } from "../types";
import { RBAC } from "../lib/rbac";
import { generateId, createBlankSessionCookie } from "../lib/auth";
import { hashPassword, verifyPassword } from "../utils/crypto";
import { UserModel } from "../models/user";
import { ProfileModel } from "../models/profile";
import { LogModel } from "../models/log";

export async function handleAccountRequest(request: Request, env: Env, user: User, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const pathParts = url.pathname.split('/').filter(Boolean);
  const userModel = new UserModel(env.DB);
  const profileModel = new ProfileModel(env.DB);
  const logModel = new LogModel(env.DB);

  // 个人账号接口 (/api/account/...)
  if (pathParts[1] === 'account') {
    if (pathParts[2] === 'me' && request.method === 'GET') {
      return new Response(JSON.stringify({ id: user.id, username: user.username, role: user.role }), { headers: { 'Content-Type': 'application/json' } });
    }

    if (pathParts[2] === 'me' && request.method === 'PATCH') {
      const { username: newUsername } = await request.json() as any;
      if (!newUsername || !/^[a-zA-Z0-9]{5,15}$/.test(newUsername)) {
        return new Response("Username format error", { status: 400 });
      }
      try {
        await userModel.updateUsername(user.id, newUsername);
        return new Response(JSON.stringify({ success: true }));
      } catch (e: any) {
        if (e.message?.includes("UNIQUE constraint failed")) return new Response("The username is already taken", { status: 400 });
        return new Response("Failed to update username", { status: 500 });
      }
    }

    if (pathParts[2] === 'password' && request.method === 'POST') {
      const { oldPassword, newPassword } = await request.json() as any;
      if (!newPassword || newPassword.length < 8 || !/(?=.*[a-zA-Z])(?=.*[0-9])/.test(newPassword)) {
        return new Response("Password format error", { status: 400 });
      }
      const dbUser = await userModel.getById(user.id);
      if (!dbUser || !(await verifyPassword(oldPassword, dbUser.hashed_password))) {
        return new Response("Current password is incorrect", { status: 400 });
      }
      const hashedPassword = await hashPassword(newPassword);
      await userModel.updatePassword(user.id, hashedPassword);
      return new Response(JSON.stringify({ success: true }));
    }

    if (pathParts[2] === 'logs' && request.method === 'DELETE') {
      await logModel.deleteByOwner(user.id);
      return new Response(JSON.stringify({ success: true }));
    }

    if (pathParts[2] === 'me' && request.method === 'DELETE') {
      if (RBAC.isAdmin(user)) return new Response("Administrator accounts cannot be deleted directly", { status: 400 });
      await profileModel.deleteByOwner(user.id);
      await userModel.delete(user.id);
      const blankCookie = createBlankSessionCookie();
      return new Response(JSON.stringify({ success: true }), { headers: { "Set-Cookie": blankCookie } });
    }
  }

  // 管理员接口 (/api/admin/...)
  if (pathParts[1] === 'admin') {
    if (!RBAC.isAdmin(user)) return new Response("Forbidden", { status: 403 });

    if (pathParts[2] === 'users') {
      if (request.method === 'GET') {
        const users = await userModel.listAll();
        return new Response(JSON.stringify(users), { headers: { 'Content-Type': 'application/json' } });
      }
      if (request.method === 'POST') {
        const { username, password, role } = await request.json() as any;
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
      if (request.method === 'GET') {
        const { results } = await env.DB.prepare("SELECT key, value FROM system_settings").all();
        const settings = results.reduce((acc: any, cur: any) => ({ ...acc, [cur.key]: cur.value }), {});
        return new Response(JSON.stringify(settings), { headers: { 'Content-Type': 'application/json' } });
      }
      if (request.method === 'PATCH') {
        const body = await request.json() as Record<string, string>;
        const now = Math.floor(Date.now() / 1000);
        const stmts = Object.entries(body).map(([key, value]) => 
          env.DB.prepare("INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at").bind(key, String(value), now)
        );
        await env.DB.batch(stmts);
        return new Response(JSON.stringify({ success: true }));
      }
    }
  }

  return new Response("Not Found", { status: 404 });
}
