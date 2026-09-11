import { D1Database } from "@cloudflare/workers-types";
import { Passkey } from "../types";
import { generateId } from "../lib/auth";

export class PasskeyModel {
  constructor(private db: D1Database) {}

  /**
   * Lists all passkeys registered for a user, ordered by creation date descending.
   */
  async listByUser(userId: string): Promise<Passkey[]> {
    const { results } = await this.db.prepare(
      "SELECT * FROM passkeys WHERE user_id = ? ORDER BY created_at DESC"
    ).bind(userId).all<Passkey>();
    return results;
  }

  /**
   * Gets a specific passkey by its internal ID and user ID.
   */
  async getById(id: string, userId: string): Promise<Passkey | null> {
    return await this.db.prepare(
      "SELECT * FROM passkeys WHERE id = ? AND user_id = ?"
    ).bind(id, userId).first<Passkey>();
  }

  /**
   * Finds a passkey by its WebAuthn credential ID across all users.
   */
  async getByCredentialId(credentialId: string): Promise<Passkey | null> {
    return await this.db.prepare(
      "SELECT * FROM passkeys WHERE credential_id = ?"
    ).bind(credentialId).first<Passkey>();
  }

  /**
   * Registers a new passkey credential.
   */
  async create(data: {
    userId: string;
    name: string;
    credentialId: string;
    publicKey: string;
    algorithm: number;
    signCount: number;
    transports?: string[] | null;
    aaguid?: string | null;
  }): Promise<Passkey> {
    const id = generateId(12);
    const now = Math.floor(Date.now() / 1000);
    const transportsJson = data.transports ? JSON.stringify(data.transports) : null;

    await this.db.prepare(
      `INSERT INTO passkeys (id, user_id, name, credential_id, public_key, algorithm, sign_count, transports, aaguid, created_at, last_used_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id,
      data.userId,
      data.name,
      data.credentialId,
      data.publicKey,
      data.algorithm,
      data.signCount,
      transportsJson,
      data.aaguid || null,
      now,
      null
    ).run();

    return {
      id,
      user_id: data.userId,
      name: data.name,
      credential_id: data.credentialId,
      public_key: data.publicKey,
      algorithm: data.algorithm,
      sign_count: data.signCount,
      transports: transportsJson,
      aaguid: data.aaguid || null,
      created_at: now,
      last_used_at: null
    };
  }

  /**
   * Updates the friendly label/name of a passkey.
   */
  async updateName(id: string, userId: string, name: string): Promise<boolean> {
    const res = await this.db.prepare(
      "UPDATE passkeys SET name = ? WHERE id = ? AND user_id = ?"
    ).bind(name, id, userId).run();
    return res.success;
  }

  /**
   * Updates the sign counter and last used timestamp after successful authentication.
   */
  async updateUsage(id: string, signCount: number): Promise<boolean> {
    const now = Math.floor(Date.now() / 1000);
    const res = await this.db.prepare(
      "UPDATE passkeys SET sign_count = ?, last_used_at = ? WHERE id = ?"
    ).bind(signCount, now, id).run();
    return res.success;
  }

  /**
   * Deletes a passkey by ID.
   */
  async delete(id: string, userId: string): Promise<boolean> {
    const res = await this.db.prepare(
      "DELETE FROM passkeys WHERE id = ? AND user_id = ?"
    ).bind(id, userId).run();
    return res.success;
  }

  /**
   * Returns the count of passkeys registered by a user.
   */
  async countByUser(userId: string): Promise<number> {
    const res = await this.db.prepare(
      "SELECT COUNT(*) as count FROM passkeys WHERE user_id = ?"
    ).bind(userId).first<{ count: number }>();
    return res?.count || 0;
  }
}
