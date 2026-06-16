import { Env, User, ExecutionContext } from "../../types";
import { ProfileModel } from "../../models/profile";

const AP_NAME_REGEX = /^[a-zA-Z0-9_-]{1,30}$/;

/**
 * Handle access points requests to /api/profiles/:id/access_points
 */
export async function handleProfileAccessPointsRequest(
  request: Request,
  env: Env,
  user: User,
  profileId: string,
  pathParts: string[],
  ctx: ExecutionContext
): Promise<Response> {
  const profileModel = new ProfileModel(env.DB);

  if (request.method === 'GET') {
    const results = await profileModel.getAccessPoints(profileId);
    return new Response(JSON.stringify(results), { headers: { 'Content-Type': 'application/json' } });
  }

  if (request.method === 'POST') {
    if (pathParts.length === 6 && pathParts[5] === 'rotate_token') {
      const apId = pathParts[4];
      const newToken = await profileModel.rotateAccessPointToken(apId, profileId);
      return new Response(JSON.stringify({ token: newToken }), { headers: { 'Content-Type': 'application/json' } });
    }

    const body = await request.json() as { name: string };
    if (!body.name) return new Response("Name is required", { status: 400 });
    if (!AP_NAME_REGEX.test(body.name)) return new Response("Invalid Access Point name format", { status: 400 });
    
    const currentAps = await profileModel.getAccessPoints(profileId);
    if (currentAps.some(ap => ap.name.toLowerCase() === body.name.toLowerCase())) {
      return new Response("Access Point name already exists", { status: 400 });
    }
    if (currentAps.length >= 100) return new Response("Access point limit exceeded (max 100)", { status: 400 });
    
    const result = await profileModel.addAccessPoint(profileId, body.name);
    return new Response(JSON.stringify(result), { status: 201, headers: { 'Content-Type': 'application/json' } });
  }

  if (request.method === 'PATCH' && pathParts.length === 5) {
    const apId = pathParts[4];
    const body = await request.json() as { name: string };
    if (!body.name) return new Response("Name is required", { status: 400 });
    if (!AP_NAME_REGEX.test(body.name)) return new Response("Invalid Access Point name format", { status: 400 });

    const currentAps = await profileModel.getAccessPoints(profileId);
    if (currentAps.some(ap => ap.id !== apId && ap.name.toLowerCase() === body.name.toLowerCase())) {
      return new Response("Access Point name already exists", { status: 400 });
    }

    await profileModel.updateAccessPointName(apId, profileId, body.name);
    return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
  }

  if (request.method === 'DELETE' && pathParts.length === 5) {
    const apId = pathParts[4];
    await profileModel.deleteAccessPoint(apId, profileId);
    return new Response(null, { status: 204 });
  }

  return new Response("Method Not Allowed", { status: 405 });
}
