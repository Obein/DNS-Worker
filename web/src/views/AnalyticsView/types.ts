export interface AnalyticsData {
  summary: { action: string; count: number }[];
  trend: { timestamp: number; action: string; count: number }[];
  top_allowed: { domain: string; count: number }[];
  top_blocked: { domain: string; count: number }[];
  clients: { client_ip: string; geo_country: string; count: number }[];
  destinations: { country_code: string; country: string; count: number }[];
}

export type TimeRange = "10m" | "1h" | "24h" | "7d" | "30d" | "custom";
