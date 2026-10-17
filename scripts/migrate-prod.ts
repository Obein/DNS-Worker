/**
 * @file migrate-prod.ts
 * @description Unified production database schema migration runner.
 * Automatically chooses between Turso and Cloudflare D1 based on DATABASE_SERVICE
 * environment variable or Turso configuration.
 *
 * Usage:
 *   npm run db:migrate:prod
 *   npx tsx scripts/migrate-prod.ts
 *   npx tsx scripts/migrate-prod.ts --turso
 *   npx tsx scripts/migrate-prod.ts --d1
 */

import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { loadEnvFiles, getPackageRoot } from '../src/serverfull/config';
import { createTursoClient, maskDatabaseUrl, getDatabaseService, isTursoConfigured } from '../src/lib/turso';
import { runTursoMigrations } from '../src/lib/turso/migrate';
import { formatBanner, formatDiagnostic } from '../src/serverfull/format';

async function main(): Promise<void> {
  loadEnvFiles();

  const { values } = parseArgs({
    options: {
      turso: { type: 'boolean' },
      d1: { type: 'boolean' },
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
  npm run db:migrate:prod [options]
  npx tsx scripts/migrate-prod.ts [options]

Options:
  --turso                       Force Turso database migration
  --d1                          Force Cloudflare D1 remote database migration
  --url, --turso-url <url>      Turso database URL (or set TURSO_DATABASE_URL)
  --token, --turso-token <tok>  Turso authorization token (or set TURSO_AUTH_TOKEN)
  -h, --help                    Show this help message
`);
    process.exit(0);
  }

  // Determine target database service
  let targetService: 'Turso' | 'D1' = 'D1';

  if (values.turso) {
    targetService = 'Turso';
  } else if (values.d1) {
    targetService = 'D1';
  } else {
    const detected = getDatabaseService(process.env, false);
    targetService = detected === 'Turso' ? 'Turso' : 'D1';
  }

  // 1. TURSO MIGRATION BRANCH
  if (targetService === 'Turso') {
    const url = (values['turso-url'] || values.url || process.env.TURSO_DATABASE_URL || process.env.TURSO_URL || '').trim();
    const token = (values['turso-token'] || values.token || process.env.TURSO_AUTH_TOKEN || '').trim();

    if (!url || !token) {
      console.error(formatDiagnostic({
        level: 'error',
        title: 'Turso Migration - Missing Credentials',
        message: 'DATABASE_SERVICE is set to Turso, but TURSO_DATABASE_URL or TURSO_AUTH_TOKEN is missing.',
        details: [
          `Target Engine  : Turso (libSQL over HTTP)`,
          `URL configured : ${url ? maskDatabaseUrl(url) : 'missing'}`,
          `Token configured: ${token ? 'yes (masked)' : 'missing'}`
        ],
        solutions: [
          'Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN in your .env or .env.serverfull file.',
          'Or pass them explicitly: npm run db:migrate:prod -- --turso --url libsql://your-db.turso.io --token your_token'
        ]
      }));
      process.exit(1);
    }

    console.log(formatBanner({
      title: 'Applying Database Migrations to Turso (DATABASE_SERVICE=Turso)',
      borderChar: '=',
      bullet: '• ',
      items: [
        { label: 'Database Service', value: 'Turso (libSQL over HTTP)' },
        { label: 'Target Endpoint', value: maskDatabaseUrl(url) },
        { label: 'Protocol', value: 'Hrana v2 over HTTP (/v2/pipeline)' }
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
    return;
  }

  // 2. CLOUDFLARE D1 MIGRATION BRANCH
  console.log(formatBanner({
    title: 'Applying Database Migrations to Cloudflare D1 (DATABASE_SERVICE=D1)',
    borderChar: '=',
    bullet: '• ',
    items: [
      { label: 'Database Service', value: 'Cloudflare D1 (Remote)' },
      { label: 'Database Name', value: 'dns_worker_db' }
    ]
  }));

  const result = spawnSync('npx', ['wrangler', 'd1', 'migrations', 'apply', 'dns_worker_db', '--remote'], {
    input: 'y\n',
    stdio: ['pipe', 'inherit', 'inherit'],
    shell: true
  });

  if (result.status !== 0) {
    console.error(formatDiagnostic({
      level: 'error',
      title: 'Cloudflare D1 Migration Failed',
      message: `wrangler d1 migrations exited with status code ${result.status}`
    }));
    process.exit(result.status || 1);
  }
}

main().catch((err) => {
  console.error('Migration error:', err);
  process.exit(1);
});
