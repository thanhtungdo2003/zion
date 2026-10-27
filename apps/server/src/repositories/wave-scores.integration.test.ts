import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { WaveResult } from '@zion/shared';
import { WaveScoreRepository, waveTeamKey } from './wave-scores';

describe('wave team keys', () => {
  it('names a team by its real accounts and its bot count, not by bot names or order', () => {
    const a = waveTeamKey([{ accountId: 'b', name: 'B', bot: false }, { accountId: 'a', name: 'A', bot: false }, { accountId: null, name: 'Sói', bot: true }]);
    const b = waveTeamKey([{ accountId: 'a', name: 'A', bot: false }, { accountId: null, name: 'Hổ', bot: true }, { accountId: 'b', name: 'B', bot: false }]);
    expect(a).toBe(b);
    expect(waveTeamKey([{ accountId: 'a', name: 'A', bot: false }])).not.toBe(waveTeamKey([{ accountId: 'a', name: 'A', bot: false }, { accountId: null, name: 'x', bot: true }]));
  });
});

/** Opt-in database check (ZION_WAVES_INTEGRATION=1 with DATABASE_URL): an isolated schema, the real migration. */
describe.skipIf(process.env.ZION_WAVES_INTEGRATION !== '1' || !process.env.DATABASE_URL)('PostgreSQL wave leaderboards', () => {
  const schema = `wave_scores_test_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${schema}`, max: 2 });
  let created = false;
  beforeAll(async () => {
    await admin.query(`CREATE SCHEMA ${schema}`); created = true;
    await pool.query(readFileSync(new URL('../../migrations/031_wave_scores.sql', import.meta.url), 'utf8'));
  });
  afterAll(async () => {
    await pool.end();
    if (!/^wave_scores_test_[a-f0-9]{32}$/.test(schema)) throw new Error('Unexpected test schema');
    if (created) await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  });

  const result = (over: Partial<WaveResult>): WaveResult => ({
    matchId: randomUUID(), mapId: 'warehouse', playMode: 'bots', board: 'solo', cleared: 3, clearMs: 90_000, survivedMs: 100_000,
    members: [{ accountId: 'acc-1', name: 'Ann', bot: false }], ...over,
  });

  it('ranks by waves then speed, keeps one row per team, never mixes boards or maps, records a match once', async () => {
    const repo = new WaveScoreRepository(pool);
    expect(await repo.record(result({ cleared: 3, clearMs: 90_000 }))).toBe(1);
    // The same player does better: still one row, the best one.
    expect(await repo.record(result({ cleared: 5, clearMs: 200_000 }))).toBe(1);
    expect(await repo.record(result({ members: [{ accountId: 'acc-2', name: 'Bob', bot: false }], cleared: 5, clearMs: 150_000 }))).toBe(1);
    const dup = result({ members: [{ accountId: 'acc-3', name: 'Cy', bot: false }], cleared: 1 });
    await repo.record(dup); await repo.record(dup);
    // Other boards and maps stay apart.
    await repo.record(result({ board: 'squad_bot', members: [{ accountId: 'acc-1', name: 'Ann', bot: false }, { accountId: null, name: 'A', bot: true }, { accountId: null, name: 'B', bot: true }, { accountId: null, name: 'C', bot: true }], cleared: 20 }));
    await repo.record(result({ mapId: 'other', cleared: 30 }));
    const solo = await repo.top('warehouse', 'solo');
    expect(solo.rows.map((r) => [r.members.join(), r.cleared])).toEqual([['Bob', 5], ['Ann', 5], ['Cy', 1]]);
    const squad = await repo.top('warehouse', 'squad_bot');
    expect(squad.rows).toHaveLength(1);
    expect(squad.rows[0]!.members).toEqual(['Ann', 'A (bot)', 'B (bot)', 'C (bot)']);
    expect((await repo.top('warehouse', 'full_squad')).rows).toHaveLength(0);
  });
});
