import { Env, User, ExecutionContext } from "../types";
import { RBAC } from "../lib/rbac";
import { ProfileModel } from "../models/profile";
import { handleProfilesCoreCollectionRequest, handleProfilesCoreRequest } from "./profiles/core";
import { handleProfileAccessPointsRequest } from "./profiles/accessPoints";
import { handleProfileRulesRequest } from "./profiles/rules";
import { handleProfileListsRequest } from "./profiles/lists";
import { handleProfileLogsAndAnalyticsRequest } from "./profiles/logs";

export async function handleProfilesRequest(request: Request, env: Env, user: User | null, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const pathParts = url.pathname.split('/').filter(Boolean); // ['api', 'profiles', ':id', ...]
  const profileModel = new ProfileModel(env.DB);

  // 处理列表和创建 (/api/profiles)
  if (pathParts.length === 2) {
    if (!user) return new Response("Unauthorized", { status: 401 });
    return handleProfilesCoreCollectionRequest(request, env, user, pathParts);
  }

  // 处理特定 Profile (/api/profiles/:id)
  if (pathParts.length >= 3) {
    const profileId = pathParts[2];
    const profile = await profileModel.getById(profileId);
    
    if (!profile) return new Response("Profile Not Found", { status: 404 });

    // 特殊处理：mobileconfig 下载允许免登录访问
    const isMobileConfig = pathParts[3] === 'mobileconfig' && request.method === 'GET';
    
    if (!isMobileConfig) {
      if (!user) return new Response("Unauthorized", { status: 401 });
      if (!RBAC.canAccessProfile(user, profile)) return new Response("Forbidden", { status: 403 });
    }

    const subResource = pathParts[3];

    // Delegate to sub-router based on the path
    if (!subResource || ['rotate_key', 'settings', 'test', 'mobileconfig'].includes(subResource)) {
      return handleProfilesCoreRequest(request, env, user, profile, pathParts, ctx);
    }

    // Since it's a sub-resource other than mobileconfig, user must be authenticated
    if (!user) return new Response("Unauthorized", { status: 401 });

    switch (subResource) {
      case 'access_points':
        return handleProfileAccessPointsRequest(request, env, user, profileId, pathParts, ctx);
      case 'rules':
        return handleProfileRulesRequest(request, env, user, profileId, pathParts, ctx);
      case 'lists':
        return handleProfileListsRequest(request, env, user, profileId, pathParts, ctx);
      case 'logs':
      case 'analytics':
        return handleProfileLogsAndAnalyticsRequest(request, env, user, profile, pathParts, ctx);
      default:
        return new Response("Not Found", { status: 404 });
    }
  }

  return new Response("Not Found", { status: 404 });
}
