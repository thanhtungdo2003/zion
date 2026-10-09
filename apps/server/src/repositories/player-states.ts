import type { LifePlayer, LifeWorld } from '../game/base-life';
import { STARTING_ZCOIN, type InventoryData } from '@zion/shared';
import type { QuestJournal } from '../game/quests';
import type { Db } from '../db/pool';

export interface PlayerStateRecord {
  accountId: string;
  journal?: QuestJournal;
  life?: LifePlayer;
  x: number;
  y: number;
  z: number;
  yaw: number;
  health: number;
  /** ZCoin balance (absent in old records = starting purse). */
  coins?: number;
  /** Server-owned inventory (absent = brand-new player / never saved). */
  inventory?: InventoryData | null;
}

export class PlayerStateRepository {
  private writing: Promise<void> = Promise.resolve();
  constructor(
    private readonly db: Db,
    private readonly worldId: string,
  ) {}

  async load(accountId: string): Promise<PlayerStateRecord | null> {
    let pending: Promise<void>;
    do { pending = this.writing; await pending; } while (pending !== this.writing);
    const { rows } = await this.db.query<{ pos_x: number; pos_y: number; pos_z: number; yaw: number; health: number; coins: number; inventory: InventoryData | null; quest_journal: QuestJournal; life_state: LifePlayer }>(
      'SELECT pos_x, pos_y, pos_z, yaw, health, coins, inventory, quest_journal, life_state FROM player_states WHERE account_id = $1 AND world_id = $2',
      [accountId, this.worldId],
    );
    const r = rows[0];
    return r ? { accountId, x: r.pos_x, y: r.pos_y, z: r.pos_z, yaw: r.yaw, health: r.health, coins: r.coins, inventory: r.inventory, journal: r.quest_journal, life: r.life_state } : null;
  }

  /** Batched upsert (one round trip) using array parameters — still fully parameterised. */
  saveMany(states: readonly PlayerStateRecord[], worldLife?: LifeWorld): Promise<void> {
    const snapshot = structuredClone(states);
    const worldSnapshot = worldLife ? structuredClone(worldLife) : undefined;
    const next = this.writing.then(() => this.writeMany(snapshot, worldSnapshot));
    this.writing = next.catch(() => undefined);
    return next;
  }

  private async writeMany(states: readonly PlayerStateRecord[], worldLife?: LifeWorld): Promise<void> {
    if (states.length === 0) return;
    await this.db.query(
      `WITH saved_life AS (
         INSERT INTO world_base_life (world_id, state) SELECT $1, $12::jsonb WHERE $12::jsonb IS NOT NULL
         ON CONFLICT (world_id) DO UPDATE SET state = EXCLUDED.state, updated_at = now()
       ) INSERT INTO player_states (account_id, world_id, pos_x, pos_y, pos_z, yaw, health, coins, inventory, quest_journal, life_state, updated_at)
       SELECT a, $1, x, y, z, w, h, c, i, j, l, now()
         FROM unnest($2::uuid[], $3::float8[], $4::float8[], $5::float8[], $6::real[], $7::smallint[], $8::integer[], $9::jsonb[], $10::jsonb[], $11::jsonb[])
              AS t(a, x, y, z, w, h, c, i, j, l)
       ON CONFLICT (account_id, world_id) DO UPDATE
         SET pos_x = EXCLUDED.pos_x, pos_y = EXCLUDED.pos_y, pos_z = EXCLUDED.pos_z,
             yaw = EXCLUDED.yaw, health = EXCLUDED.health, coins = EXCLUDED.coins,
             quest_journal = EXCLUDED.quest_journal, life_state = EXCLUDED.life_state, inventory = COALESCE(EXCLUDED.inventory, player_states.inventory), updated_at = now()`,
      [
        this.worldId,
        states.map((s) => s.accountId),
        states.map((s) => s.x),
        states.map((s) => s.y),
        states.map((s) => s.z),
        states.map((s) => s.yaw),
        states.map((s) => Math.max(0, Math.min(100, Math.round(s.health)))),
        states.map((s) => Math.max(0, Math.round(s.coins ?? STARTING_ZCOIN))),
        states.map((s) => (s.inventory ? JSON.stringify(s.inventory) : null)),
        states.map((s) => JSON.stringify(s.journal ?? {})),
        states.map((s) => JSON.stringify(s.life ?? {})),
        worldLife ? JSON.stringify(worldLife) : null,
      ],
    );
  }
}
