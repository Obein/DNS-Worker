import { Env } from "../../types";
import { UserModel } from "../../models/user";
import { SystemSettingsModel } from "../../models/systemSettings";
import { USERNAME_REGEX } from "../../utils/validator";

/**
 * Handle public authentication configuration and checks
 */
export async function handleAuthConfigRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const userModel = new UserModel(env.DB);

  // 公开配置接口
  if (url.pathname === '/api/auth/config' && request.method === 'GET') {
    const settingsModel = new SystemSettingsModel(env.DB);
    const [siteKey, signupEnabled, loginEnabled] = await Promise.all([
      settingsModel.get('turnstile_site_key'),
      settingsModel.get('turnstile_enabled_signup'),
      settingsModel.get('turnstile_enabled_login')
    ]);
    return new Response(JSON.stringify({
      turnstile_site_key: siteKey,
      turnstile_enabled_signup: signupEnabled === 'true',
      turnstile_enabled_login: loginEnabled === 'true'
    }), { headers: { 'Content-Type': 'application/json' } });
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
