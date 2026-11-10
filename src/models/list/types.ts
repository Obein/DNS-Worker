import { List, UserList } from "../../types";

export type { List, UserList };

/**
 * Result of distributing a list to all users in the system.
 */
export interface DistributeListResult {
  canonicalUrl: string;
  totalUsers: number;
  addedCount: number;
  skippedCount: number;
  failedCount: number;
  addedUsernames: string[];
  skippedUsernames: string[];
  failedUsernames: string[];
  affectedProfileIds: string[];
}

/**
 * Details of a distributed system-level filter list.
 */
export interface DistributedSystemListItem {
  url: string;
  profileCount: number;
  userCount: number;
  usernames: string[];
}

/**
 * Result of revoking a distributed system filter list across all users.
 */
export interface RevokeSystemListResult {
  canonicalUrl: string;
  revokedCount: number;
  revokedProfilesCount: number;
  affectedProfilesCount: number;
  affectedUserCount: number;
  affectedProfileIds: string[];
  affectedUsernames: string[];
}

/**
 * Metadata record for a canonical blocklist URL in global_list_metadata.
 */
export interface GlobalListMetadataRecord {
  url: string;
  etag: string | null;
  last_modified: number | null;
  last_synced_at: number | null;
  sync_error: string | null;
}

/**
 * Result of toggling a profile list (and synchronized user/system list overrides).
 */
export interface ToggleProfileListResult {
  success: boolean;
  affectedUrl?: string;
}

/**
 * Result of adding a list.
 */
export interface AddListResult {
  success: boolean;
  id?: number;
}

/**
 * Parameter item for bulk list additions.
 */
export type BulkListItem = string | { url: string; enabled?: number | boolean };
