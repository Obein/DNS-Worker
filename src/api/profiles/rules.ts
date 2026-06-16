import { Env, User, ExecutionContext } from "../../types";
import { RuleModel } from "../../models/rule";
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
  const ruleModel = new RuleModel(env.DB);

  if (request.method === 'GET') {
    const results = await ruleModel.getRules(profileId);
    return new Response(JSON.stringify(results), { headers: { 'Content-Type': 'application/json' } });
  }

  if (request.method === 'POST') {
    const rule = await request.json() as any;
    const pattern = rule.pattern ? rule.pattern.trim() : "";
    if (!pattern) {
      return new Response("Domain pattern cannot be empty", { status: 400 });
    }
    const existing = await ruleModel.getRuleByPattern(profileId, pattern);
    if (existing) {
      return new Response("Rule for this domain already exists", { status: 400 });
    }
    await ruleModel.addRule(profileId, rule);
    ctx.waitUntil(pipeline.clearCache(profileId));
    return new Response(null, { status: 201 });
  }

  if (request.method === 'PUT') {
    const rule = await request.json() as any;
    const pattern = rule.pattern ? rule.pattern.trim() : "";
    if (!pattern) {
      return new Response("Domain pattern cannot be empty", { status: 400 });
    }
    const existing = await ruleModel.getRuleByPatternExcludeId(profileId, pattern, rule.id);
    if (existing) {
      return new Response("Rule for this domain already exists", { status: 400 });
    }
    await ruleModel.updateRule(rule.id, profileId, rule);
    ctx.waitUntil(pipeline.clearCache(profileId));
    return new Response(null, { status: 200 });
  }

  if (request.method === 'DELETE') {
    const { id } = await request.json() as any;
    await ruleModel.deleteRule(id, profileId);
    ctx.waitUntil(pipeline.clearCache(profileId));
    return new Response(null, { status: 204 });
  }

  return new Response("Method Not Allowed", { status: 405 });
}
