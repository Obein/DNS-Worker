import { Env, User, ExecutionContext } from "../../types";
import { ListModel } from "../../models/list";
import { syncProfileLists } from "../../utils/sync";
import { isSafeUrl } from "../../utils/validator";
import { pipeline } from "../../pipeline";

/**
 * Handle filter lists requests to /api/profiles/:id/lists
 */
export async function handleProfileListsRequest(
  request: Request,
  env: Env,
  user: User,
  profileId: string,
  pathParts: string[],
  ctx: ExecutionContext
): Promise<Response> {
  const listModel = new ListModel(env.DB);

  if (request.method === 'GET') {
    const results = await listModel.getLists(profileId);
    return new Response(JSON.stringify(results), { headers: { 'Content-Type': 'application/json' } });
  }

  if (request.method === 'POST') {
    if (pathParts[4] === 'sync') {
      ctx.waitUntil(syncProfileLists(profileId, env, ctx));
      return new Response(JSON.stringify({ message: "Sync started" }), { status: 202 });
    }

    const { url: listUrl } = await request.json() as { url: string };
    if (!listUrl || (!listUrl.startsWith('http://') && !listUrl.startsWith('https://'))) {
      return new Response("Invalid list URL format", { status: 400 });
    }
    if (!isSafeUrl(listUrl)) {
      return new Response("Invalid list URL. Private networks and localhosts are not allowed.", { status: 400 });
    }
    
    await listModel.addList(profileId, listUrl);
    ctx.waitUntil(syncProfileLists(profileId, env, ctx));
    ctx.waitUntil(pipeline.clearCache(profileId));
    return new Response(null, { status: 201 });
  }

  if (request.method === 'DELETE') {
    const { id } = await request.json() as { id: number };
    await listModel.deleteList(id, profileId);
    ctx.waitUntil(syncProfileLists(profileId, env, ctx));
    ctx.waitUntil(pipeline.clearCache(profileId));
    return new Response(null, { status: 204 });
  }

  return new Response("Method Not Allowed", { status: 405 });
}
