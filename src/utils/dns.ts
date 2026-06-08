import { DNSQuery } from "../types";

const DNS_TYPES: Record<number, string> = {
  1: "A",
  2: "NS",
  5: "CNAME",
  6: "SOA",
  12: "PTR",
  13: "HINFO",
  15: "MX",
  16: "TXT",
  17: "RP",
  24: "SIG",
  25: "KEY",
  28: "AAAA",
  29: "LOC",
  33: "SRV",
  35: "NAPTR",
  36: "KX",
  37: "CERT",
  39: "DNAME",
  41: "OPT",
  43: "DS",
  44: "SSHFP",
  45: "IPSECKEY",
  46: "RRSIG",
  47: "NSEC",
  48: "DNSKEY",
  49: "DHCID",
  50: "NSEC3",
  51: "NSEC3PARAM",
  52: "TLSA",
  53: "SMIMEA",
  59: "CDS",
  64: "SVCB",
  65: "HTTPS",
  99: "SPF",
  255: "ANY",
  256: "URI",
  257: "CAA",
  32769: "DLV"
};

const DNS_TYPE_TO_CODE: Record<string, number> = Object.fromEntries(
  Object.entries(DNS_TYPES).map(([code, name]) => [name, Number(code)])
);

/**
 * 解析 DNS 域名（支持压缩指针 0xC0）
 */
function decodeName(buffer: Uint8Array, offset: number): { name: string; read: number } {
  let name = "";
  let curr = offset;
  let jumped = false;
  let consumed = 0;
  let iterations = 0;

  while (iterations < 128) {
    if (curr >= buffer.length) break; // 边界检查
    const len = buffer[curr];
    
    if (len === 0) {
      if (!jumped) consumed++;
      break;
    }

    if ((len & 0xc0) === 0xc0) {
      if (curr + 1 >= buffer.length) break; // 指针字节不足
      const pointer = ((len & 0x3f) << 8) | buffer[curr + 1];
      if (!jumped) {
        consumed += 2;
        jumped = true;
      }
      curr = pointer;
      iterations++;
      continue;
    }

    if (name.length > 0) name += ".";
    // 检查标签内容是否超出范围
    if (curr + 1 + len > buffer.length) break;
    
    for (let i = 0; i < len; i++) {
      name += String.fromCharCode(buffer[curr + 1 + i]);
    }
    if (!jumped) consumed += len + 1;
    curr += len + 1;
    iterations++;
  }

  return { name, read: consumed };
}

export async function parseDNSQuery(request: Request): Promise<DNSQuery | null> {
  try {
    let raw: Uint8Array;

    if (request.method === "GET") {
      const url = new URL(request.url);
      const dnsParam = url.searchParams.get("dns");
      if (!dnsParam) return null;

      let base64 = dnsParam.replace(/-/g, "+").replace(/_/g, "/");
      while (base64.length % 4) base64 += '=';
      
      const binary = atob(base64);
      raw = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        raw[i] = binary.charCodeAt(i);
      }
    } else if (request.method === "POST") {
      const buffer = await request.arrayBuffer();
      raw = new Uint8Array(buffer);
    } else {
      return null;
    }

    // 基础长度检查：Header(12) + QTYPE(2) + QCLASS(2) = 16
    if (raw.length < 16) return null;

    const { name, read } = decodeName(raw, 12);
    const qtypeOffset = 12 + read;
    
    // 再次检查剩余长度
    if (qtypeOffset + 4 > raw.length) return null;
    
    const qtypeCode = (raw[qtypeOffset] << 8) | raw[qtypeOffset + 1];
    
    return {
      name,
      type: getQTypeName(qtypeCode),
      raw
    };
  } catch (e) {
    console.error("DNS Parse Error:", e);
    return null;
  }
}

function getQTypeName(type: number): string {
  return DNS_TYPES[type] || `TYPE${type}`;
}

export function buildDNSQuery(name: string, type: string): Uint8Array {
  const header = new Uint8Array(12);
  const id = Math.floor(Math.random() * 65535);
  header[0] = id >> 8;
  header[1] = id & 0xff;
  header[2] = 0x01; // QR=0, Opcode=0, AA=0, TC=0, RD=1
  header[3] = 0x00; // RA=0, Z=0, RCODE=0
  header[4] = 0x00; // QDCOUNT (High)
  header[5] = 0x01; // QDCOUNT (Low) - 1 Question
  header[6] = 0x00; // ANCOUNT
  header[7] = 0x00;
  header[8] = 0x00; // NSCOUNT
  header[9] = 0x00;
  header[10] = 0x00; // ARCOUNT
  header[11] = 0x00;

  const labels = name.split(".");
  const question = [];
  for (const label of labels) {
    question.push(label.length);
    for (let i = 0; i < label.length; i++) {
      question.push(label.charCodeAt(i));
    }
  }
  question.push(0); // Root

  const typeCode = DNS_TYPE_TO_CODE[type] || 1;
  question.push(typeCode >> 8);
  question.push(typeCode & 0xff);
  question.push(0x00); // Class IN
  question.push(0x01);

  const raw = new Uint8Array(header.length + question.length);
  raw.set(header);
  raw.set(question, header.length);
  return raw;
}

