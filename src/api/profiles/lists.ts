import { Env, User, ExecutionContext } from "../../types";
import { ListModel } from "../../models/list";
import { ProfileModel } from "../../models/profile";
import { syncNextListForProfile, syncAllListsForProfile, syncSingleListForProfile, rebuildProfileBloom } from "../../utils/sync";
import { isSafeUrl } from "../../utils/validator";
import { pipeline } from "../../pipeline";
import { ListBloomModel } from "../../models/listBloom";
import { BloomFilter } from "../../utils/bloom";
import { AdguardRulesModel } from "../../models/adguardRules";
import { AdGuardProfileEngine } from "../../lib/adguard";

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
      if (!Number.isInteger(listId) || listId === 0) {
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

      const buffer = await new ListBloomModel(env.DB).getListBloom(list.url);
      const adguardRulesModel = env.DB ? new AdguardRulesModel(env.DB) : null;
      const adguardPayload = adguardRulesModel ? await adguardRulesModel.getListRules(list.url) : null;

      if (!buffer && !adguardPayload) {
        return new Response(JSON.stringify({ domain, blocked: false, synced: false }), {
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const adguardEngine = adguardPayload ? new AdGuardProfileEngine(adguardPayload) : null;

      // ── 阶段 1：AdGuard 白名单例外 (@@) ──────────────────────────────────────
      const exceptionMatch = adguardEngine?.findException(domain);
      if (exceptionMatch) {
        return new Response(JSON.stringify({
          domain,
          blocked: false,
          whitelisted: true,
          matchedEntry: exceptionMatch,
          falsePositiveRate: 0,
          enabled: !!list.enabled,
          synced: true
        }), { headers: { 'Content-Type': 'application/json' } });
      }

      // ── 阶段 2：Bloom 过滤器双态前缀检查 ────────────────────────────────────
      let bloom: BloomFilter | null = null;
      if (buffer) {
        try {
          bloom = BloomFilter.fromUint8Array(new Uint8Array(buffer));
        } catch (err) {
          console.error(`[Lists] Failed to deserialize bloom filter for list #${listId}:`, err);
        }
      }

      let currentDomain = domain;
      let isSelf = true;
      let matched: string | null = null;
      if (bloom) {
        while (currentDomain) {
          if (isSelf) {
            // 精确自身测试：匹配单域名黑名单 或 带有 || 的自身
            if (bloom.test(currentDomain) || bloom.test(`||${currentDomain}`)) {
              matched = currentDomain;
              break;
            }
            isSelf = false;
          } else {
            // 父级子域测试：仅当父域名是以 || 前缀注册时才拦截子域！
            if (bloom.test(`||${currentDomain}`)) {
              matched = currentDomain;
              break;
            }
          }
          const firstDot = currentDomain.indexOf('.');
          if (firstDot === -1) break;
          currentDomain = currentDomain.substring(firstDot + 1);
        }
      }

      // ── 阶段 3：AdGuard 正则与复杂通配符池 (Regex / Wildcard Pool) ───────────
      if (!matched && adguardEngine) {
        const patternMatch = adguardEngine.findPattern(domain);
        if (patternMatch) {
          matched = patternMatch.raw || patternMatch.pattern || domain;
        }
      }

      // ── 阶段 4：AdGuard DNS 重写规则 ($dnsrewrite) ───────────────────────────
      if (!matched && adguardEngine) {
        const rewriteMatch = adguardEngine.findRewrite(domain);
        if (rewriteMatch) {
          matched = rewriteMatch.raw || `${domain}$dnsrewrite=${rewriteMatch.action.value || rewriteMatch.action.type}`;
        }
      }

      return new Response(JSON.stringify({
        domain,
        blocked: matched !== null,
        whitelisted: false,
        matchedEntry: matched,
        falsePositiveRate: matched && bloom ? (Number(env.BLOOM_FALSE_POSITIVE_RATE) || 0.0001) : 0,
        enabled: !!list.enabled,
        synced: true
      }), { headers: { 'Content-Type': 'application/json' } });
    }

    const results = await listModel.getLists(profileId);
    return new Response(JSON.stringify(results), { headers: { 'Content-Type': 'application/json' } });
  }

  if (request.method === 'PATCH') {
    const listId = Number(pathParts[4]);
    if (!Number.isInteger(listId) || listId === 0) {
      return new Response("Invalid list id", { status: 400 });
    }

    let body: { enabled?: unknown; action?: unknown; keep?: unknown };
    try {
      body = await request.json() as { enabled?: unknown; action?: unknown; keep?: unknown };
    } catch {
      return new Response("Invalid JSON payload", { status: 400 });
    }

    const list = await listModel.getListById(listId, profileId);
    if (!list) return new Response("List Not Found", { status: 404 });

    if (typeof body.enabled !== 'boolean') {
      return new Response("Body must specify { enabled: boolean }", { status: 400 });
    }

    const updated = await listModel.setEnabled(listId, profileId, body.enabled);
    if (!updated) {
      return new Response("Failed to update list", { status: 500 });
    }

    // Rebuild the merged profile bloom from the per-list blooms already stored.
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

    if (pathParts.length >= 6 && pathParts[5] === 'sync') {
      const listId = Number(pathParts[4]);
      if (!Number.isInteger(listId) || listId === 0) {
        return new Response("Invalid list id", { status: 400 });
      }

      const list = await listModel.getListById(listId, profileId);
      if (!list) return new Response("List Not Found", { status: 404 });

      ctx.waitUntil(syncSingleListForProfile(profileId, listId, env, ctx));
      return new Response(JSON.stringify({ message: "List sync started", id: listId }), {
        status: 202,
        headers: { 'Content-Type': 'application/json' }
      });
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

      const existingLists = (await listModel.getLists(profileId)).filter((l) => l.scope === 'profile');
      const existingUrls = new Set(existingLists.map(l => l.url.trim().toLowerCase()));
      const itemsToInsert = validItems.filter(item => !existingUrls.has(item.url.toLowerCase()));

      let insertedCount = 0;
      if (itemsToInsert.length > 0) {
        insertedCount = await listModel.addListsBulk(profileId, itemsToInsert);
        ctx.waitUntil(rebuildProfileBloom(profileId, env, ctx));
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
    
    const insertResult = await listModel.addList(profileId, listUrl);
    const listId = insertResult.id;
    // 仅针对新添加的单条列表执行同步与规则重构合并，避免拉取和重刷所有列表
    if (listId) {
      ctx.waitUntil(syncSingleListForProfile(profileId, listId, env, ctx));
    }
    return new Response(JSON.stringify({ success: true, id: listId }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (request.method === 'DELETE') {
    let listId = Number(pathParts[4]);
    if (!Number.isInteger(listId) || listId === 0) {
      try {
        const body = await request.json() as { id?: number };
        if (typeof body?.id === 'number') {
          listId = body.id;
        }
      } catch {
        // body may be empty
      }
    }
    if (!listId || listId === 0) {
      return new Response("Invalid or missing list id", { status: 400 });
    }

    if (listId < 0) {
      return new Response(
        JSON.stringify({ error: "User-level and system-level lists cannot be deleted from a profile" }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    await listModel.deleteList(listId, profileId);
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
