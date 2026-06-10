import { DNS_TYPE_TO_CODE } from "./constants";
import { decodeName } from "./decoder";
import { encodeRData } from "./rdata";

/**
 * Structured details of a DNS record.
 */
export interface DNSRecord {
  /** The owner domain name. If omitted, points to the original query name using compression pointers. */
  name?: string;
  /** The record type, e.g. "A", "AAAA", "CNAME", "TXT". */
  type: string;
  /** The value/payload of the record. */
  value: string;
  /** Time-To-Live in seconds. */
  ttl?: number;
}

/**
 * Builds a raw DNS query packet from a domain name and record type string.
 *
 * @param name - The domain name to query.
 * @param type - The record type string.
 * @returns A Uint8Array representing the raw DNS query packet.
 */
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
  const question: number[] = [];
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
  raw.set(new Uint8Array(question), header.length);
  return raw;
}

/**
 * Builds a raw DNS response packet containing multiple answer resource records.
 *
 * @param queryRaw - The raw incoming DNS query packet buffer.
 * @param records - The array of DNS records to include in the answers section.
 * @param rcode - The response error code (defaults to 0, i.e. NOERROR).
 * @returns A Uint8Array containing the compiled DNS response packet.
 */
export function buildResponseMulti(
  queryRaw: Uint8Array,
  records: DNSRecord[],
  rcode: number = 0
): Uint8Array {
  try {
    if (!queryRaw || queryRaw.length < 12) {
      const err = new Uint8Array(12);
      err[2] = 0x81;
      err[3] = 0x82; // Server Failure
      return err;
    }

    const header = new Uint8Array(12);
    header.set(queryRaw.slice(0, 12));
    header[2] = (header[2] & 0x01) | 0x84; // QR=1, AA=1, inherit RD
    header[3] = 0x80 | (rcode & 0x0f); // RA=1, RCODE

    let qEnd = 12;
    const qCount = (queryRaw[4] << 8) | queryRaw[5];
    for (let i = 0; i < qCount; i++) {
      const { read } = decodeName(queryRaw, qEnd);
      if (read === 0 && qEnd < queryRaw.length) {
        qEnd++;
      } else {
        qEnd += read + 4;
      }
      if (qEnd > queryRaw.length) {
        qEnd = queryRaw.length;
        break;
      }
    }
    const questionSection = queryRaw.slice(12, qEnd);

    header[4] = (qCount >> 8) & 0xff;
    header[5] = qCount & 0xff;
    header[6] = (records.length >> 8) & 0xff;
    header[7] = records.length & 0xff; // ANCOUNT
    header[8] = 0;
    header[9] = 0; // NSCOUNT
    header[10] = 0;
    header[11] = 0; // ARCOUNT

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
        const labels = name.split(".");
        for (const label of labels) {
          nameBytes.push(label.length);
          for (let i = 0; i < label.length; i++)
            nameBytes.push(label.charCodeAt(i));
        }
        nameBytes.push(0);
      }

      const data = encodeRData(type, value);
      const rdlength = data.length;

      const rr = new Uint8Array(nameBytes.length + 10 + rdlength);
      rr.set(nameBytes, 0);
      let offset = nameBytes.length;

      const tCode = DNS_TYPE_TO_CODE[type] || 1;
      rr[offset++] = tCode >> 8;
      rr[offset++] = tCode & 0xff;
      rr[offset++] = 0;
      rr[offset++] = 1; // Class IN
      rr[offset++] = (ttl >> 24) & 0xff;
      rr[offset++] = (ttl >> 16) & 0xff;
      rr[offset++] = (ttl >> 8) & 0xff;
      rr[offset++] = ttl & 0xff;
      rr[offset++] = (rdlength >> 8) & 0xff;
      rr[offset++] = rdlength & 0xff;
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
    fallback[2] |= 0x80;
    fallback[3] = (fallback[3] & 0xf0) | 0x02; // ServFail
    return fallback;
  }
}

/**
 * Builds a raw DNS response packet containing a single answer resource record.
 *
 * @param queryRaw - The raw incoming DNS query packet buffer.
 * @param type - The record type.
 * @param value - The record payload value.
 * @param ttl - Time-To-Live in seconds (defaults to 60).
 * @param rcode - The response error code (defaults to 0).
 * @returns A Uint8Array containing the compiled DNS response packet.
 */
export function buildResponse(
  queryRaw: Uint8Array,
  type: string,
  value: string,
  ttl: number = 60,
  rcode: number = 0
): Uint8Array {
  try {
    if (!queryRaw || queryRaw.length < 12) {
      const err = new Uint8Array(12);
      err[2] = 0x81;
      err[3] = 0x82; // Server Failure
      return err;
    }

    const header = new Uint8Array(12);
    header.set(queryRaw.slice(0, 12));
    header[2] = (header[2] & 0x01) | 0x84; // QR=1, AA=1, inherit RD
    header[3] = 0x80 | (rcode & 0x0f); // RA=1, RCODE

    let qEnd = 12;
    const qCount = (queryRaw[4] << 8) | queryRaw[5];
    for (let i = 0; i < qCount; i++) {
      const { read } = decodeName(queryRaw, qEnd);
      if (read === 0 && qEnd < queryRaw.length) {
        qEnd++;
      } else {
        qEnd += read + 4;
      }
      if (qEnd > queryRaw.length) {
        qEnd = queryRaw.length;
        break;
      }
    }
    const questionSection = queryRaw.slice(12, qEnd);

    header[4] = (qCount >> 8) & 0xff;
    header[5] = qCount & 0xff;
    header[6] = 0;
    header[7] = value ? 1 : 0; // ANCOUNT
    header[8] = 0;
    header[9] = 0; // NSCOUNT
    header[10] = 0;
    header[11] = 0; // ARCOUNT

    if (!value) {
      const res = new Uint8Array(12 + questionSection.length);
      res.set(header);
      res.set(questionSection, 12);
      return res;
    }

    const data = encodeRData(type, value);
    const rdlength = data.length;

    const answerRR = new Uint8Array(12 + rdlength);
    answerRR[0] = 0xc0;
    answerRR[1] = 0x0c; // Pointer to original query name
    const tCode = DNS_TYPE_TO_CODE[type] || 1;
    answerRR[2] = tCode >> 8;
    answerRR[3] = tCode & 0xff;
    answerRR[4] = 0;
    answerRR[5] = 1; // Class IN
    answerRR[6] = (ttl >> 24) & 0xff;
    answerRR[7] = (ttl >> 16) & 0xff;
    answerRR[8] = (ttl >> 8) & 0xff;
    answerRR[9] = ttl & 0xff;
    answerRR[10] = (rdlength >> 8) & 0xff;
    answerRR[11] = rdlength & 0xff;
    answerRR.set(data, 12);

    const res = new Uint8Array(
      12 + questionSection.length + answerRR.length
    );
    res.set(header);
    res.set(questionSection, 12);
    res.set(answerRR, 12 + questionSection.length);
    return res;
  } catch (e) {
    console.error("Critical error in buildResponse:", e);
    const fallback = new Uint8Array(12);
    fallback.set(queryRaw.slice(0, 12));
    fallback[2] |= 0x80;
    fallback[3] = (fallback[3] & 0xf0) | 0x02; // ServFail
    return fallback;
  }
}
