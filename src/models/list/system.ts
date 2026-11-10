import { D1Database } from "@cloudflare/workers-types";
import { DistributeListResult, DistributedSystemListItem, RevokeSystemListResult } from "./types";
import { normalizeListUrl } from "./utils";
import { ListUserModel } from "./user";

/**
 * ListSystemModel handles administrative system-level filter lists:
 * distribution to all system users, inventory inspection, and global revocation.
 */
export class ListSystemModel {
  constructor(
    private readonly db: D1Database,
    private readonly userModel: ListUserModel
  ) {}

  /**
   * Distributes a system-level filter list to all users in the system as a user-level list with is_system = 1.
   * If a user already has this list URL in user_lists, they are skipped.
   * Users with 0 profiles are also successfully added so future profiles inherit it.
   *
   * @param url - Filter list URL to distribute.
   * @returns Detailed distribution summary.
   */
  async distributeListToAllUsers(url: string): Promise<DistributeListResult> {
    const canonicalUrl = normalizeListUrl(url);
    const now = Math.floor(Date.now() / 1000);
    const { results: users } = await this.db
      .prepare("SELECT id, username FROM users ORDER BY created_at ASC")
      .all<{ id: string; username: string }>();

    let addedCount = 0;
    let skippedCount = 0;
    const addedUsernames: string[] = [];
    const skippedUsernames: string[] = [];
    const affectedProfileIds: string[] = [];

    for (const user of users || []) {
      const alreadyHas = await this.userModel.hasListForUser(user.id, canonicalUrl);
      if (alreadyHas) {
        skippedCount++;
        skippedUsernames.push(user.username);
        continue;
      }

      await this.db
        .prepare(
          `INSERT INTO user_lists (user_id, url, is_system, enabled, created_at)
           VALUES (?, ?, 1, 1, ?)`
        )
        .bind(user.id, canonicalUrl, now)
        .run();

      const { results: profiles } = await this.db
        .prepare("SELECT id FROM profiles WHERE owner_id = ?")
        .bind(user.id)
        .all<{ id: string }>();

      for (const profile of profiles || []) {
        affectedProfileIds.push(profile.id);
      }

      addedCount++;
      addedUsernames.push(user.username);
    }

    return {
      canonicalUrl,
      totalUsers: (users || []).length,
      addedCount,
      skippedCount,
      failedCount: 0,
      addedUsernames,
      skippedUsernames,
      failedUsernames: [],
      affectedProfileIds,
    };
  }

  /**
   * Returns all filter list URLs currently active with is_system = 1 in user_lists,
   * along with the counts of affected profiles and users.
   *
   * @returns Array of distributed system list details.
   */
  async getDistributedSystemLists(): Promise<DistributedSystemListItem[]> {
    const { results } = await this.db
      .prepare(
        `SELECT 
          ul.url,
          COUNT(DISTINCT p.id) AS profile_count,
          COUNT(DISTINCT ul.user_id) AS user_count,
          GROUP_CONCAT(DISTINCT u.username) AS usernames
        FROM user_lists ul
        JOIN users u ON ul.user_id = u.id
        LEFT JOIN profiles p ON p.owner_id = ul.user_id
        WHERE ul.is_system = 1
        GROUP BY ul.url
        ORDER BY ul.url ASC`
      )
      .all<{
        url: string;
        profile_count: number;
        user_count: number;
        usernames: string | null;
      }>();

    return (results || []).map((row) => ({
      url: row.url,
      profileCount: Number(row.profile_count) || 0,
      userCount: Number(row.user_count) || 0,
      usernames: row.usernames ? row.usernames.split(",").filter(Boolean) : [],
    }));
  }

  /**
   * Revokes a system-distributed filter list across all users where is_system = 1.
   * Does NOT touch lists where is_system = 0 (user-created lists).
   *
   * @param url - Filter list URL to revoke.
   * @returns Revocation summary.
   */
  async revokeSystemList(url: string): Promise<RevokeSystemListResult> {
    const canonicalUrl = normalizeListUrl(url);

    // 1. Identify all profiles and users where this list has is_system = 1
    const { results } = await this.db
      .prepare(
        `SELECT DISTINCT p.id AS profile_id, u.username
        FROM user_lists ul
        JOIN users u ON ul.user_id = u.id
        LEFT JOIN profiles p ON p.owner_id = ul.user_id
        WHERE ul.url = ? AND ul.is_system = 1`
      )
      .bind(canonicalUrl)
      .all<{ profile_id: string | null; username: string }>();

    const affectedProfileIds = Array.from(
      new Set(
        (results || [])
          .map((r) => r.profile_id)
          .filter((id): id is string => Boolean(id))
      )
    );
    const affectedUsernames = Array.from(new Set((results || []).map((r) => r.username)));

    // 2. Delete the system-distributed list records (strictly where is_system = 1)
    const deleteResult = await this.db
      .prepare("DELETE FROM user_lists WHERE url = ? AND is_system = 1")
      .bind(canonicalUrl)
      .run();

    return {
      canonicalUrl,
      revokedCount: deleteResult.meta?.changes || affectedUsernames.length,
      revokedProfilesCount: affectedProfileIds.length,
      affectedProfilesCount: affectedProfileIds.length,
      affectedUserCount: affectedUsernames.length,
      affectedProfileIds,
      affectedUsernames,
    };
  }
}
