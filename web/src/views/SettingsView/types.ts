import { OverlayToaster } from "@blueprintjs/core";
import React from "react";

export interface ProfileSettings {
  upstream: string[]; // DoH URLs or Classic DNS
  ecs: {
    enabled: boolean;
    use_client_ip: boolean;
    ipv4_cidr?: string;
    ipv6_cidr?: string;
  };
  log_retention_days: number;
  default_policy: "ALLOW" | "BLOCK";
  block_mode?: "NULL_IP" | "NXDOMAIN" | "NODATA" | "CUSTOM_IP";
  custom_block_ipv4?: string;
  custom_block_ipv6?: string;
}

export interface Profile {
  id: string; // 6-char ID
  profile_key?: string;
  owner_id: string;
  name: string;
  settings: string; // JSON string of ProfileSettings
  created_at: number;
  updated_at: number;
}

export interface SettingsViewProps {
  profileId: string;
  toasterRef?: React.RefObject<OverlayToaster | null>;
}

export interface ResolutionResult {
  answer: any;
  ttl: number;
  action: "PASS" | "BLOCK" | "REDIRECT" | "FAIL";
  reason?: string;
  latency?: number;
  timings?: Record<string, number>;
  diagnostics?: {
    upstream_url: string;
    method: string;
    status: number;
    response_text?: string;
    sent_dns_param?: string;
  };
}

export interface TestResponse extends ResolutionResult {
  client_ip: string;
  geo_country: string;
  answers: { type: string; data: string; ttl: number }[];
}
