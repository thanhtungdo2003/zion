import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Logger } from '../logger';
import type { Db } from './pool';

/** Arbitrary constant identifying the migration advisory lock. */
const MIGRATION_LOCK_ID = 0x5a10_4e01;

interface Migration {
  version: string;
  file: string;
  sql: string;
  checksum: string;
}

async function loadMigrations(dir: string): Promise<Migration[]> {
  const files = (await readdir(dir)).filter((f) => /^\d{3}_[a-z0-9_]+\.sql$/.test(f)).sort();
  const out: Migration[] = [];
  for (const file of files) {
    const sql = await readFile(path.join(dir, file), 'utf8');
    out.push({
      version: file.slice(0, 3),
      file,
      sql,
      checksum: createHash('sha256').update(sql).digest('hex'),
    });
  }
  return out;
}

/**
 * Applies pending SQL migrations in order, each in its own transaction, under a session-level
 * advisory lock so concurrently starting instances never race. Already-applied migrations are
 * verified by checksum: editing an applied migration is an error (write a new one instead).
 */
export async function migrate(db: Db, dir: string, logger: Logger): Promise<number> {
  const migrations = await loadMigrations(dir);
  const client = await db.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version    text PRIMARY KEY,
        file       text NOT NULL,
        checksum   text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);
    const { rows } = await client.query<{ version: string; checksum: string }>(
      'SELECT version, checksum FROM schema_migrations',
    );
    const applied = new Map(rows.map((r) => [r.version, r.checksum]));
    let count = 0;
    for (const m of migrations) {
      const prev = applied.get(m.version);
      if (prev) {
        if (prev !== m.checksum) throw new Error(`migration ${m.file} was modified after being applied`);
        continue;
      }
      logger.info({ migration: m.file }, 'applying migration');
      await client.query('BEGIN');
      try {
        await client.query(m.sql);
        await client.query('INSERT INTO schema_migrations (version, file, checksum) VALUES ($1, $2, $3)', [
          m.version,
          m.file,
          m.checksum,
        ]);
        await client.query('COMMIT');
        count++;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw new Error(`migration ${m.file} failed: ${(err as Error).message}`);
      }
    }
    return count;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]).catch(() => undefined);
    client.release();
  }
}

export function defaultMigrationsDir(): string {
  // Works from src/ (tsx) and dist/ (bundled): migrations/ sits next to the package root.
  if (process.env.MIGRATIONS_DIR) return process.env.MIGRATIONS_DIR;
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [path.resolve(here, '../../migrations'), path.resolve(here, '../migrations')];
  return candidates.find((c) => existsSync(c)) ?? candidates[0]!;
}
