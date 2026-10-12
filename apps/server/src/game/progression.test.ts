import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_RANK_CONFIG } from '@zion/shared';
import { ProgressionService } from './progression';
import type { Db, DbClient } from '../db/pool';

function fixture() {
  const account = { score: 0, awarded_step: 0 }, events = new Set<string>(), rewards: unknown[][] = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.startsWith('SELECT score, awarded_step')) return { rows: [{ ...account }] };
    if (sql.startsWith('INSERT INTO career_events')) {
      const key = String(params[1]); if (events.has(key)) return { rows: [] };
      events.add(key); return { rows: [{ event_id: key }] };
    }
    if (sql.startsWith('INSERT INTO requisitions')) rewards.push(params);
    if (sql.startsWith('UPDATE account_careers')) {
      account.score = Number(params[1]); account.awarded_step = Math.max(account.awarded_step, Number(params[2]));
    }
    return { rows: [] };
  });
  const db = { query } as unknown as DbClient;
  const service = new ProgressionService({ query } as unknown as Db, 'survival');
  return { service, db, account, rewards };
}

describe('authoritative career awards', () => {
  it('returns standings without internal scores, account IDs or invite codes', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ username: 'One', score: 1000 }, { username: 'Two', score: 0 }] })
      .mockResolvedValueOnce({ rows: [{ name: 'Alpha', members: '3' }] });
    const service = new ProgressionService({ query } as unknown as Db, 'survival');
    const result = await service.leaderboard();
    expect(result.individuals.map(p => [p.position, p.name, p.rank.title])).toEqual([[1, 'One', 'Binh Nhì I'], [2, 'Two', 'Tân Binh I']]);
    expect(result.teams).toEqual([{ position: 1, name: 'Alpha', members: 3 }]);
    expect(JSON.stringify(result)).not.toMatch(/score|accountId|code|threshold/);
    expect(query.mock.calls[1]![1]).toEqual(['survival']);
  });
  it('awards every crossed star once, ignores duplicate completion and never reissues after demotion', async () => {
    const { service, db, account, rewards } = fixture();
    await service.record(db, 'player', { id: 'quest:one', points: 1000 });
    expect(account).toEqual({ score: 1000, awarded_step: 5 });
    expect(rewards).toHaveLength(DEFAULT_RANK_CONFIG.rewards.slice(1, 6).flat().length);
    await service.record(db, 'player', { id: 'quest:one', points: 1000 });
    expect(account.score).toBe(1000);
    const count = rewards.length;
    await service.record(db, 'player', { id: 'death:one', death: true });
    expect(account.score).toBe(920);
    await service.record(db, 'player', { id: 'quest:two', points: 80 });
    expect(account.score).toBe(1000); expect(rewards).toHaveLength(count);
  });
  it('clamps death loss at zero and scales the penalty with the current star', async () => {
    const { service, db, account } = fixture();
    await service.record(db, 'player', { id: 'new-player-death', death: true });
    expect(account.score).toBe(0);
    account.score = DEFAULT_RANK_CONFIG.thresholds[24]!;
    account.awarded_step = 24;
    await service.record(db, 'player', { id: 'elite-death', death: true });
    expect(account.score).toBe(DEFAULT_RANK_CONFIG.thresholds[24]! - 232);
    expect(account.awarded_step).toBe(24);
  });
});