export function parseDNSAnswer(raw: Uint8Array): { name: string; type: string; data: string; ttl: number }[] {
  if (raw.length < 12) return [];
  const ansCount = (raw[6] << 8) | raw[7];
  if (ansCount === 0) return [];

  const results: { name: string; type: string; data: string; ttl: number }[] = [];
  let offset = 12;

  const qCount = (raw[4] << 8) | raw[5];
  for (let i = 0; i < qCount; i++) {
    const { read } = decodeName(raw, offset);
    offset += read + 4;
  }

  for (let i = 0; i < ansCount; i++) {
    const { name, read: nameRead } = decodeName(raw, offset);
    offset += nameRead;

    const typeCode = (raw[offset] << 8) | raw[offset + 1];
    const ttl = (raw[offset + 4] << 24) | (raw[offset + 5] << 16) | (raw[offset + 6] << 8) | raw[offset + 7];
    const rdLength = (raw[offset + 8] << 8) | raw[offset + 9];
    offset += 10;

    const type = getQTypeName(typeCode);
    let data = "";

    if (type === "A" && rdLength === 4) {
      data = `${raw[offset]}.${raw[offset+1]}.${raw[offset+2]}.${raw[offset+3]}`;
    } else if (type === "AAAA" && rdLength === 16) {
        const parts = [];
        for (let j = 0; j < 16; j += 2) {
            parts.push(((raw[offset + j] << 8) | raw[offset + j + 1]).toString(16));
        }
        // 寻找最长的连续 '0' 序列进行压缩
        let bestStart = -1, bestLen = 0;
        let currentStart = -1, currentLen = 0;
        for (let j = 0; j < parts.length; j++) {
            if (parts[j] === '0') {
                if (currentStart === -1) currentStart = j;
                currentLen++;
            } else {
                if (currentLen > bestLen) {
                    bestStart = currentStart;
                    bestLen = currentLen;
                }
                currentStart = -1;
                currentLen = 0;
            }
        }
        if (currentLen > bestLen) {
            bestStart = currentStart;
            bestLen = currentLen;
        }
        
        if (bestLen > 1) {
            // 使用 '::' 替换最长的 '0' 序列
            const replacement = (bestStart === 0 || bestStart + bestLen === parts.length) ? ':' : '';
            parts.splice(bestStart, bestLen, replacement);
        }
        data = parts.join(':').replace(':::', '::');
    } else if (type === "CNAME" || type === "NS" || type === "PTR") {
      data = decodeName(raw, offset).name;
    } else if (type === "TXT") {
      // 正确处理包含多个字符串的 TXT 记录
      let txtOffset = offset;
      const txtParts = [];
      while (txtOffset < offset + rdLength) {
          const len = raw[txtOffset];
          txtParts.push(String.fromCharCode(...raw.slice(txtOffset + 1, txtOffset + 1 + len)));
          txtOffset += len + 1;
      }
      data = txtParts.join("");
    } else if (type === "HTTPS" || type === "SVCB") {
      // HTTPS/SVCB 格式: 优先级(2字节) + 目标域名(变长) + 参数(变长)
      const priority = (raw[offset] << 8) | raw[offset + 1];
      const { name: target } = decodeName(raw, offset + 2);
      data = `priority: ${priority}, target: ${target || "."}`;
      if (rdLength > 2) data += ` [params: ${rdLength - 2} bytes]`;
    } else {
      data = `[Raw: ${rdLength} bytes]`;
    }

    results.push({ name, type, data, ttl });
    offset += rdLength;
  }

  return results;
}

export interface DNSRecord {
  name?: string; // If omitted, uses pointer to original query
  type: string;
  value: string;
  ttl?: number;
}

