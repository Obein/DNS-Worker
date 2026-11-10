import { D1Database } from "@cloudflare/workers-types";
import { ListProfileModel } from "./profile";
import { ListUserModel } from "./user";
import { ListSystemModel } from "./system";
import { ListMetadataModel } from "./metadata";
import { normalizeListUrl } from "./utils";
import type {
  List,
  UserList,
  DistributeListResult,
  DistributedSystemListItem,
  RevokeSystemListResult,
  GlobalListMetadataRecord,
  ToggleProfileListResult,
  AddListResult,
  BulkListItem,
} from "./types";

export * from "./types";
export * from "./utils";
export * from "./profile";
export * from "./user";
export * from "./system";
export * from "./metadata";

/**
 * Unified ListModel Facade.
 *
 * Single Responsibility: Assembles and delegates to specialized sub-models:
 * - ListProfileModel: Profile-scoped lists & overrides management
 * - ListUserModel: User-scoped list subscriptions & CRUD
 * - ListSystemModel: Administrative system-wide list distribution & revocation
 * - ListMetadataModel: Centralized global list metadata & sync queries
 *
 * Provides 100% backward compatibility for all existing callers.
 */
export class ListModel {
  public readonly profile: ListProfileModel;
  public readonly user: ListUserModel;
  public readonly system: ListSystemModel;
  public readonly metadata: ListMetadataModel;

  /**
   * Normalizes a blocklist URL for canonical indexing.
   */
  static normalizeUrl(url: string): string {
    return normalizeListUrl(url);
  }

  constructor(private readonly db: D1Database) {
    this.user = new ListUserModel(db);
    this.profile = new ListProfileModel(db);
    this.system = new ListSystemModel(db, this.user);
    this.metadata = new ListMetadataModel(db);
  }

  // --- Profile Lists Delegation ---

  /**
   * Retrieves all effective lists for a given profile.
   */
  async getLists(profileId: string): Promise<List[]> {
    return this.profile.getLists(profileId);
  }

  /**
   * Adds a profile-level list.
   */
  async addList(profileId: string, url: string, isSystem = false): Promise<AddListResult> {
    return this.profile.addList(profileId, url, isSystem);
  }

  /**
   * Fetches a list belonging to a profile by URL, or null when absent.
   */
  async getListByUrl(url: string, profileId: string): Promise<List | null> {
    return this.profile.getListByUrl(url, profileId);
  }

  /**
   * Batch inserts multiple filter list URLs for a profile.
   */
  async addListsBulk(profileId: string, items: BulkListItem[]): Promise<number> {
    return this.profile.addListsBulk(profileId, items);
  }

  /**
   * Enables or disables a list for a profile.
   */
  async setEnabled(id: number, profileId: string, enabled: boolean): Promise<boolean> {
    return this.profile.setEnabled(id, profileId, enabled);
  }

  /**
   * Toggles a list's enabled state for a specific profile (and matching user/system overrides).
   */
  async toggleProfileList(profileId: string, id: number, enabled: boolean): Promise<ToggleProfileListResult> {
    return this.profile.toggleProfileList(profileId, id, enabled);
  }

  /**
   * Fetches a single list by ID for a profile.
   */
  async getListById(id: number, profileId: string): Promise<List | null> {
    return this.profile.getListById(id, profileId);
  }

  /**
   * Deletes a profile-level filter list.
   */
  async deleteList(id: number, profileId: string): Promise<boolean> {
    return this.profile.deleteList(id, profileId);
  }

  /**
   * Updates list sync status for a profile list.
   */
  async updateListSyncStatus(
    id: number,
    now: number | null,
    enabled?: number | null,
    syncError: string | null = null,
    etag?: string | null,
    lastModified?: number | string | null
  ): Promise<boolean> {
    return this.profile.updateListSyncStatus(id, now, enabled, syncError, etag, lastModified);
  }

  /**
   * Resets sync status timestamps for all lists of a profile.
   */
  async resetListSyncStatus(profileId: string): Promise<boolean> {
    return this.profile.resetListSyncStatus(profileId);
  }

  // --- User Lists Delegation ---

  /**
   * Retrieves all user-level and system-level lists for a user.
   */
  async getUserLists(userId: string): Promise<UserList[]> {
    return this.user.getUserLists(userId);
  }

  /**
   * Adds a new user-level list.
   */
  async addUserList(userId: string, url: string, isSystem = false): Promise<AddListResult> {
    return this.user.addUserList(userId, url, isSystem);
  }

  /**
   * Fetches a user list by URL.
   */
  async getUserListByUrl(url: string, userId: string): Promise<UserList | null> {
    return this.user.getUserListByUrl(url, userId);
  }

  /**
   * Fetches a user list by ID.
   */
  async getUserListById(id: number, userId: string): Promise<UserList | null> {
    return this.user.getUserListById(id, userId);
  }

  /**
   * Deletes a user-created filter list.
   */
  async deleteUserList(id: number, userId: string): Promise<boolean> {
    return this.user.deleteUserList(id, userId);
  }

  /**
   * Toggles the enabled status of a user-level list.
   */
  async toggleUserList(id: number, userId: string, enabled: boolean): Promise<boolean> {
    return this.user.toggleUserList(id, userId, enabled);
  }

  /**
   * Checks if a user already has a list URL in user_lists.
   */
  async hasListForUser(userId: string, url: string): Promise<boolean> {
    return this.user.hasListForUser(userId, url);
  }

  // --- System Distribution Delegation ---

  /**
   * Distributes a system-level filter list to all users in the system.
   */
  async distributeListToAllUsers(url: string): Promise<DistributeListResult> {
    return this.system.distributeListToAllUsers(url);
  }

  /**
   * Returns all filter list URLs currently active with is_system = 1 in user_lists.
   */
  async getDistributedSystemLists(): Promise<DistributedSystemListItem[]> {
    return this.system.getDistributedSystemLists();
  }

  /**
   * Revokes a system-distributed filter list across all users.
   */
  async revokeSystemList(url: string): Promise<RevokeSystemListResult> {
    return this.system.revokeSystemList(url);
  }

  // --- Global Metadata Delegation ---

  /**
   * Retrieves global metadata for a given canonical blocklist URL.
   */
  async getGlobalListMetadata(url: string): Promise<GlobalListMetadataRecord | null> {
    return this.metadata.getGlobalListMetadata(url);
  }

  /**
   * Upserts global metadata for a canonical blocklist URL.
   */
  async updateGlobalListMetadata(
    url: string,
    now: number,
    etag?: string | null,
    lastModified?: number | string | null,
    syncError: string | null = null
  ): Promise<boolean> {
    return this.metadata.updateGlobalListMetadata(url, now, etag, lastModified, syncError);
  }

  /**
   * Returns distinct active URLs that need synchronization.
   */
  async getDistinctActiveUrls(cutoffTime?: number, limit = 10): Promise<string[]> {
    return this.metadata.getDistinctActiveUrls(cutoffTime, limit);
  }

  /**
   * Retrieves all profile IDs subscribing to a list URL.
   */
  async getProfilesSubscribingToUrl(url: string): Promise<string[]> {
    return this.metadata.getProfilesSubscribingToUrl(url);
  }
}
