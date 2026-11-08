import { Env, User, ExecutionContext } from "../../types";
import { ListModel } from "../../models/list";
import { ListBloomModel } from "../../models/listBloom";
import { isSafeUrl } from "../../utils/validator";
import { syncGlobalList, rebuildProfileBloom } from "../../utils/sync";
import { pipeline } from "../../pipeline";

/**
 * Handles user-level filter list requests to /api/account/user-lists
 */
export async function handleUserListsRequest(
  request: Request,
  env: Env,
  user: User,
  pathParts: string[],
  ctx: ExecutionContext
): Promise<Response> {
  const listModel = new ListModel(env.DB);
  const listBloomModel = new ListBloomModel(env.DB);

  // Helper to trigger bloom rebuild across all profiles of this user
  const triggerUserBloomRebuilds = async () => {
    const { results: userProfiles } = await env.DB.prepare(
      "SELECT id FROM profiles WHERE owner_id = ?"
    ).bind(user.id).all<{ id: string }>();

    for (const p of userProfiles || []) {
      ctx.waitUntil(
        rebuildProfileBloom(p.id, env, ctx)
          .then(() => pipeline.clearCache(p.id, true, env))
          .catch((e) => console.error(`[UserLists] Bloom rebuild failed for profile ${p.id}:`, e))
      );
    }
  };

  // 1. GET /api/account/user-lists
  if (request.method === "GET") {
    const lists = await listModel.getUserLists(user.id);
    return new Response(JSON.stringify(lists), {
      headers: { "Content-Type": "application/json" }
    });
  }

  // 2. POST /api/account/user-lists
  if (request.method === "POST") {
    let body: { url?: string };
    try {
      body = await request.json() as { url?: string };
    } catch {
      return new Response("Invalid JSON payload", { status: 400 });
    }

    const rawUrl = (body.url || "").trim();
    if (!rawUrl || (!rawUrl.startsWith("http://") && !rawUrl.startsWith("https://"))) {
      return new Response("Invalid list URL format. Must start with http:// or https://", { status: 400 });
    }

    if (!isSafeUrl(rawUrl)) {
      return new Response("Invalid list URL. Private networks and localhosts are not allowed.", { status: 400 });
    }

    const canonicalUrl = ListModel.normalizeUrl(rawUrl);

    // Check if list already exists for user
    const existing = await listModel.getUserListByUrl(canonicalUrl, user.id);
    if (existing) {
      const msg = existing.is_system === 1
        ? "This filter list is already active as a system-distributed list"
        : "This filter list already exists in your user-level lists";
      return new Response(JSON.stringify({ error: msg }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    const addResult = await listModel.addUserList(user.id, canonicalUrl, false);
    if (!addResult.success || !addResult.id) {
      return new Response("Failed to add user list", { status: 500 });
    }

    const createdList = await listModel.getUserListById(addResult.id, user.id);

    // Asynchronously trigger global compilation & profile bloom rebuilds
    ctx.waitUntil(
      syncGlobalList(canonicalUrl, env, listModel, listBloomModel, Math.floor(Date.now() / 1000))
        .then(() => triggerUserBloomRebuilds())
        .catch((e) => console.error(`[UserLists] Global sync failed for ${canonicalUrl}:`, e))
    );

    return new Response(JSON.stringify({ success: true, list: createdList }), {
      status: 201,
      headers: { "Content-Type": "application/json" }
    });
  }

  // 3. PATCH /api/account/user-lists/:id
  if (request.method === "PATCH") {
    const listId = Number(pathParts[3]);
    if (!Number.isInteger(listId) || listId <= 0) {
      return new Response("Invalid user list id", { status: 400 });
    }

    let body: { enabled?: unknown };
    try {
      body = await request.json() as { enabled?: unknown };
    } catch {
      return new Response("Invalid JSON payload", { status: 400 });
    }

    if (typeof body.enabled !== "boolean") {
      return new Response("Body must specify { enabled: boolean }", { status: 400 });
    }

    const existing = await listModel.getUserListById(listId, user.id);
    if (!existing) {
      return new Response("User list not found", { status: 404 });
    }

    const updated = await listModel.toggleUserList(listId, user.id, body.enabled);
    if (!updated) {
      return new Response("Failed to update user list", { status: 500 });
    }

    triggerUserBloomRebuilds();

    return new Response(JSON.stringify({ success: true, id: listId, enabled: body.enabled }), {
      headers: { "Content-Type": "application/json" }
    });
  }

  // 4. DELETE /api/account/user-lists/:id
  if (request.method === "DELETE") {
    let listId = Number(pathParts[3]);
    if (!Number.isInteger(listId) || listId <= 0) {
      try {
        const body = await request.json() as { id?: number };
        if (typeof body?.id === "number") listId = body.id;
      } catch {}
    }

    if (!listId || listId <= 0) {
      return new Response("Invalid user list id", { status: 400 });
    }

    const existing = await listModel.getUserListById(listId, user.id);
    if (!existing) {
      return new Response("User list not found", { status: 404 });
    }

    if (existing.is_system === 1) {
      return new Response(
        JSON.stringify({ error: "System-distributed lists cannot be deleted by users" }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      );
    }

    const deleted = await listModel.deleteUserList(listId, user.id);
    if (!deleted) {
      return new Response("Failed to delete user list", { status: 500 });
    }

    triggerUserBloomRebuilds();

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }

  return new Response("Method Not Allowed", { status: 405 });
}
