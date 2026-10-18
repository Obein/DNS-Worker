/**
 * @file config.ts
 * @description Turso / libSQL URL normalization, masking, and database service detection.
 */

import { Env } from '../../types';

/**
 * Supported database service engine types.
 */
export type DatabaseServiceType = 'D1' | 'Turso' | 'File';

/**
 * Normalizes a Turso / libSQL connection URL to standard HTTPS endpoint.
 *
 * @param rawUrl - Input database URL (e.g., libsql://db-org.turso.io).
 * @returns Normalized HTTPS URL string.
 */
export function normalizeTursoUrl(rawUrl: string): string {
  let url = rawUrl.trim();
  if (url.startsWith('libsql://')) {
    url = 'https://' + url.slice('libsql://'.length);
  } else if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'https://' + url;
  }
  return url.replace(/\/+$/, '');
}

/**
 * Safely masks a database URL for user-facing logs and diagnostics.
 *
 * @param rawUrl - Database URL to mask.
 * @returns Masked URL.
 */
export function maskDatabaseUrl(rawUrl: string): string {
  try {
    const normalized = normalizeTursoUrl(rawUrl);
    const u = new URL(normalized);
    return `${u.protocol}//${u.host}`;
  } catch {
    return rawUrl.slice(0, 16) + '...';
  }
}

/**
 * Checks whether Turso database is configured in the given environment.
 *
 * @param env - Application environment bindings or process.env.
 * @returns True if Turso database URL and auth token are present.
 */
export function isTursoConfigured(env?: Partial<Env> | NodeJS.ProcessEnv | null): boolean {
  if (!env) return false;
  const url = (env.TURSO_DATABASE_URL || (env as any).TURSO_URL)?.trim();
  const token = env.TURSO_AUTH_TOKEN?.trim();
  return Boolean(url && token);
}

/**
 * Resolves the active database service type ('D1' | 'Turso' | 'File') based on environment variables.
 * - Serverless mode (Cloudflare Workers) defaults to 'D1'.
 * - Serverfull mode (Node.js/Bun/Docker) defaults to 'File'.
 * - Explicit DATABASE_SERVICE ('D1', 'Turso', 'File', case-insensitive) takes highest precedence.
 * - If DATABASE_SERVICE is omitted but Turso credentials are fully configured, automatically resolves to 'Turso'.
 *
 * @param env - Application environment bindings or process.env.
 * @param isServerfull - True if running in Serverfull mode.
 * @returns Resolved DatabaseServiceType ('D1' | 'Turso' | 'File').
 */
export function getDatabaseService(
  env?: Partial<Env> | NodeJS.ProcessEnv | null,
  isServerfull = false
): DatabaseServiceType {
  const raw = (env?.DATABASE_SERVICE || (env as any)?.DB_SERVICE)?.trim().toLowerCase();
  if (raw === 'turso') return 'Turso';
  if (raw === 'd1') return 'D1';
  if (raw === 'file') return 'File';

  // If DATABASE_SERVICE is not explicitly set, but Turso credentials are fully provided, auto-enable Turso
  if (isTursoConfigured(env)) {
    return 'Turso';
  }

  // Standard platform defaults: D1 for Serverless, File for Serverfull
  return isServerfull ? 'File' : 'D1';
}
