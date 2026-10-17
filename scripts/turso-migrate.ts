/**
 * @file turso-migrate.ts
 * @description Standalone CLI script to apply SQL migrations to Turso (libSQL) database.
 * Usage:
 *   npx tsx scripts/turso-migrate.ts
 *   npm run db:migrate:turso
 *   npx tsx scripts/turso-migrate.ts --url libsql://your-db.turso.io --token your_token
 */

import path from 'node:path';
import { parseArgs } from 'node:util';
import { loadEnvFiles, getPackageRoot } from '../src/serverfull/config';
import { createTursoClient, maskDatabaseUrl } from '../src/lib/turso';
import { runTursoMigrations } from '../src/lib/turso/migrate';
import { formatBanner, formatDiagnostic } from '../src/serverfull/format';

async function main(): Promise<void> {
  loadEnvFiles();

  const { values } = parseArgs({
    options: {
      url: { type: 'string' },
      'turso-url': { type: 'string' },
      token: { type: 'string' },
      'turso-token': { type: 'string' },
      help: { type: 'boolean', short: 'h' }
    },
    allowPositionals: true
  });

  if (values.help) {
    console.log(`
Usage:
  npx tsx scripts/turso-migrate.ts [options]
  npm run db:migrate:turso

Options:
  --url, --turso-url <url>      Turso database URL (or set TURSO_DATABASE_URL)
  --token, --turso-token <tok>  Turso authorization token (or set TURSO_AUTH_TOKEN)
  -h, --help                    Show this help message
`);
    process.exit(0);
  }

  const url = (values['turso-url'] || values.url || process.env.TURSO_DATABASE_URL || process.env.TURSO_URL || '').trim();
  const token = (values['turso-token'] || values.token || process.env.TURSO_AUTH_TOKEN || '').trim();

  if (!url || !token) {
    console.error(formatDiagnostic({
      level: 'error',
      title: 'Turso Migration - Missing Credentials',
      message: 'TURSO_DATABASE_URL and TURSO_AUTH_TOKEN must be specified in environment variables or via CLI arguments.',
      details: [
        `URL configured  : ${url ? maskDatabaseUrl(url) : 'missing'}`,
        `Token configured: ${token ? 'yes (masked)' : 'missing'}`
      ],
      solutions: [
        'Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN in your .env or .env.serverfull file.',
        'Or pass them explicitly: npm run db:migrate:turso -- --url libsql://your-db.turso.io --token your_token'
      ]
    }));
    process.exit(1);
  }

  console.log(formatBanner({
    title: 'Applying Database Migrations to Turso',
    borderChar: '=',
    bullet: '• ',
    items: [
      `Target Endpoint: ${maskDatabaseUrl(url)}`,
      `Protocol       : Hrana v2 over HTTP (/v2/pipeline)`
    ]
  }));

  const rootDir = getPackageRoot();
  const migrationsDir = path.join(rootDir, 'migrations');

  try {
    const client = createTursoClient(url, token);
    const applied = await runTursoMigrations(client, migrationsDir);
    console.log(formatDiagnostic({
      level: 'success',
      title: 'Turso Migration Finished',
      message: `Successfully executed schema migrations on Turso (${applied} new migration(s) applied).`
    }));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(formatDiagnostic({
      level: 'error',
      title: 'Turso Migration Failed',
      message: msg
    }));
    process.exit(1);
  }
}

main();
