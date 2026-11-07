import { Env, User, ExecutionContext } from "../../types";
import { generateId } from "../../lib/auth";
import { hashPassword } from "../../utils/crypto";
import { UserModel } from "../../models/user";
import { ProfileModel } from "../../models/profile";
import { ListModel } from "../../models/list";
import { ListBloomModel } from "../../models/listBloom";
import { SystemSettingsModel } from "../../models/systemSettings";
import { PASSWORD_REGEX, USERNAME_REGEX, isSafeUrlWithDnsCheck } from "../../utils/validator";
import { syncGlobalList } from "../../utils/sync/singleListSync";
import { rebuildProfileBloom } from "../../utils/sync";
import { pipeline } from "../../pipeline";
import {
  getDatabaseService,
  isTursoConfigured,
  getTursoMigrationStats,
  runTursoMigrations
} from "../../lib/turso";

/**
 * Allowlist of system setting keys that can be updated via administrative REST APIs.
 * Prevents key namespace pollution and blocks attempts to overwrite internal timestamps or runtime secrets.
 */
const ALLOWED_ADMIN_SETTINGS_KEYS = new Set<string>([
  'turnstile_site_key',
  'turnstile_secret_key',
  'turnstile_enabled_signup',
  'turnstile_enabled_login',
  'registration_enabled',
  'max_users'
]);

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

      const systemSettings = new SystemSettingsModel(env.DB);
      const maxUsersSetting = await systemSettings.get('max_users');
      const rawMaxUsers = maxUsersSetting !== null ? maxUsersSetting : env.MAX_USERS;
      const maxUsers = rawMaxUsers !== undefined && rawMaxUsers !== null && rawMaxUsers !== "" ? parseInt(String(rawMaxUsers), 10) : 0;
      if (maxUsers > 0) {
        const currentCount = await userModel.count();
        if (currentCount >= maxUsers) {
          return new Response("max_users_reached", { status: 400 });
        }
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
      let body: Record<string, unknown> = {};
      try {
        body = await request.json() as Record<string, unknown>;
      } catch {
        return new Response("Invalid JSON payload", { status: 400 });
      }

      const filteredSettings: Record<string, string> = {};
      for (const [key, value] of Object.entries(body)) {
        if (ALLOWED_ADMIN_SETTINGS_KEYS.has(key)) {
          if (typeof value === 'string') {
            filteredSettings[key] = value.slice(0, 1024);
          } else if (typeof value === 'number') {
            filteredSettings[key] = String(value);
          }
        }
      }

      if (filteredSettings.max_users !== undefined) {
        const parsed = parseInt(filteredSettings.max_users, 10);
        if (isNaN(parsed) || parsed < 0) {
          filteredSettings.max_users = "0";
        } else {
          filteredSettings.max_users = String(parsed);
        }
      }

      if (Object.keys(filteredSettings).length > 0) {
        await systemSettings.setMany(filteredSettings);
      }
      return new Response(JSON.stringify({ success: true }));
    }
  }

  // 数据库管理与迁移接口: /api/admin/database
  if (pathParts[2] === 'database') {
    const isServerfull = Boolean(
      env.SERVERFULL_DEFAULT_PROFILE_KEY !== undefined ||
      env.SERVERFULL_HOST !== undefined ||
      env.SERVERFULL_DOT_DOMAIN !== undefined ||
      env.SERVERFULL_HTTP_PORT !== undefined ||
      env.SERVERFULL_HTTPS_PORT !== undefined ||
      env.SERVERFULL_DB_PATH !== undefined
    );
    const dbService = getDatabaseService(env, isServerfull);
    const isTurso = dbService === 'Turso' && isTursoConfigured(env);

    if (request.method === 'GET') {
      const stats = env.DB ? await getTursoMigrationStats(env.DB as any) : null;
      return new Response(JSON.stringify({
        databaseService: dbService,
        isTurso,
        configured: Boolean(env.DB),
        migrations: stats
      }), { headers: { 'Content-Type': 'application/json' } });
    }

    if (request.method === 'POST') {
      const action = pathParts[3];
      if (action === 'migrate') {
        if (!env.DB) {
          return new Response(JSON.stringify({ error: "Database is not configured" }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        const appliedCount = await runTursoMigrations(env.DB as any);
        const stats = await getTursoMigrationStats(env.DB as any);
        return new Response(JSON.stringify({
          success: true,
          appliedCount,
          stats
        }), { headers: { 'Content-Type': 'application/json' } });
      }
    }
  }

  // 下发过滤器接口: POST /api/admin/distribute-filter
  if (pathParts[2] === 'distribute-filter') {
    if (request.method !== 'POST') {
      return new Response("Method Not Allowed", { status: 405 });
    }

    let body: { url?: unknown };
    try {
      body = await request.json() as { url?: unknown };
    } catch {
      return new Response("Invalid JSON payload", { status: 400 });
    }

    const rawUrl = typeof body?.url === 'string' ? body.url.trim() : '';
    if (!rawUrl) {
      return new Response("Missing list URL", { status: 400 });
    }

    if (!(await isSafeUrlWithDnsCheck(rawUrl))) {
      return new Response("Invalid list URL. Private networks, localhosts, and internal domains are not allowed.", { status: 400 });
    }

    const canonicalUrl = ListModel.normalizeUrl(rawUrl);
    const listModel = new ListModel(env.DB);
    const listBloomModel = new ListBloomModel(env.DB);
    const now = Math.floor(Date.now() / 1000);

    // 1. 确保全局布隆过滤器与扩展规则已编译（方案 B）
    const hasBloom = await listBloomModel.hasListBloom(canonicalUrl);
    if (!hasBloom) {
      const syncRes = await syncGlobalList(canonicalUrl, env, listModel, listBloomModel, now);
      if (syncRes.syncError) {
        return new Response(JSON.stringify({ error: syncRes.syncError }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    // 2. 下发至所有未订阅此 URL 的用户
    const result = await listModel.distributeListToAllUsers(canonicalUrl);

    // 3. 异步触发所有受影响 Profile 的本地内存快速合并
    for (const profileId of result.affectedProfileIds) {
      ctx.waitUntil(
        rebuildProfileBloom(profileId, env, ctx)
          .then(() => pipeline.clearCache(profileId, true, env))
          .catch((e) => console.error(`[Admin] Failed to rebuild bloom for profile ${profileId}:`, e))
      );
    }

    return new Response(JSON.stringify({
      success: true,
      url: canonicalUrl,
      totalUsers: result.totalUsers,
      addedCount: result.addedCount,
      skippedCount: result.skippedCount,
      addedUsernames: result.addedUsernames,
      skippedUsernames: result.skippedUsernames,
      affectedProfilesCount: result.affectedProfileIds.length
    }), { headers: { 'Content-Type': 'application/json' } });
  }

  return new Response("Not Found", { status: 404 });
}
