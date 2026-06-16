import { Env, User, ExecutionContext } from "../../types";
import { AccessPointModel } from "../../models/accessPoint";

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
  const apModel = new AccessPointModel(env.DB);

  if (request.method === 'GET') {
    const results = await apModel.getAccessPoints(profileId);
    return new Response(JSON.stringify(results), { headers: { 'Content-Type': 'application/json' } });
  }

  if (request.method === 'POST') {
    if (pathParts.length === 6 && pathParts[5] === 'rotate_token') {
      const apId = pathParts[4];
      const newToken = await apModel.rotateAccessPointToken(apId, profileId);
      return new Response(JSON.stringify({ token: newToken }), { headers: { 'Content-Type': 'application/json' } });
    }

    const body = await request.json() as { name: string };
    if (!body.name) return new Response("Name is required", { status: 400 });
    if (!AP_NAME_REGEX.test(body.name)) return new Response("Invalid Access Point name format", { status: 400 });
    
    const currentAps = await apModel.getAccessPoints(profileId);
    if (currentAps.some(ap => ap.name.toLowerCase() === body.name.toLowerCase())) {
      return new Response("Access Point name already exists", { status: 400 });
    }
    if (currentAps.length >= 100) return new Response("Access point limit exceeded (max 100)", { status: 400 });
    
    const result = await apModel.addAccessPoint(profileId, body.name);
    return new Response(JSON.stringify(result), { status: 201, headers: { 'Content-Type': 'application/json' } });
  }

  if (request.method === 'PATCH' && pathParts.length === 5) {
    const apId = pathParts[4];
    const body = await request.json() as { name: string };
    if (!body.name) return new Response("Name is required", { status: 400 });
    if (!AP_NAME_REGEX.test(body.name)) return new Response("Invalid Access Point name format", { status: 400 });

    const currentAps = await apModel.getAccessPoints(profileId);
    if (currentAps.some(ap => ap.id !== apId && ap.name.toLowerCase() === body.name.toLowerCase())) {
      return new Response("Access Point name already exists", { status: 400 });
    }

    await apModel.updateAccessPointName(apId, profileId, body.name);
    return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
  }

  if (request.method === 'DELETE' && pathParts.length === 5) {
    const apId = pathParts[4];
    await apModel.deleteAccessPoint(apId, profileId);
    return new Response(null, { status: 204 });
  }

  return new Response("Method Not Allowed", { status: 405 });
}
