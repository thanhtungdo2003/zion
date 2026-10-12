import { randomUUID } from 'node:crypto';
import { DEFAULT_RANK_CONFIG, rankConfigSchema, rankStep, rankTitle, type CareerView, type RankConfig, type RankTitle, type RequisitionReward, type TeamLobby } from '@zion/shared';
import { withTransaction, type Db, type DbClient } from '../db/pool';
import { studioCurrencyGrantSchema, type StudioCurrencyGrant } from '@zion/shared';
import type { LeaderboardView } from '@zion/shared';

export interface CareerEvent { id: string; points?: number; death?: boolean }
type Executor = Pick<DbClient, 'query'>;
export class ProgressionService {
  config: RankConfig = structuredClone(DEFAULT_RANK_CONFIG);
  constructor(private readonly db: Db, readonly worldId: string) {}
  async initialize(): Promise<void> {
    const result = await this.db.query('SELECT config FROM global_rank_config WHERE singleton = true');
    if (result.rows[0]) this.config = rankConfigSchema.parse(result.rows[0].config);
  }
  async configure(raw: unknown): Promise<RankConfig> {
    const config = rankConfigSchema.parse(raw);
    await this.db.query('INSERT INTO global_rank_config(singleton, config) VALUES (true, $1::jsonb) ON CONFLICT(singleton) DO UPDATE SET config = EXCLUDED.config, updated_at = now()', [JSON.stringify(config)]);
    this.config = config;
    return config;
  }
  /** Runs in the same transaction as the claimed quest or final death. */
  async record(db: Executor, accountId: string, event: CareerEvent): Promise<void> {
    await db.query('INSERT INTO account_careers(account_id) VALUES ($1) ON CONFLICT DO NOTHING', [accountId]);
    const { rows } = await db.query('SELECT score, awarded_step FROM account_careers WHERE account_id = $1 FOR UPDATE', [accountId]);
    const inserted = await db.query('INSERT INTO career_events(account_id, event_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING event_id', [accountId, event.id]);
    if (!inserted.rows.length) return;
    const c = this.config, old = rows[0]!;
    const delta = event.death ? -(c.deathBase + rankStep(old.score, c) * c.deathPerStep) : event.points ?? 0;
    const score = Math.max(0, Math.min(2_000_000_000, old.score + delta)), step = rankStep(score, c);
    for (let i = old.awarded_step + 1; i <= step; i++) {
      for (const reward of c.rewards[i]!) {
        await db.query('INSERT INTO requisitions(id, account_id, reward, source, quantity) VALUES ($1, $2, $3::jsonb, $4, $5)', [randomUUID(), accountId, JSON.stringify(reward), rankTitle(i).title, reward.quantity]);
      }
    }
    await db.query('UPDATE account_careers SET score = $2, awarded_step = GREATEST(awarded_step, $3), updated_at = now() WHERE account_id = $1', [accountId, score, step]);
  }
  async title(accountId: string): Promise<RankTitle> {
    const { rows } = await this.db.query('SELECT score FROM account_careers WHERE account_id = $1', [accountId]);
    return rankTitle(rankStep(rows[0]?.score ?? 0, this.config));
  }
  /** Public standings omit hidden scores, account identifiers and team invite codes. */
  async leaderboard(): Promise<LeaderboardView> {
    const [players, teams] = await Promise.all([
      this.db.query<{ username: string; score: number }>(`SELECT a.username, c.score
        FROM account_careers c JOIN accounts a ON a.id = c.account_id
        WHERE a.banned_until IS NULL OR a.banned_until <= now()
        ORDER BY c.score DESC, a.id ASC LIMIT 50`),
      this.db.query<{ name: string; members: string }>(`SELECT t.state->>'name' AS name, COUNT(*) AS members
        FROM world_teams t
        CROSS JOIN LATERAL jsonb_array_elements(t.state->'members') m
        JOIN accounts a ON a.id = (m->>'accountId')::uuid
        LEFT JOIN account_careers c ON c.account_id = a.id
        WHERE t.world_id = $1 AND (a.banned_until IS NULL OR a.banned_until <= now())
        GROUP BY t.team_id, t.state->>'name'
        ORDER BY SUM(COALESCE(c.score, 0)) DESC, t.team_id ASC LIMIT 50`, [this.worldId]),
    ]);
    return {
      individuals: players.rows.map((r, i) => ({ position: i + 1, name: r.username, rank: rankTitle(rankStep(r.score, this.config)) })),
      teams: teams.rows.map((r, i) => ({ position: i + 1, name: r.name, members: Number(r.members) })),
    };
  }
  /** A durable, idempotent Studio credit, also safe for accounts that have never entered a world. */
  async grantCoins(raw: StudioCurrencyGrant, actorId: string | null): Promise<boolean> {
    const grant = studioCurrencyGrantSchema.parse(raw);
    const reward = { kind: 'coins', id: 'zcoin', name: 'ZCoin', mode: 'survival', quantity: grant.amount, source: 'studio', reason: grant.reason, actorId };
    const result = await this.db.query(`INSERT INTO survival_requisitions(id, account_id, world_id, reward)
      SELECT $1, id, $3, $4::jsonb FROM accounts WHERE id = $2
      ON CONFLICT(id) DO NOTHING RETURNING id`, [grant.requestId, grant.accountId, this.worldId, JSON.stringify(reward)]);
    if (result.rows.length) return true;
    const previous = await this.db.query('SELECT account_id, world_id, reward FROM survival_requisitions WHERE id = $1', [grant.requestId]);
    const row = previous.rows[0];
    if (!row) throw Object.assign(new Error('Không tìm thấy người chơi.'), { statusCode: 404 });
    if (row.account_id !== grant.accountId || row.world_id !== this.worldId || row.reward.source !== 'studio' || row.reward.quantity !== grant.amount || row.reward.reason !== grant.reason || row.reward.actorId !== actorId) {
      throw Object.assign(new Error('Mã giao dịch đã được dùng cho một lần cấp tiền khác.'), { statusCode: 409 });
    }
    return false;
  }
  async coinGrantDelivered(requestId: string): Promise<boolean> {
    const result = await this.db.query('SELECT delivered FROM survival_requisitions WHERE id = $1 AND world_id = $2', [requestId, this.worldId]);
    return result.rows[0]?.delivered === true;
  }
  async lobbyRanks(lobby: TeamLobby): Promise<TeamLobby> {
    if (!lobby.team) return lobby;
    const { rows } = await this.db.query('SELECT account_id, score FROM account_careers WHERE account_id = ANY($1::uuid[])', [lobby.team.members.map((m) => m.accountId)]);
    const ranks = new Map(rows.map((r) => [r.account_id, rankTitle(rankStep(r.score, this.config))]));
    lobby.team.members = lobby.team.members.map((m) => ({ ...m, rank: ranks.get(m.accountId) ?? rankTitle(0) }));
    return lobby;
  }
  async view(accountId: string): Promise<CareerView> {
    const [career, stock, pending] = await Promise.all([
      this.db.query('SELECT score, awarded_step FROM account_careers WHERE account_id = $1', [accountId]),
      this.db.query('SELECT id, reward, source, quantity, received_at FROM requisitions WHERE account_id = $1 AND quantity > 0 ORDER BY received_at DESC, id', [accountId]),
      this.db.query('SELECT COUNT(*) AS count FROM survival_requisitions WHERE account_id = $1 AND world_id = $2 AND NOT delivered', [accountId, this.worldId]),
    ]);
    const row = career.rows[0];
    return {
      rank: rankTitle(rankStep(row?.score ?? 0, this.config)),
      milestones: this.config.rewards.map((rewards, step) => ({ rank: rankTitle(step), awarded: step <= (row?.awarded_step ?? 0), rewards })),
      armory: stock.rows.map((r) => ({ ...r.reward, key: r.id, quantity: r.quantity, source: r.source, receivedAt: new Date(r.received_at).toISOString() })),
      pendingSurvival: Number(pending.rows[0]?.count ?? 0),
    };
  }
  /** Atomically consumes stock into a durable delivery queue; double-clicks cannot duplicate it. */
  async deploy(accountId: string, key: string): Promise<void> {
    await withTransaction(this.db, async (db) => {
      const { rows } = await db.query('SELECT reward, quantity FROM requisitions WHERE id = $1 AND account_id = $2 FOR UPDATE', [key, accountId]);
      const r = rows[0];
      if (!r || r.quantity < 1) throw new Error('Vật phẩm đã được chuyển hoặc không thuộc tài khoản.');
      const reward = r.reward as RequisitionReward;
      if (reward.mode !== 'survival' || !['item', 'coins'].includes(reward.kind)) throw new Error('Phần quà này chưa hỗ trợ đưa vào Sinh tồn.');
      // Coins move as one parcel; equipment/ammo move one inventory item per click.
      const quantity = reward.kind === 'coins' ? r.quantity : 1;
      await db.query('INSERT INTO survival_requisitions(id, account_id, world_id, reward) VALUES ($1, $2, $3, $4::jsonb)', [randomUUID(), accountId, this.worldId, JSON.stringify({ ...reward, quantity })]);
      await db.query('UPDATE requisitions SET quantity = quantity - $2 WHERE id = $1', [key, quantity]);
    });
  }
}
