import { Env, User, ExecutionContext, Rule } from "../../types";
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
    const body = await request.json() as any;

    // Support bulk insertion when body is an array or contains rules array
    const isBulk = Array.isArray(body) || (body && Array.isArray(body.rules));
    if (isBulk) {
      const rawList: any[] = Array.isArray(body) ? body : body.rules;
      const seen = new Set<string>();
      const validRules: Partial<Rule>[] = [];

      for (const r of rawList) {
        if (!r || typeof r.pattern !== 'string') continue;
        const pattern = r.pattern.trim().toLowerCase();
        if (!pattern || seen.has(pattern)) continue;
        seen.add(pattern);

        const type = String(r.type || 'BLOCK').toUpperCase();
        if (type !== 'ALLOW' && type !== 'BLOCK' && type !== 'REDIRECT') continue;

        validRules.push({
          type: type as 'ALLOW' | 'BLOCK' | 'REDIRECT',
          pattern,
          v_a: r.v_a || null,
          v_aaaa: r.v_aaaa || null,
          v_txt: r.v_txt || null,
          v_cname: r.v_cname || null,
        });
      }

      if (validRules.length === 0) {
        return new Response(JSON.stringify({ count: 0, message: "No valid rules provided" }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const existingRules = await ruleModel.getRules(profileId);
      const existingPatterns = new Set(existingRules.map(r => r.pattern.trim().toLowerCase()));
      const rulesToInsert = validRules.filter(r => !existingPatterns.has(r.pattern!));

      let insertedCount = 0;
      if (rulesToInsert.length > 0) {
        insertedCount = await ruleModel.addRulesBulk(profileId, rulesToInsert);
        ctx.waitUntil(pipeline.clearCache(profileId, false));
      }

      return new Response(JSON.stringify({ success: true, count: insertedCount }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const rule = body;
    const pattern = rule.pattern ? rule.pattern.trim() : "";
    if (!pattern) {
      return new Response("Domain pattern cannot be empty", { status: 400 });
    }
    const existing = await ruleModel.getRuleByPattern(profileId, pattern);
    if (existing) {
      return new Response("Rule for this domain already exists", { status: 400 });
    }
    await ruleModel.addRule(profileId, rule);
    ctx.waitUntil(pipeline.clearCache(profileId, false));
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
    ctx.waitUntil(pipeline.clearCache(profileId, false));
    return new Response(null, { status: 200 });
  }

  if (request.method === 'DELETE') {
    const { id } = await request.json() as any;
    await ruleModel.deleteRule(id, profileId);
    ctx.waitUntil(pipeline.clearCache(profileId, false));
    return new Response(null, { status: 204 });
  }

  return new Response("Method Not Allowed", { status: 405 });
}
