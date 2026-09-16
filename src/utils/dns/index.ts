export { DNS_TYPES, DNS_TYPE_TO_CODE } from "./constants";
export {
  decodeName,
  getQTypeName,
  parseDNSQuery,
  parseDNSQueryFromRaw,
  parseDNSAnswer
} from "./decoder";
export {
  buildDNSQuery,
  buildResponse,
  buildResponseMulti
} from "./encoder";
export { encodeRData } from "./rdata";
export { injectEcsIntoQuery } from "./injectEcs";
export type { DNSRecord } from "./encoder";
