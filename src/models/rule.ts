import { D1Database } from "@cloudflare/workers-types";
import { Rule } from "../types";

export class RuleModel {
  constructor(private db: D1Database) {}

  async getRules(profileId: string): Promise<Rule[]> {
    const { results } = await this.db.prepare("SELECT * FROM rules WHERE profile_id = ? ORDER BY id DESC")
      .bind(profileId)
      .all<Rule>();
    return results;
  }

  async addRule(profileId: string, rule: Partial<Rule>): Promise<boolean> {
    const normalizedPattern = rule.pattern ? rule.pattern.trim().toLowerCase() : "";
    const result = await this.db.prepare(
      "INSERT INTO rules (profile_id, type, pattern, v_a, v_aaaa, v_txt, v_cname) VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
      .bind(profileId, rule.type, normalizedPattern, rule.v_a || null, rule.v_aaaa || null, rule.v_txt || null, rule.v_cname || null)
      .run();
    return result.success;
  }

  async updateRule(id: number, profileId: string, rule: Partial<Rule>): Promise<boolean> {
    const normalizedPattern = rule.pattern ? rule.pattern.trim().toLowerCase() : "";
    const result = await this.db.prepare(
      "UPDATE rules SET type = ?, pattern = ?, v_a = ?, v_aaaa = ?, v_txt = ?, v_cname = ? WHERE id = ? AND profile_id = ?"
    )
      .bind(rule.type, normalizedPattern, rule.v_a || null, rule.v_aaaa || null, rule.v_txt || null, rule.v_cname || null, id, profileId)
      .run();
    return result.success;
  }

  async getRuleByPattern(profileId: string, pattern: string): Promise<Rule | null> {
    return await this.db.prepare("SELECT * FROM rules WHERE profile_id = ? AND LOWER(pattern) = ?")
      .bind(profileId, pattern.trim().toLowerCase())
      .first<Rule | null>();
  }

  async getRuleByPatternExcludeId(profileId: string, pattern: string, id: number): Promise<Rule | null> {
    return await this.db.prepare("SELECT * FROM rules WHERE profile_id = ? AND LOWER(pattern) = ? AND id != ?")
      .bind(profileId, pattern.trim().toLowerCase(), id)
      .first<Rule | null>();
  }

  async deleteRule(id: number, profileId: string): Promise<boolean> {
    const result = await this.db.prepare("DELETE FROM rules WHERE id = ? AND profile_id = ?").bind(id, profileId).run();
    return result.success;
  }
}
