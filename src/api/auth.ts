import { Env } from "../types";
import { handleAuthConfigRequest } from "./auth/config";
import { handleAuthRegisterRequest } from "./auth/register";
import { handleLoginRequest } from "./auth/login";
import { handleRefreshRequest } from "./auth/refresh";
import { handleLogoutRequest } from "./auth/logout";
import { handleSessionLockRequest } from "./auth/lock";

/**
 * Handle authentication related requests by delegating to specialized handlers.
 */
export async function handleAuthRequest(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url);
    const path = url.pathname;

    // 公开配置与辅助接口
    if (path === '/api/auth/config' || path === '/api/auth/check-username') {
      return await handleAuthConfigRequest(request, env);
    }

    // 注册接口
    if (path === '/api/auth/signup') {
      return await handleAuthRegisterRequest(request, env);
    }

    // 登录生命周期接口
    if (path === '/api/auth/prelogin' || path === '/api/auth/login') {
      return await handleLoginRequest(request, env);
    }

    // Token 刷新接口
    if (path === '/api/auth/refresh') {
      return await handleRefreshRequest(request, env);
    }

    // 登出接口
    if (path === '/api/auth/logout') {
      return await handleLogoutRequest(request, env);
    }

    // 会话锁定与解锁接口
    if (path === '/api/auth/unlock-session' || path === '/api/auth/lock-session') {
      return await handleSessionLockRequest(request, env);
    }

    return new Response("Not Found", { status: 404 });
  } catch (e: any) {
    console.error("[Auth API] Unhandled Error:", e.message || e);
    return new Response(e.message || "Internal Server Error", {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" }
    });
  }
}
