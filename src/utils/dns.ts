export { DNS_TYPES, DNS_TYPE_TO_CODE } from "./dns/constants";
export {
  decodeName,
  getQTypeName,
  parseDNSQuery,
  parseDNSAnswer
} from "./dns/decoder";
export {
  buildDNSQuery,
  buildResponse,
  buildResponseMulti
} from "./dns/encoder";
export { encodeRData } from "./dns/rdata";
export type { DNSRecord } from "./dns/encoder";
