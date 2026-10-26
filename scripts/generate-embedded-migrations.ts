import fs from 'node:fs';
import path from 'node:path';

const migrationsDir = path.join(process.cwd(), 'migrations');
const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();

let content = `/**
 * @file embeddedMigrations.ts
 * @description Auto-generated embedded SQL migration scripts for universal runtime migration.
 * Allows Cloudflare Workers and Node.js environments to apply schema updates to remote databases (e.g. Turso)
 * without requiring filesystem access at runtime.
 * Generated automatically from migrations/*.sql.
 */

export const EMBEDDED_MIGRATIONS: Record<string, string> = {
`;

for (const file of files) {
  const filePath = path.join(migrationsDir, file);
  const sql = fs.readFileSync(filePath, 'utf-8');
  content += `  ${JSON.stringify(file)}: ${JSON.stringify(sql)},\n`;
}

content += `};\n`;

const outPath = path.join(process.cwd(), 'src/lib/turso/embeddedMigrations.ts');
fs.writeFileSync(outPath, content, 'utf-8');
console.log(`Generated ${files.length} embedded migrations to ${outPath} (${(content.length / 1024).toFixed(1)} KB)`);
