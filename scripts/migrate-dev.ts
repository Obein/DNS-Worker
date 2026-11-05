import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadEnvFiles, getPackageRoot } from '../src/serverfull/config';
import { getDatabaseService } from '../src/lib/turso';

loadEnvFiles();
const rootDir = getPackageRoot();

// Helper to inspect wrangler.toml
function isD1BoundInWrangler(rootDir: string): boolean {
  const wranglerPath = path.join(rootDir, 'wrangler.toml');
  if (!fs.existsSync(wranglerPath)) return false;
  try {
    const content = fs.readFileSync(wranglerPath, 'utf-8');
    for (const rawLine of content.split('\n')) {
      const line = rawLine.trim();
      if (!line.startsWith('#') && line.startsWith('[[d1_databases]]')) {
        return true;
      }
    }
  } catch {}
  return false;
}

const activeService = getDatabaseService(process.env, false);
const hasD1Binding = isD1BoundInWrangler(rootDir);

if (activeService === 'Turso' || !hasD1Binding) {
  console.log(`[Dev] DATABASE_SERVICE is '${activeService}' (d1_databases is ${hasD1Binding ? 'active' : 'omitted'}). Skipping local D1 migration.`);
  process.exit(0);
}

// When DATABASE_SERVICE is D1 and [[d1_databases]] is bound, apply local migrations
console.log('[Dev] Applying local D1 migrations for development...');
const result = spawnSync('npx', ['wrangler', 'd1', 'migrations', 'apply', 'dns_worker_db', '--local'], {
  input: 'y\n',
  stdio: ['pipe', 'inherit', 'inherit'],
  shell: true
});

process.exit(result.status || 0);
