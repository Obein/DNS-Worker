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

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { loadEnvFiles, getPackageRoot } from '../src/serverfull/config';
import { createTursoClient, maskDatabaseUrl, getDatabaseService } from '../src/lib/turso';
import { runTursoMigrations } from '../src/lib/turso/migrate';
import { formatBanner, formatDiagnostic, formatHelpMenu } from '../src/serverfull/format';

/**
 * Parses [vars] section from wrangler.toml as fallback when deploying in CI environments.
 */
function loadWranglerVars(rootDir: string): void {
  const wranglerPath = path.join(rootDir, 'wrangler.toml');
  if (!fs.existsSync(wranglerPath)) return;
  try {
    const content = fs.readFileSync(wranglerPath, 'utf-8');
    let inVars = false;
    for (const rawLine of content.split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      if (line.startsWith('[')) {
        inVars = line === '[vars]';
        continue;
      }
      if (inVars && line.includes('=')) {
        const [k, ...v] = line.split('=');
        const key = k.trim();
        let val = v.join('=').trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (!(key in process.env)) {
          process.env[key] = val;
        }
      }
    }
  } catch {}
}

async function main(): Promise<void> {
  loadEnvFiles();
  loadWranglerVars(getPackageRoot());

  const { values } = parseArgs({
    options: {
      turso: { type: 'boolean' },
      d1: { type: 'boolean' },
      backfill: { type: 'boolean' },
      url: { type: 'string' },
      'turso-url': { type: 'string' },
      token: { type: 'string' },
      'turso-token': { type: 'string' },
      help: { type: 'boolean', short: 'h' }
    },
    allowPositionals: true
  });

  if (values.help) {
    console.log(formatHelpMenu({
      name: 'ObexDNS Production Database Migration',
      description: 'Unified schema migration runner for Cloudflare D1 and Turso (libSQL)',
      usage: [
        'npm run db:migrate:prod [options]',
        'npx tsx scripts/migrate-prod.ts [options]'
      ],
      options: [
        { label: '--turso', desc: 'Force Turso database schema migration' },
        { label: '--d1', desc: 'Force Cloudflare D1 remote database schema migration' },
        { label: '--backfill', desc: 'Trigger safe hourly rollups backfill from historical logs' },
        { label: '--url, --turso-url <url>', desc: 'Turso database URL (or set TURSO_DATABASE_URL)' },
        { label: '--token, --turso-token <tok>', desc: 'Turso database authorization token (or set TURSO_AUTH_TOKEN)' },
        { label: '-h, --help', desc: 'Display this help message' }
      ],
      envVars: [
        { label: 'DATABASE_SERVICE', desc: 'Active database engine (D1 or Turso, default: D1)' },
        { label: 'TURSO_DATABASE_URL / TURSO_URL', desc: 'Turso database URL endpoint' },
        { label: 'TURSO_AUTH_TOKEN', desc: 'Turso database authorization token' }
      ],
      tip: [
        'When DATABASE_SERVICE=Turso, migrations run via the HTTP Hrana v2 pipeline directly.',
        'When DATABASE_SERVICE=D1, migrations run via "wrangler d1 migrations apply dns_worker_db --remote".'
      ]
    }));
    process.exit(0);
  }

  // Determine database migration targets
  const explicitTurso = Boolean(values.turso);
  const explicitD1 = Boolean(values.d1);

  const tursoUrl = (values['turso-url'] || values.url || process.env.TURSO_DATABASE_URL || process.env.TURSO_URL || '').trim();
  const tursoToken = (values['turso-token'] || values.token || process.env.TURSO_AUTH_TOKEN || '').trim();
  const hasTursoCreds = Boolean(tursoUrl && tursoToken);

  let runTurso = false;
  let runD1 = false;

  if (explicitTurso) {
    runTurso = true;
  } else if (explicitD1) {
    runD1 = true;
  } else {
    // Default: Apply to all connected databases
    runTurso = hasTursoCreds;
    runD1 = true; // D1 is standard Cloudflare binding in wrangler.toml

    if (tursoUrl && !tursoToken) {
      console.log(formatDiagnostic({
        level: 'warning',
        title: 'Turso Migration - Runtime Secret Detected',
        message: 'TURSO_DATABASE_URL is configured, but TURSO_AUTH_TOKEN is absent in the build environment (e.g. Worker Dash encrypted secret).',
        solutions: [
          'Schema migrations on Turso will be automatically and safely applied at runtime upon worker start.',
          'To migrate Turso immediately during build, add TURSO_AUTH_TOKEN to Worker Dash Build Variables, or run: npm run db:migrate:prod -- --turso'
        ]
      }));
    }
  }

  // 1. TURSO MIGRATION BRANCH
  if (runTurso) {
    if (!tursoUrl || !tursoToken) {
      console.error(formatDiagnostic({
        level: 'error',
        title: 'Turso Migration - Missing Credentials',
        message: 'DATABASE_SERVICE is set to Turso, but TURSO_DATABASE_URL or TURSO_AUTH_TOKEN is missing.',
        details: [
          `Target Engine  : Turso (libSQL over HTTP)`,
          `URL configured : ${tursoUrl ? maskDatabaseUrl(tursoUrl) : 'missing'}`,
          `Token configured: ${tursoToken ? 'yes (masked)' : 'missing'}`
        ],
        solutions: [
          'Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN in your .env or .env.serverfull file.',
          'Or pass them explicitly: npm run db:migrate:prod -- --turso --url libsql://your-db.turso.io --token your_token'
        ]
      }));
      process.exit(1);
    }

    console.log(formatBanner({
      title: 'Applying Database Migrations to Turso (libSQL)',
      borderChar: '=',
      bullet: '• ',
      items: [
        { label: 'Database Service', value: 'Turso (libSQL over HTTP)' },
        { label: 'Target Endpoint', value: maskDatabaseUrl(tursoUrl) },
        { label: 'Protocol', value: 'Hrana v2 over HTTP (/v2/pipeline)' }
      ]
    }));

    const rootDir = getPackageRoot();
    const migrationsDir = path.join(rootDir, 'migrations');

    try {
      const client = createTursoClient(tursoUrl, tursoToken);
      const applied = await runTursoMigrations(client, migrationsDir);
      console.log(formatDiagnostic({
        level: 'success',
        title: 'Turso Migration Finished',
        message: `Successfully executed schema migrations on Turso (${applied} new migration(s) applied).`
      }));

      if (applied > 0 || values.backfill) {
        try {
          const { LogAggregationModel } = await import('../src/models/log/aggregation');
          const aggModel = new LogAggregationModel(client as any);
          console.log('[Turso Migrations] Running safe hourly rollups backfill...');
          const aggregated = await aggModel.aggregateHourlyRollups();
          if (aggregated > 0) {
            console.log(`[Turso Migrations] Successfully backfilled ${aggregated} hourly rollup rows.`);
          } else {
            console.log('[Turso Migrations] Hourly rollups are already up-to-date.');
          }
        } catch (aggErr: any) {
          console.warn('[Turso Migrations] Rollup backfill notice:', aggErr.message || aggErr);
        }
      }
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

  // 2. CLOUDFLARE D1 MIGRATION BRANCH
  if (runD1) {
    console.log(formatBanner({
      title: 'Applying Database Migrations to Cloudflare D1',
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
}

main().catch((err) => {
  console.error('Migration error:', err);
  process.exit(1);
});
