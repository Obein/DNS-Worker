import { Env, User, ExecutionContext } from "../../types";
import { ProfileModel } from "../../models/profile";
import { pipeline } from "../../pipeline";

/**
 * Handle custom rules requests to /api/profiles/:id/rules
 */
export async function handleProfileRulesRequest(
  request: Request,
  env: Env,
  user: User,
  profileId: string,
  pathParts: string[],
  ctx: ExecutionContext
): Promise<Response> {
  const profileModel = new ProfileModel(env.DB);

  if (request.method === 'GET') {
    const results = await profileModel.getRules(profileId);
    return new Response(JSON.stringify(results), { headers: { 'Content-Type': 'application/json' } });
  }

  if (request.method === 'POST') {
    const rule = await request.json() as any;
    const pattern = rule.pattern ? rule.pattern.trim() : "";
    if (!pattern) {
      return new Response("Domain pattern cannot be empty", { status: 400 });
    }
    const existing = await profileModel.getRuleByPattern(profileId, pattern);
    if (existing) {
      return new Response("Rule for this domain already exists", { status: 400 });
    }
    await profileModel.addRule(profileId, rule);
    ctx.waitUntil(pipeline.clearCache(profileId));
    return new Response(null, { status: 201 });
  }

  if (request.method === 'PUT') {
    const rule = await request.json() as any;
    const pattern = rule.pattern ? rule.pattern.trim() : "";
    if (!pattern) {
      return new Response("Domain pattern cannot be empty", { status: 400 });
    }
    const existing = await profileModel.getRuleByPatternExcludeId(profileId, pattern, rule.id);
    if (existing) {
      return new Response("Rule for this domain already exists", { status: 400 });
    }
    await profileModel.updateRule(rule.id, profileId, rule);
    ctx.waitUntil(pipeline.clearCache(profileId));
    return new Response(null, { status: 200 });
  }

  if (request.method === 'DELETE') {
    const { id } = await request.json() as any;
    await profileModel.deleteRule(id, profileId);
    ctx.waitUntil(pipeline.clearCache(profileId));
    return new Response(null, { status: 204 });
  }

  return new Response("Method Not Allowed", { status: 405 });
}
