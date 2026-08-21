import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_DIRECTORY = resolve(dirname(fileURLToPath(import.meta.url)), '../migrations');
const LOCK_ID = 0x4a574231;

async function loadMigration(path) {
  const sql = await readFile(path, 'utf8');
  return { sql, checksum: createHash('sha256').update(sql).digest('hex') };
}

async function migrationFiles(directory, allowlist = null) {
  const files=(await readdir(directory)).filter((name) => /^\d{3}_[a-z0-9_]+\.sql$/u.test(name)).sort();
  if(allowlist===null)return files;
  if(!Array.isArray(allowlist)||new Set(allowlist).size!==allowlist.length||allowlist.some(name=>!files.includes(name)))throw new Error('INVALID_MIGRATION_ALLOWLIST');
  return files.filter(name=>allowlist.includes(name));
}

export async function migrationStatus(pool, { directory = DEFAULT_DIRECTORY, allowlist = null } = {}) {
  const client = await pool.connect();
  try {
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
    const applied = new Map((await client.query('SELECT version,checksum FROM schema_migrations')).rows.map((row) => [row.version, row.checksum]));
    const status = [];
    for (const version of await migrationFiles(directory,allowlist)) {
      const { checksum } = await loadMigration(join(directory, version)); const previous = applied.get(version);
      status.push({ version, checksum, state: previous ? previous === checksum ? 'applied' : 'checksum_mismatch' : 'pending' });
    }
    return status;
  } finally { client.release(); }
}

export async function migrate(pool, { directory = DEFAULT_DIRECTORY, dryRun = false, allowlist = null } = {}) {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
    const applied = new Map((await client.query('SELECT version,checksum FROM schema_migrations')).rows.map((row) => [row.version, row.checksum]));
    const pending = [];
    for (const version of await migrationFiles(directory,allowlist)) {
      const loaded = await loadMigration(join(directory, version)); const previous = applied.get(version);
      if (previous && previous !== loaded.checksum) throw new Error(`MIGRATION_CHECKSUM_MISMATCH:${version}`);
      if (!previous) pending.push({ version, ...loaded });
    }
    if (dryRun) return pending.map(({ version, checksum }) => ({ version, checksum }));
    for (const item of pending) {
      await client.query('BEGIN');
      try {
        await client.query(item.sql);
        await client.query('INSERT INTO schema_migrations(version,checksum) VALUES($1,$2)', [item.version, item.checksum]);
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK'); throw error; }
    }
    return pending.map(({ version, checksum }) => ({ version, checksum }));
  } finally {
    try { await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]); } finally { client.release(); }
  }
}
