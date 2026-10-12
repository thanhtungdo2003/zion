import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProgressionService } from './progression';

/** Opt-in database check: uses an isolated schema without touching game tables. */
describe.skipIf(process.env.ZION_CAREER_INTEGRATION !== '1' || !process.env.DATABASE_URL)('PostgreSQL leaderboard', () => {
  const schema = `codex_leaderboard_test_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${schema}`, max: 2 });
  let created = false;
  beforeAll(async () => {
    await admin.query(`CREATE SCHEMA ${schema}`); created = true;
    await pool.query(`CREATE TABLE accounts(id uuid PRIMARY KEY, username text, banned_until timestamptz);
      CREATE TABLE account_careers(account_id uuid PRIMARY KEY REFERENCES accounts(id), score integer);
      CREATE TABLE world_teams(world_id text, team_id uuid, state jsonb, PRIMARY KEY(world_id, team_id));`);
  });
  afterAll(async () => {
    await pool.end();
    if (!/^codex_leaderboard_test_[a-f0-9]{32}$/.test(schema)) throw new Error('Unexpected test schema');
    if (created) await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  });
  it('sorts ties consistently, sums current members, excludes banned players and isolates teams by world', async () => {
    const ids = Array.from({ length: 55 }, (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
    for (const [i, id] of ids.entries()) {
      await pool.query('INSERT INTO accounts VALUES ($1, $2, $3)', [id, `Player ${i}`, i === 0 ? '2099-01-01' : null]);
      await pool.query('INSERT INTO account_careers VALUES ($1, $2)', [id, i === 0 ? 999999 : i < 3 ? 1000 : 0]);
    }
    const team = async (name: string, members: string[], world = 'survival') => pool.query('INSERT INTO world_teams VALUES ($1, $2, $3)', [world, randomUUID(), JSON.stringify({ name, code: 'SECRET', members: members.map(accountId => ({ accountId })) })]);
    await team('Combined', [ids[1]!, ids[2]!]);
    await team('Zero', [ids[3]!]);
    await team('Banned', [ids[0]!]);
    await team('Elsewhere', [ids[1]!], 'other-world');
    const service = new ProgressionService(pool, 'survival');
    const first = await service.leaderboard(), second = await service.leaderboard();
    expect(first).toEqual(second);
    expect(first.individuals).toHaveLength(50);
    expect(first.individuals.slice(0, 2).map(p => p.name)).toEqual(['Player 1', 'Player 2']);
    expect(first.individuals.map(p => p.name)).not.toContain('Player 0');
    expect(first.teams).toEqual([{ position: 1, name: 'Combined', members: 2 }, { position: 2, name: 'Zero', members: 1 }]);
    expect(JSON.stringify(first)).not.toMatch(/score|accountId|code|SECRET/);
    await pool.query('UPDATE account_careers SET score = 3000 WHERE account_id = $1', [ids[3]]);
    expect((await service.leaderboard()).teams[0]?.name).toBe('Zero');
  });
});
