/**
 * @file factory.ts
 * @description Factory and isolate-level client cache for Turso / libSQL D1Database adapter.
 */

import { Env } from '../../types';
import { TursoD1Database } from './database';

/**
 * Factory creating a new TursoD1Database instance.
 *
 * @param url - Turso database URL.
 * @param authToken - Turso authorization token.
 * @returns TursoD1Database instance.
 */
export function createTursoClient(url: string, authToken: string): TursoD1Database {
  return new TursoD1Database(url, authToken);
}

let cachedTursoClient: TursoD1Database | null = null;
let cachedTursoUrl: string | null = null;
let cachedTursoToken: string | null = null;

/**
 * Returns a cached isolate-level Turso database client matching current environment variables.
 *
 * @param env - Application environment.
 * @returns TursoD1Database client.
 */
export function getTursoDatabase(env: Env | Record<string, any>): TursoD1Database {
  const url = (env.TURSO_DATABASE_URL || env.TURSO_URL || '').trim();
  const token = (env.TURSO_AUTH_TOKEN || '').trim();

  if (!url || !token) {
    throw new Error('[Turso] Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN in environment.');
  }

  if (cachedTursoClient && cachedTursoUrl === url && cachedTursoToken === token) {
    return cachedTursoClient;
  }

  cachedTursoClient = createTursoClient(url, token);
  cachedTursoUrl = url;
  cachedTursoToken = token;
  return cachedTursoClient;
}
