/**
 * Dictionary mapping DNS record type codes to their uppercase string representations.
 */
export const DNS_TYPES: Record<number, string> = {
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

/**
 * Dictionary mapping DNS record type strings to their numeric codes.
 */
export const DNS_TYPE_TO_CODE: Record<string, number> = Object.fromEntries(
  Object.entries(DNS_TYPES).map(([code, name]) => [name, Number(code)])
);
