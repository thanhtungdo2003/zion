import pg from 'pg';
import type { Logger } from '../logger';

export type Db = pg.Pool;
export type DbClient = pg.PoolClient;

export function createPool(opts: { url: string; max: number; ssl: boolean; logger: Logger }): Db {
  const pool = new pg.Pool({
    connectionString: opts.url,
    max: opts.max,
    ssl: opts.ssl ? { rejectUnauthorized: true } : undefined,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    // Guard against runaway queries holding connections.
    statement_timeout: 10_000,
    query_timeout: 15_000,
    application_name: 'zion-server',
  });
  pool.on('error', (err) => opts.logger.error({ err }, 'idle postgres client error'));
  return pool;
}

/** Runs `fn` in a transaction; rolls back on any error. */
export async function withTransaction<T>(db: Db, fn: (client: DbClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
