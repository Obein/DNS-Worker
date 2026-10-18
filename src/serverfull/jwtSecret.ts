/**
 * @file jwtSecret.ts
 * @description Persistent JWT Secret generation and lookup for Serverfull mode.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getDefaultDataDir } from './paths';

/**
 * Resolves or initializes a stable, persistent JWT secret.
 * Precedence:
 * 1. process.env.JWT_SECRET (if explicitly configured)
 * 2. <DataDir>/.jwt_secret (if previously generated and persisted)
 * 3. Generates 256-bit cryptographically secure hex string and persists it to <DataDir>/.jwt_secret
 */
export function getOrInitPersistentJwtSecret(dataDir: string = getDefaultDataDir()): string {
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.trim().length > 0) {
    return process.env.JWT_SECRET.trim();
  }

  const secretFile = path.join(dataDir, '.jwt_secret');
  try {
    if (fs.existsSync(secretFile)) {
      const existing = fs.readFileSync(secretFile, 'utf-8').trim();
      if (existing.length >= 16) {
        return existing;
      }
    }
  } catch {}

  // Generate 256-bit secure random secret (64 hex characters)
  const newSecret = Buffer.from(crypto.randomBytes(32)).toString('hex');
  try {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    fs.writeFileSync(secretFile, newSecret, { encoding: 'utf-8', mode: 0o600 });
  } catch {}
  return newSecret;
}
