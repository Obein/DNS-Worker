import { Env, User, ExecutionContext } from "../../types";
import { ListModel } from "../../models/list";
import { ProfileModel } from "../../models/profile";
import { syncNextListForProfile, syncAllListsForProfile } from "../../utils/sync";
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
  const profileModel = new ProfileModel(env.DB);

  if (request.method === 'GET') {
    const results = await listModel.getLists(profileId);
    return new Response(JSON.stringify(results), { headers: { 'Content-Type': 'application/json' } });
  }

  if (request.method === 'POST') {
    if (pathParts[4] === 'sync') {
      // 触发所有列表的同步
      ctx.waitUntil(syncAllListsForProfile(profileId, env, ctx));
      return new Response(JSON.stringify({ message: "Sync started" }), { status: 202 });
    }

    const body = await request.json() as any;

    // Support bulk list addition when body is an array or contains lists/urls/filters array
    const isBulk = Array.isArray(body) || (body && (Array.isArray(body.lists) || Array.isArray(body.urls) || Array.isArray(body.filters)));
    if (isBulk) {
      const rawList: any[] = Array.isArray(body) ? body : (body.lists || body.urls || body.filters);
      const seen = new Set<string>();
      const validUrls: string[] = [];

      for (const item of rawList) {
        const urlStr = typeof item === 'string' ? item.trim() : (item?.url ? String(item.url).trim() : '');
        if (!urlStr || (!urlStr.startsWith('http://') && !urlStr.startsWith('https://'))) continue;
        if (!isSafeUrl(urlStr)) continue;
        const norm = urlStr.toLowerCase();
        if (seen.has(norm)) continue;
        seen.add(norm);
        validUrls.push(urlStr);
      }

      if (validUrls.length === 0) {
        return new Response(JSON.stringify({ count: 0, message: "No valid URLs provided" }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const existingLists = await listModel.getLists(profileId);
      const existingUrls = new Set(existingLists.map(l => l.url.trim().toLowerCase()));
      const urlsToInsert = validUrls.filter(u => !existingUrls.has(u.toLowerCase()));

      let insertedCount = 0;
      if (urlsToInsert.length > 0) {
        insertedCount = await listModel.addListsBulk(profileId, urlsToInsert);
        ctx.waitUntil(syncNextListForProfile(profileId, env, ctx));
        ctx.waitUntil(pipeline.clearCache(profileId));
      }

      return new Response(JSON.stringify({ success: true, count: insertedCount }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const { url: listUrl } = body as { url: string };
    if (!listUrl || (!listUrl.startsWith('http://') && !listUrl.startsWith('https://'))) {
      return new Response("Invalid list URL format", { status: 400 });
    }
    if (!isSafeUrl(listUrl)) {
      return new Response("Invalid list URL. Private networks and localhosts are not allowed.", { status: 400 });
    }
    
    await listModel.addList(profileId, listUrl);
    // 只触发新添加列表的同步 (syncNextListForProfile 会挑选未同步的最旧列表，即此新列表)
    ctx.waitUntil(syncNextListForProfile(profileId, env, ctx));
    ctx.waitUntil(pipeline.clearCache(profileId));
    return new Response(null, { status: 201 });
  }

  if (request.method === 'DELETE') {
    const { id } = await request.json() as { id: number };
    await listModel.deleteList(id, profileId);
    // 触发重构合并 (没有 pending 列表，syncNextListForProfile 会直接运行 combineAndPromote)
    ctx.waitUntil(syncNextListForProfile(profileId, env, ctx));
    ctx.waitUntil(pipeline.clearCache(profileId));
    return new Response(null, { status: 204 });
  }

  return new Response("Method Not Allowed", { status: 405 });
}