function encodeRData(type: string, value: string): number[] {
  let data: number[] = [];
  if (type === 'A') {
    data = value.split('.').map(v => parseInt(v) || 0);
  } else if (type === 'AAAA') {
    const bytes = new Uint8Array(16).fill(0);
    if (value.includes('::')) {
      const [left, right] = value.split('::');
      const leftParts = left.split(':').filter(p => p);
      const rightParts = right.split(':').filter(p => p);
      
      let i = 0;
      for (const part of leftParts) {
        const v = parseInt(part, 16);
        bytes[i++] = (v >> 8) & 0xff;
        bytes[i++] = v & 0xff;
      }
      
      i = 16 - rightParts.length * 2;
      for (const part of rightParts) {
        const v = parseInt(part, 16);
        bytes[i++] = (v >> 8) & 0xff;
        bytes[i++] = v & 0xff;
      }
    } else {
      const parts = value.split(':');
      let i = 0;
      for (const part of parts) {
        const v = parseInt(part, 16);
        bytes[i++] = (v >> 8) & 0xff;
        bytes[i++] = v & 0xff;
      }
    }
    data = Array.from(bytes);
  } else if (type === 'CNAME') {
    const labels = value.split('.');
    for (const label of labels) {
      data.push(label.length);
      for (let i = 0; i < label.length; i++) data.push(label.charCodeAt(i));
    }
    data.push(0);
  } else if (type === 'TXT') {
    for (let i = 0; i < value.length; i += 255) {
      const chunk = value.substring(i, i + 255);
      data.push(chunk.length);
      for (let j = 0; j < chunk.length; j++) {
        data.push(chunk.charCodeAt(j));
      }
    }
  }
  return data;
}

export function buildResponseMulti(queryRaw: Uint8Array, records: DNSRecord[], rcode: number = 0): Uint8Array {
  try {
    if (!queryRaw || queryRaw.length < 12) {
      const err = new Uint8Array(12);
      err[2] = 0x81; err[3] = 0x82; // Server Failure
      return err;
    }

    const header = new Uint8Array(12);
    header.set(queryRaw.slice(0, 12));
    header[2] = (header[2] & 0x01) | 0x84; // QR=1, AA=1, 继承 RD
    header[3] = 0x80 | (rcode & 0x0F);    // RA=1, RCODE
    
    let qEnd = 12;
    const qCount = (queryRaw[4] << 8) | queryRaw[5];
    for (let i = 0; i < qCount; i++) {
      const { read } = decodeName(queryRaw, qEnd);
      if (read === 0 && qEnd < queryRaw.length) {
        qEnd++;
      } else {
        qEnd += read + 4;
      }
      if (qEnd > queryRaw.length) { qEnd = queryRaw.length; break; }
    }
    const questionSection = queryRaw.slice(12, qEnd);
    
    header[4] = (qCount >> 8) & 0xff; header[5] = qCount & 0xff;
    header[6] = (records.length >> 8) & 0xff; header[7] = records.length & 0xff; // ANCOUNT
    header[8] = 0; header[9] = 0; // NSCOUNT
    header[10] = 0; header[11] = 0; // ARCOUNT

    if (records.length === 0) {
      const res = new Uint8Array(12 + questionSection.length);
      res.set(header);
      res.set(questionSection, 12);
      return res;
    }

    const answerRRs: Uint8Array[] = [];
    let totalLength = 12 + questionSection.length;
    
    for (const record of records) {
      const { name, type, value, ttl = 60 } = record;
      
      let nameBytes: number[] = [];
      if (!name) {
        nameBytes = [0xc0, 0x0c]; // Pointer to the first question
      } else {
        const labels = name.split('.');
        for (const label of labels) {
          nameBytes.push(label.length);
          for (let i = 0; i < label.length; i++) nameBytes.push(label.charCodeAt(i));
        }
        nameBytes.push(0);
      }
      
      const data = encodeRData(type, value);
      const rdlength = data.length;
      
      const rr = new Uint8Array(nameBytes.length + 10 + rdlength);
      rr.set(nameBytes, 0);
      let offset = nameBytes.length;
      
      const tCode = DNS_TYPE_TO_CODE[type] || 1;
      rr[offset++] = (tCode >> 8); rr[offset++] = tCode & 0xff;
      rr[offset++] = 0; rr[offset++] = 1; // Class IN
      rr[offset++] = (ttl >> 24) & 0xff; rr[offset++] = (ttl >> 16) & 0xff;
      rr[offset++] = (ttl >> 8) & 0xff; rr[offset++] = ttl & 0xff;
      rr[offset++] = (rdlength >> 8) & 0xff; rr[offset++] = rdlength & 0xff;
      rr.set(data, offset);
      
      answerRRs.push(rr);
      totalLength += rr.length;
    }

    const res = new Uint8Array(totalLength);
    res.set(header, 0);
    res.set(questionSection, 12);
    
    let currentOffset = 12 + questionSection.length;
    for (const rr of answerRRs) {
      res.set(rr, currentOffset);
      currentOffset += rr.length;
    }
    
    return res;
  } catch (e) {
    console.error("Critical error in buildResponseMulti:", e);
    const fallback = new Uint8Array(12);
    fallback.set(queryRaw.slice(0, 12));
    fallback[2] |= 0x80; fallback[3] = (fallback[3] & 0xF0) | 0x02; // ServFail
    return fallback;
  }
}

