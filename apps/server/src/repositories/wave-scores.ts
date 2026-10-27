import type { Db } from '../db/pool';
import type { WaveBoard, WaveLeaderboard, WaveResult } from '@zion/shared';

/** The identity of a team on a board: its real accounts (sorted) and how many bots came along. */
export function waveTeamKey(members: WaveResult['members']): string {
  const people = members.filter((m) => !m.bot).map((m) => m.accountId ?? `guest:${m.name}`).sort();
  return `${people.join(',')}+${members.filter((m) => m.bot).length}b`;
}

interface Row { members: Array<{ name: string; bot: boolean }>; cleared: number; clear_ms: string; survived_ms: string; created_at: Date }

export class WaveScoreRepository {
  constructor(private readonly db: Db) {}

  /** Records a finished match (once per match id). Returns the team's position on its board. */
  async record(r: WaveResult): Promise<number | null> {
    await this.db.query(
      `INSERT INTO wave_scores (match_id, map_id, play_mode, board, cleared, clear_ms, survived_ms, team_key, members)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (match_id) DO NOTHING`,
      [r.matchId, r.mapId, r.playMode, r.board, r.cleared, Math.round(r.clearMs), Math.round(r.survivedMs), waveTeamKey(r.members), JSON.stringify(r.members.map(({ name, bot }) => ({ name, bot })))],
    );
    const { rows } = await this.db.query<{ position: string }>(
      `WITH best AS (
         SELECT DISTINCT ON (team_key) team_key, cleared, clear_ms FROM wave_scores WHERE map_id = $1 AND board = $2
         ORDER BY team_key, cleared DESC, clear_ms ASC)
       SELECT 1 + count(*) AS position FROM best b, (SELECT cleared, clear_ms FROM wave_scores WHERE match_id = $3) me
       WHERE b.cleared > me.cleared OR (b.cleared = me.cleared AND b.clear_ms < me.clear_ms)`,
      [r.mapId, r.board, r.matchId],
    );
    return rows[0] ? Number(rows[0].position) : null;
  }

  /** The best result of each team on one board of one map: most waves cleared, then the fastest. */
  async top(mapId: string, board: WaveBoard, limit = 50): Promise<WaveLeaderboard> {
    const { rows } = await this.db.query<Row>(
      `SELECT members, cleared, clear_ms, survived_ms, created_at FROM (
         SELECT DISTINCT ON (team_key) * FROM wave_scores WHERE map_id = $1 AND board = $2
         ORDER BY team_key, cleared DESC, clear_ms ASC, created_at ASC) best
       ORDER BY cleared DESC, clear_ms ASC, created_at ASC LIMIT $3`,
      [mapId, board, limit],
    );
    return {
      mapId, board,
      rows: rows.map((r, i) => ({ position: i + 1, members: r.members.map((m) => m.bot ? `${m.name} (bot)` : m.name), cleared: r.cleared, clearMs: Number(r.clear_ms), survivedMs: Number(r.survived_ms), at: r.created_at.getTime() })),
    };
  }
}
