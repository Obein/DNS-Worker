function isIpLike(str: string): boolean {
  if (str.includes(':')) return true; // IPv6

  let dotCount = 0;
  const len = str.length;
  if (len < 7 || len > 15) return false;
  for (let i = 0; i < len; i++) {
    const code = str.charCodeAt(i);
    if (code === 46) { // '.'
      dotCount++;
    } else if (code < 48 || code > 57) { // not '0'-'9'
      return false;
    }
  }
  return dotCount === 3;
}

/**
 * 解析单行订阅规则，提取域名。
 * 支持：Hosts格式、AdGuard广告过滤规则格式。
 */
export function parseLine(line: string): string | null {
  // 手动去除两端空白字符，提升性能并减少临时字符串分配
  let start = 0;
  const len = line.length;
  while (start < len) {
    const code = line.charCodeAt(start);
    if (code === 32 || code === 9 || code === 13 || code === 10) {
      start++;
    } else {
      break;
    }
  }

  let end = len;
  while (end > start) {
    const code = line.charCodeAt(end - 1);
    if (code === 32 || code === 9 || code === 13 || code === 10) {
      end--;
    } else {
      break;
    }
  }

  if (start >= end) {
    return null;
  }

  // 检查是否为注释行（首个非空白字符为 '!' 或 '#' 或 '@@'）
  const firstChar = line.charCodeAt(start);
  if (firstChar === 33 || firstChar === 35) { // '!' 或 '#'
    return null;
  }
  if (firstChar === 64 && start + 1 < end && line.charCodeAt(start + 1) === 64) { // '@@'
    return null;
  }

  const cleanLine = line.substring(start, end);

  // 1. AdGuard 广告过滤规则格式 (如: ||example.com^$all)
  if (cleanLine.startsWith('||')) {
    let domain = cleanLine.substring(2);
    const caretIdx = domain.indexOf('^');
    if (caretIdx !== -1) {
      domain = domain.substring(0, caretIdx);
    }
    const dollarIdx = domain.indexOf('$');
    if (dollarIdx !== -1) {
      domain = domain.substring(0, dollarIdx);
    }
    domain = domain.trim().toLowerCase();
    return domain || null;
  }

  // 2. Hosts 规则文件格式 (如: 127.0.0.1 example.com)
  let firstSpace = -1;
  const lineLen = cleanLine.length;
  for (let i = 0; i < lineLen; i++) {
    const code = cleanLine.charCodeAt(i);
    if (code === 32 || code === 9) { // 遇到空格或 Tab
      firstSpace = i;
      break;
    }
  }

  if (firstSpace === -1) {
    return cleanLine.toLowerCase();
  } else {
    const part0 = cleanLine.substring(0, firstSpace);
    // 跨过连续的空格或 Tab
    let secondStart = firstSpace;
    while (secondStart < lineLen) {
      const code = cleanLine.charCodeAt(secondStart);
      if (code === 32 || code === 9) {
        secondStart++;
      } else {
        break;
      }
    }

    let part1 = "";
    if (secondStart < lineLen) {
      let secondEnd = secondStart;
      while (secondEnd < lineLen) {
        const code = cleanLine.charCodeAt(secondEnd);
        if (code === 32 || code === 9) {
          break;
        }
        secondEnd++;
      }
      part1 = cleanLine.substring(secondStart, secondEnd);
    }

    if (part1 !== "") {
      if (isIpLike(part0)) {
        const domain = part1.toLowerCase();
        if (domain !== 'localhost' && domain !== '0.0.0.0' && domain !== '127.0.0.1') {
          return domain;
        }
        return null;
      } else {
        return part0.toLowerCase();
      }
    } else {
      return part0.toLowerCase();
    }
  }
}

/**
 * 完整文本解析（回退/测试用）
 */
export function parseList(content: string): string[] {
  const domains = new Set<string>();
  const lines = content.split('\n');
  for (const line of lines) {
    const domain = parseLine(line);
    if (domain) {
      domains.add(domain);
    }
  }
  return Array.from(domains);
}
