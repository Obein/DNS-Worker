import { D1Database, ExecutionContext as CFExecutionContext } from "@cloudflare/workers-types";
import { SystemSecretsModel } from "./models/systemSecrets";

export interface Env {
  DB: D1Database;
  ASSETS: any;
  MAX_ACCESS_POINTS_PER_PROFILE?: string | number;
  MAX_PROFILES_PER_USER?: string | number;
  DEFAULT_SESSION_EXPIRATION_MINUTES?: string | number;
  OPTIONAL_SESSION_EXPIRATION_DAYS?: string | number;
  ACCESS_TOKEN_EXPIRATION_MINUTES?: string | number;
  SESSION_GEO_DISTANCE_KM?: string | number;
  PREAUTH_TTL_SECONDS?: string | number;
  BLOOM_MEM_TTL?: string | number;
  SYNC_TIMEOUT_MS?: string | number;
  INACTIVITY_THRESHOLD_DAYS?: string | number;
  PRESET_UPSTREAMS?: string;
  PRESET_EXTERNAL_FILTERS?: string;
  BLOOM_FALSE_POSITIVE_RATE?: string | number;
  THROTTLE_ACTIVE_SEC?: string | number;
  SYNC_PROFILE_INTERVAL_SEC?: string | number;
  TURNSTILE_SECRET_KEY?: string;
  [key: string]: any;
}

export interface User {
  id: string;
  username: string;
  role: 'admin' | 'user';
  hashed_password?: string;
  totp_enabled?: number;       // 0 | 1
  totp_skip_password?: number; // 0 | 1 — when 1, login skips password check
  created_at?: number;
  last_active_at?: number;
  last_resolve_at?: number;
  timezone?: string | null;
  locale?: string | null;
  password_version?: number;
  pin_hash?: string | null;
  isPaused?: boolean;
  sessionId?: string;
  session_lock_timeout?: number;
}

export interface UserActivityLog {
  id: number;
  user_id: string;
  action: string;
  ip_address: string | null;
  user_agent: string | null;
  timestamp: number;
  extra: string | null;
}

export interface ProfileSettings {
  upstream: string[];
  ecs: {
    enabled: boolean;
    use_client_ip: boolean;
    ipv4_cidr?: string;
    ipv6_cidr?: string;
  };
  log_retention_days: number;
  default_policy: 'ALLOW' | 'BLOCK';
  block_mode?: 'NULL_IP' | 'NXDOMAIN' | 'NODATA' | 'CUSTOM_IP';
  custom_block_ipv4?: string;
  custom_block_ipv6?: string;
}

export interface Profile {
  id: string;
  profile_key?: string;
  owner_id: string;
  name: string;
  settings: string;
  created_at: number;
  updated_at: number;
  list_bloom?: string;
  list_updated_at?: number;
}

export interface Rule {
  id: number;
  profile_id: string;
  type: 'ALLOW' | 'BLOCK' | 'REDIRECT';
  pattern: string;
  v_a?: string;
  v_aaaa?: string;
  v_txt?: string;
  v_cname?: string;
}

export interface List {
  id: number;
  profile_id: string;
  url: string;
  enabled: boolean;
  last_synced_at?: number;
  sync_error?: string | null;
}

export interface DNSQuery {
  name: string;
  type: string;
  raw: Uint8Array;
}

export interface ResolutionResult {
  answer: Uint8Array;
  ttl: number;
  action: 'PASS' | 'BLOCK' | 'REDIRECT' | 'FAIL';
  reason?: string;
  latency?: number;
  timings?: Record<string, number>;
  diagnostics?: {
    upstream_url: string;
    method: string;
    status: number;
  };
}

export interface ResolutionLog {
  id?: number;
  profile_id: string;
  access_point_id?: string;
  timestamp: number;
  client_ip: string;
  geo_country: string;
  domain: string;
  record_type: string;
  action: string;
  reason?: string;
  answer?: string;
  dest_geoip?: string;
  latency?: number;
  ecs?: string;
  upstream?: string;
}

export interface ExecutionContext extends CFExecutionContext {}

export interface Context {
  profileId: string;
  accessPointId?: string;
  accessPointName?: string;
  startTime: number;
  env: Env;
  ctx: ExecutionContext;
}

export interface AccessPoint {
  id: string;
  profile_id: string;
  name: string;
  token: string;
  created_at: number;
  updated_at: number;
}
