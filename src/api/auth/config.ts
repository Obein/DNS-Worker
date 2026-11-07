import { Env } from "../../types";
import { UserModel } from "../../models/user";
import { SystemSettingsModel } from "../../models/systemSettings";
import { USERNAME_REGEX } from "../../utils/validator";

/**
 * Handle public authentication configuration and checks
 */
export async function handleAuthConfigRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const userModel = new UserModel(env.DB, env);

  // 公开配置接口
  if (url.pathname === '/api/auth/config' && request.method === 'GET') {
    const settingsModel = new SystemSettingsModel(env.DB);
    const [siteKey, signupEnabled, loginEnabled, userCount, registrationEnabled, maxUsersSetting] = await Promise.all([
      settingsModel.get('turnstile_site_key'),
      settingsModel.get('turnstile_enabled_signup'),
      settingsModel.get('turnstile_enabled_login'),
      userModel.count().catch(() => 0),
      settingsModel.get('registration_enabled'),
      settingsModel.get('max_users')
    ]);
    const hasUsers = userCount > 0;
    const rawMaxUsers = maxUsersSetting !== null ? maxUsersSetting : env.MAX_USERS;
    const maxUsers = rawMaxUsers !== undefined && rawMaxUsers !== null && rawMaxUsers !== "" ? parseInt(String(rawMaxUsers), 10) : 0;
    const isMaxUsersReached = hasUsers && maxUsers > 0 && userCount >= maxUsers;

    return new Response(JSON.stringify({
      turnstile_site_key: siteKey,
      turnstile_enabled_signup: signupEnabled === 'true',
      turnstile_enabled_login: loginEnabled === 'true',
      optional_session_expiration_days: Number(env.OPTIONAL_SESSION_EXPIRATION_DAYS) || 7,
      has_users: hasUsers,
      registration_enabled: registrationEnabled !== 'false' && !isMaxUsersReached,
      max_users: maxUsers > 0 ? maxUsers : null,
      max_users_reached: isMaxUsersReached
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': hasUsers ? 'public, max-age=60, s-maxage=60' : 'no-store, no-cache'
      }
    });
  }

  // 检查用户名是否存在接口
  if (url.pathname === '/api/auth/check-username' && request.method === 'GET') {
    const username = url.searchParams.get('username') || '';
    if (!USERNAME_REGEX.test(username)) {
      return new Response(JSON.stringify({ error: "Invalid username" }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    const exists = await userModel.getByUsername(username);
    return new Response(JSON.stringify({ exists: !!exists }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  return new Response("Not Found", { status: 404 });
}