export function buildResponse(queryRaw: Uint8Array, type: string, value: string, ttl: number = 60, rcode: number = 0): Uint8Array {
  try {
    if (!queryRaw || queryRaw.length < 12) {
      // 极端情况：包太短，返回一个最简错误包
      const err = new Uint8Array(12);
      err[2] = 0x81; err[3] = 0x82; // Server Failure
      return err;
    }

    // 准备 Header (12 字节)
    const header = new Uint8Array(12);
    header.set(queryRaw.slice(0, 12));
    header[2] = (header[2] & 0x01) | 0x84; // QR=1, AA=1, 继承 RD
    header[3] = 0x80 | (rcode & 0x0F);    // RA=1, RCODE
    
    // 提取 Question Section (紧跟 Header 之后)
    let qEnd = 12;
    const qCount = (queryRaw[4] << 8) | queryRaw[5];
    for (let i = 0; i < qCount; i++) {
      const { read } = decodeName(queryRaw, qEnd);
      if (read === 0 && qEnd < queryRaw.length) {
        qEnd++; // 安全步进
      } else {
        qEnd += read + 4;
      }
      if (qEnd > queryRaw.length) { qEnd = queryRaw.length; break; }
    }
    const questionSection = queryRaw.slice(12, qEnd);
    
    header[4] = (qCount >> 8) & 0xff; header[5] = qCount & 0xff; // 保持原始问题数
    header[6] = 0; header[7] = value ? 1 : 0; // ANCOUNT
    header[8] = 0; header[9] = 0;             // NSCOUNT
    header[10] = 0; header[11] = 0;           // ARCOUNT (丢弃额外的附加记录)

    if (!value) {
      const res = new Uint8Array(12 + questionSection.length);
      res.set(header);
      res.set(questionSection, 12);
      return res;
    }

    // 准备 Answer 内容
    const data = encodeRData(type, value);

    // 构建 Answer Resource Record (RR)
    // RR 结构: NAME(2) + TYPE(2) + CLASS(2) + TTL(4) + RDLENGTH(2) + RDATA(variable)
    const rdlength = data.length;
    // Answer Resource Record
    const answerRR = new Uint8Array(10 + 2 + rdlength);
    // NAME: 压缩指针，指向原始查询中的域名 (偏移量 12, 0x0c)
    answerRR[0] = 0xc0; answerRR[1] = 0x0c; // 压缩指针指向第一个问题
    const tCode = DNS_TYPE_TO_CODE[type] || 1;
    // TYPE: 记录类型 (A=1, AAAA=28, etc.)
    answerRR[2] = (tCode >> 8); answerRR[3] = tCode & 0xff;
    // CLASS: 记录类别 (通常为 1, IN for Internet)
    answerRR[4] = 0; answerRR[5] = 1; // Class IN
    // TTL: 生存时间 (秒)
    answerRR[6] = (ttl >> 24) & 0xff; answerRR[7] = (ttl >> 16) & 0xff;
    answerRR[8] = (ttl >> 8) & 0xff; answerRR[9] = ttl & 0xff;
    // RDLENGTH: RDATA 字段的长度
    answerRR[10] = (rdlength >> 8) & 0xff;
    answerRR[11] = rdlength & 0xff;
    // RDATA: 实际的记录数据 (IP地址, 域名, 文本等)
    answerRR.set(data, 12);

    // 组装最终的 DNS 响应包
    const res = new Uint8Array(12 + questionSection.length + answerRR.length);
    // 写入 Header
    res.set(header);
    // 写入 Question Section
    res.set(questionSection, 12);
    // 写入 Answer Section
    res.set(answerRR, 12 + questionSection.length);
    return res;
  } catch (e) {
    console.error("Critical error in buildResponse:", e);
    const fallback = new Uint8Array(12);
    fallback.set(queryRaw.slice(0, 12));
    fallback[2] |= 0x80; fallback[3] = (fallback[3] & 0xF0) | 0x02; // ServFail
    return fallback;
  }
}
