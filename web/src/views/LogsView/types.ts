import { OverlayToaster } from "@blueprintjs/core";

export interface LogEntry {
  id: number;
  timestamp: number;
  domain: string;
  record_type: string;
  action: "PASS" | "BLOCK" | "REDIRECT" | "FAIL";
  reason?: string;
  client_ip: string;
  geo_country?: string;
  answer?: string;
  dest_geoip?: string; // JSON string
  ecs?: string;
  profile_name?: string;
  access_point_id?: string;
  access_point_name?: string;
  upstream?: string;
  latency?: number;
}

export interface LogsViewProps {
  profileId: string;
  onQuickAction?: (
    domain: string,
    type: "ALLOW" | "BLOCK" | "REDIRECT",
    recordType?: string
  ) => void;
  toasterRef?: React.RefObject<OverlayToaster | null>;
}

export type TimeRange = "10m" | "1h" | "24h" | "7d" | "30d" | "custom";
