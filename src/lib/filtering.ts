/**
 * @file filtering.ts
 * @description Local custom rule matching engine with fine-grained subdomain matching control.
 */

import { Rule } from "../types";

export class DNSFilter {
  /**
   * 检查域名是否匹配自定义规则。
   * 默认策略：仅做精确单个域名匹配。
   * 仅在显式声明 include_subdomains=true 或规则模式带有 || / *. 前缀时才匹配子域名。
   *
   * @param domain - 查询域名 (例如 "sub.example.com")
   * @param patternOrRule - Rule 对象或 pattern 字符串
   * @param explicitIncludeSubdomains - 可选的显式子域名匹配控制开关
   */
  static isMatch(
    domain: string,
    patternOrRule: string | Rule,
    explicitIncludeSubdomains?: boolean
  ): boolean {
    const d = domain.toLowerCase().replace(/\.$/, "");
    let p: string;
    let matchSubdomains = false;

    if (typeof patternOrRule === "string") {
      p = patternOrRule.toLowerCase().trim();
      matchSubdomains = Boolean(explicitIncludeSubdomains);
    } else {
      p = (patternOrRule.pattern || "").toLowerCase().trim();
      matchSubdomains = Boolean(patternOrRule.include_subdomains);
    }
    if (!p.endsWith("^")) {
      p = p.replace(/\.$/, "");
    }

    // 1. 如果显式勾选了“匹配子域名”
    if (matchSubdomains) {
      return d === p || d.endsWith(`.${p}`);
    }

    // 2. 兼容在 pattern 文本中直接书写了 AdGuard || 语法或 *. 通配符
    if (p.startsWith("||") && p.endsWith("^")) {
      const core = p.slice(2, -1);
      return d === core || d.endsWith(`.${core}`);
    }
    if (p.startsWith("||")) {
      const core = p.slice(2);
      return d === core || d.endsWith(`.${core}`);
    }
    if (p.startsWith("*.")) {
      const core = p.slice(2);
      return d === core || d.endsWith(`.${core}`);
    }

    // 3. 默认策略：严格精确单个域名匹配 (取消一律匹配子域名)
    return d === p;
  }

  /**
   * 在给定规则集中寻找匹配项
   * 返回匹配的规则，如果未找到则返回 null
   */
  static findMatch(domain: string, rules: Rule[]): Rule | null {
    for (const rule of rules) {
      if (this.isMatch(domain, rule)) {
        return rule;
      }
    }
    return null;
  }
}
