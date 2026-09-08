export { DNS_TYPES, DNS_TYPE_TO_CODE } from "./dns/constants";
export {
  decodeName,
  getQTypeName,
  parseDNSQuery,
  parseDNSQueryFromRaw,
  parseDNSAnswer
} from "./dns/decoder";
export {
  buildDNSQuery,
  buildResponse,
  buildResponseMulti
} from "./dns/encoder";
export { encodeRData } from "./dns/rdata";
export { injectEcsIntoQuery } from "./dns/injectEcs";
export type { DNSRecord } from "./dns/encoder";
