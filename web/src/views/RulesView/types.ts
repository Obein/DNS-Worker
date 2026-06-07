export interface Rule {
  id: number;
  type: "ALLOW" | "BLOCK" | "REDIRECT";
  pattern: string;
  v_a?: string;
  v_aaaa?: string;
  v_txt?: string;
  v_cname?: string;
}

export interface RulesViewProps {
  profileId: string;
  prefill?: {
    domain: string;
    type: "ALLOW" | "BLOCK" | "REDIRECT";
    recordType?: string;
  } | null;
  onPrefillUsed?: () => void;
}

export interface ProfileSettings {
  block_mode?: "NULL_IP" | "NXDOMAIN" | "NODATA" | "CUSTOM_IP";
  custom_block_ipv4?: string;
  custom_block_ipv6?: string;
}
