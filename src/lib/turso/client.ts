/**
 * @file client.ts
 * @description Cloudflare Workers D1Database compatible client for Turso / libSQL over HTTP (Hrana v2).
 * Decomposed into specialized SRP modules: `./statement`, `./database`, and `./factory`.
 */

export { TursoD1PreparedStatement } from './statement';
export { TursoD1Database } from './database';
export { createTursoClient, getTursoDatabase } from './factory';
