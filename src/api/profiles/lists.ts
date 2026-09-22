import { Env, User, ExecutionContext } from "../../types";
import { ListModel } from "../../models/list";
import { ProfileModel } from "../../models/profile";
import { syncNextListForProfile, syncAllListsForProfile, rebuildProfileBloom } from "../../utils/sync";
import { isSafeUrl } from "../../utils/validator";
import { pipeline } from "../../pipeline";
import { ListBloomModel } from "../../models/listBloom";
import { BloomFilter } from "../../utils/bloom";

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
    // GET /api/profiles/:id/lists/:listId/check?domain=example.com
    //
    // Answers "does this list block this domain" straight from the list's own
    // bloom filter, walking parent domains exactly as pipeline/filter.ts does.
    // External lists are stored only as bloom filters, so their entries cannot
    // be enumerated or substring-searched - but membership is answerable in
    // microseconds, which is the question the UI actually asks.
    if (pathParts[5] === 'check') {
      const listId = Number(pathParts[4]);
      if (!Number.isInteger(listId) || listId <= 0) {
        return new Response("Invalid list id", { status: 400 });
      }

      const rawDomain = (new URL(request.url).searchParams.get('domain') || '').trim().toLowerCase();
      // Strip trailing dots (e.g. FQDN "example.com.") to match DNS labels correctly
      const domain = rawDomain.replace(/\.+$/, '');
      if (!domain || domain.length > 253 || !/^[a-z0-9._-]+$/.test(domain)) {
        return new Response("Invalid or missing domain parameter", { status: 400 });
      }

      const list = await listModel.getListById(listId, profileId);
      if (!list) return new Response("List Not Found", { status: 404 });

      const buffer = await new ListBloomModel(env.DB).getListBloom(listId);
      if (!buffer) {
        return new Response(JSON.stringify({ domain, blocked: false, synced: false }), {
          headers: { 'Content-Type': 'application/json' }
        });
      }

      let bloom: BloomFilter;
      try {
        bloom = BloomFilter.fromUint8Array(new Uint8Array(buffer));
      } catch (err) {
        console.error(`[Lists] Failed to deserialize bloom filter for list #${listId}:`, err);
        return new Response(JSON.stringify({ domain, blocked: false, synced: false, error: "Corrupted filter" }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      let candidate: string = domain;
      let matched: string | null = null;
      while (candidate) {
        if (bloom.test(candidate)) { matched = candidate; break; }
        const dot = candidate.indexOf('.');
        if (dot === -1) break;
        candidate = candidate.slice(dot + 1);
      }

      return new Response(JSON.stringify({
        domain,
        blocked: matched !== null,
        // The entry that matched: equal to `domain` on an exact hit, or the
        // parent domain when the block comes from a wildcard higher up.
        matchedEntry: matched,
        // A positive is a bloom hit, not proof of membership. The parent walk
        // tests one suffix per label, so the effective false-positive rate is
        // roughly the configured rate times the number of labels tested.
        falsePositiveRate: Number(env.BLOOM_FALSE_POSITIVE_RATE) || 0.0001,
        // A disabled list still has a stored bloom, so say so rather than
        // implying the domain is currently being filtered.
        enabled: !!list.enabled,
        synced: true
      }), { headers: { 'Content-Type': 'application/json' } });
    }

    const results = await listModel.getLists(profileId);
    return new Response(JSON.stringify(results), { headers: { 'Content-Type': 'application/json' } });
  }

  if (request.method === 'PATCH') {
    const listId = Number(pathParts[4]);
    if (!Number.isInteger(listId) || listId <= 0) {
      return new Response("Invalid list id", { status: 400 });
    }

    let body: { enabled?: unknown };
    try {
      body = await request.json() as { enabled?: unknown };
    } catch {
      return new Response("Body must be { enabled: boolean }", { status: 400 });
    }
    if (typeof body.enabled !== 'boolean') {
      return new Response("Body must be { enabled: boolean }", { status: 400 });
    }

    const list = await listModel.getListById(listId, profileId);
    if (!list) return new Response("List Not Found", { status: 404 });

    const updated = await listModel.setEnabled(listId, profileId, body.enabled);
    if (!updated) {
      return new Response("Failed to update list", { status: 500 });
    }

    // Rebuild the merged profile bloom from the per-list blooms already stored.
    // rebuildProfileBloom skips the incremental orchestrator deliberately: that
    // path would re-download every remaining list, and with 2+ active lists it
    // would not recombine at all. clearCache is chained so it cannot run before
    // the new bloom is promoted.
    ctx.waitUntil(
      rebuildProfileBloom(profileId, env, ctx)
        .then(() => pipeline.clearCache(profileId, true, env))
        .catch((e) => console.error(`[Lists] bloom rebuild failed for ${profileId}:`, e))
    );

    return new Response(JSON.stringify({ id: listId, enabled: body.enabled }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (request.method === 'POST') {
    if (pathParts[4] === 'sync') {
      // 触发所有列表的同步
      ctx.waitUntil(syncAllListsForProfile(profileId, env, ctx));
      return new Response(JSON.stringify({ message: "Sync started" }), { status: 202 });
    }

    const body = await request.json() as any;

    // Support bulk list addition when body is an array or contains lists/urls/filters/blocklists array
    const candidateList = Array.isArray(body)
      ? body
      : (body?.lists || body?.list || body?.urls || body?.url || body?.filters || body?.filter || body?.blocklists || body?.blocklist);

    const isBulk = Array.isArray(candidateList);
    if (isBulk) {
      const rawList: any[] = candidateList;
      const seen = new Set<string>();
      const validItems: { url: string; enabled: number }[] = [];

      for (const item of rawList) {
        let urlStr = typeof item === 'string'
          ? item.trim()
          : (item?.url ?? item?.link ?? item?.uri ?? item?.address ?? item?.source ?? item?.target ?? item?.download_url ?? '');
        if (typeof urlStr !== 'string') continue;
        urlStr = urlStr.replace(/^["']|["']$/g, '').trim();
        if (urlStr.startsWith('//')) {
          urlStr = `https:${urlStr}`;
        } else if (!urlStr.startsWith('http://') && !urlStr.startsWith('https://')) {
          if (urlStr.includes('.') && !urlStr.includes(' ') && urlStr.length > 3) {
            urlStr = `https://${urlStr}`;
          } else {
            continue;
          }
        }
        if (!isSafeUrl(urlStr)) continue;
        const norm = urlStr.toLowerCase();
        if (seen.has(norm)) continue;
        seen.add(norm);

        const enabled = (item && typeof item === 'object' && item.enabled !== undefined)
          ? (item.enabled ? 1 : 0)
          : 1;
        validItems.push({ url: urlStr, enabled });
      }

      if (validItems.length === 0) {
        return new Response(JSON.stringify({ count: 0, message: "No valid URLs provided" }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const existingLists = await listModel.getLists(profileId);
      const existingUrls = new Set(existingLists.map(l => l.url.trim().toLowerCase()));
      const itemsToInsert = validItems.filter(item => !existingUrls.has(item.url.toLowerCase()));

      let insertedCount = 0;
      if (itemsToInsert.length > 0) {
        insertedCount = await listModel.addListsBulk(profileId, itemsToInsert);
        ctx.waitUntil(syncNextListForProfile(profileId, env, ctx));
        ctx.waitUntil(pipeline.clearCache(profileId, true, env));
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
    ctx.waitUntil(pipeline.clearCache(profileId, true, env));
    return new Response(null, { status: 201 });
  }

  if (request.method === 'DELETE') {
    const { id } = await request.json() as { id: number };
    await listModel.deleteList(id, profileId);
    // 触发纯内存重构合并，并在落库后清除缓存，彻底消除竞态条件与 pending 阻塞
    ctx.waitUntil(
      rebuildProfileBloom(profileId, env, ctx)
        .then(() => pipeline.clearCache(profileId, true, env))
        .catch((e) => console.error(`[Lists] Bloom rebuild after delete failed for ${profileId}:`, e))
    );
    return new Response(null, { status: 204 });
  }

  return new Response("Method Not Allowed", { status: 405 });
}
