import { withTransaction, type DbClient } from '../db/pool';
import { InventoryModel, type ChestData, type TeamRecord, type SuspendedZombie } from '@zion/shared';
import type { CareerEvent, ProgressionService } from '../game/progression';
import type { LifePlayer, LifeWorld } from '../game/base-life';
import { STARTING_ZCOIN, type InventoryData } from '@zion/shared';
import type { QuestJournal } from '../game/quests';
import type { Db } from '../db/pool';

export interface PlayerStateRecord {
  careerEvent?: CareerEvent;
  suspendedZombies?: SuspendedZombie[];
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
    private readonly progression?: ProgressionService,
  ) {}

  resetQuestJournals(accountId?: string): Promise<void> {
    const next = this.writing.then(async () => {
      await this.db.query("UPDATE player_states SET quest_journal = '{}'::jsonb WHERE world_id = $1 AND ($2::uuid IS NULL OR account_id = $2::uuid)", [this.worldId, accountId ?? null]);
    });
    this.writing = next.catch(() => undefined);
    return next;
  }

  async load(accountId: string): Promise<PlayerStateRecord | null> {
    let pending: Promise<void>;
    do { pending = this.writing; await pending; } while (pending !== this.writing);
    const { rows } = await this.db.query<{ pos_x: number; pos_y: number; pos_z: number; yaw: number; health: number; coins: number; inventory: InventoryData | null; quest_journal: QuestJournal; life_state: LifePlayer; suspended_zombies: SuspendedZombie[] }>(
      'SELECT pos_x, pos_y, pos_z, yaw, health, coins, inventory, quest_journal, life_state, suspended_zombies FROM player_states WHERE account_id = $1 AND world_id = $2',
      [accountId, this.worldId],
    );
    const r = rows[0];
    return r ? { accountId, x: r.pos_x, y: r.pos_y, z: r.pos_z, yaw: r.yaw, health: r.health, coins: r.coins, inventory: r.inventory, journal: r.quest_journal, life: r.life_state, suspendedZombies: r.suspended_zombies ?? [] } : null;
  }

  async loadChest(id: string): Promise<ChestData | null> {
    let pending: Promise<void>;
    do { pending = this.writing; await pending; } while (pending !== this.writing);
    const result = await this.db.query<{ state: ChestData }>('SELECT state FROM world_chests WHERE world_id = $1 AND chest_id = $2', [this.worldId, id]);
    return result.rows[0]?.state ?? null;
  }

  async loadTeams(): Promise<TeamRecord[]> {
    const result = await this.db.query<{ state: TeamRecord }>('SELECT state FROM world_teams WHERE world_id = $1', [this.worldId]);
    return result.rows.map((r) => r.state);
  }

  /** Team progress and the claimant's wallet commit atomically, preventing duplicate rewards. */
  saveTeam(id: string, team: TeamRecord | null, player?: PlayerStateRecord): Promise<void> {
    const snapshot = structuredClone(team), survivor = player ? structuredClone(player) : undefined;
    const next = this.writing.then(() => withTransaction(this.db, async (client) => {
      if (survivor) await this.writeMany([survivor], undefined, client);
      if (snapshot) await client.query('INSERT INTO world_teams (world_id, team_id, state) VALUES ($1, $2, $3::jsonb) ON CONFLICT (world_id, team_id) DO UPDATE SET state = EXCLUDED.state, updated_at = now()', [this.worldId, id, JSON.stringify(snapshot)]);
      else await client.query('DELETE FROM world_teams WHERE world_id = $1 AND team_id = $2', [this.worldId, id]);
    }));
    this.writing = next.catch(() => undefined);
    return next;
  }

  /** Chest and survivor commit together: a crash cannot duplicate or lose a transferred item. */
  saveChestAndPlayer(id: string, chest: ChestData, player?: PlayerStateRecord): Promise<void> {
    const snapshot = structuredClone(chest);
    const survivor = player ? structuredClone(player) : undefined;
    const next = this.writing.then(() => withTransaction(this.db, async (client) => {
      if (survivor) await this.writeMany([survivor], undefined, client);
      await client.query('INSERT INTO world_chests (world_id, chest_id, state) VALUES ($1, $2, $3::jsonb) ON CONFLICT (world_id, chest_id) DO UPDATE SET state = EXCLUDED.state, updated_at = now()', [this.worldId, id, JSON.stringify(snapshot)]);
    }));
    this.writing = next.catch(() => undefined);
    return next;
  }

  /** Batched upsert (one round trip) using array parameters — still fully parameterised. */
  saveMany(states: readonly PlayerStateRecord[], worldLife?: LifeWorld): Promise<void> {
    const snapshot = structuredClone(states);
    const worldSnapshot = worldLife ? structuredClone(worldLife) : undefined;
    const next = this.writing.then(() => snapshot.some((s) => s.careerEvent)
      ? withTransaction(this.db, (client) => this.writeMany(snapshot, worldSnapshot, client))
      : this.writeMany(snapshot, worldSnapshot));
    this.writing = next.catch(() => undefined);
    return next;
  }

  private async writeMany(states: readonly PlayerStateRecord[], worldLife?: LifeWorld, executor: Db | DbClient = this.db): Promise<void> {
    if (states.length === 0) return;
    await executor.query(
      `WITH saved_life AS (
         INSERT INTO world_base_life (world_id, state) SELECT $1, $12::jsonb WHERE $12::jsonb IS NOT NULL
         ON CONFLICT (world_id) DO UPDATE SET state = EXCLUDED.state, updated_at = now()
       ) INSERT INTO player_states (account_id, world_id, pos_x, pos_y, pos_z, yaw, health, coins, inventory, quest_journal, life_state, suspended_zombies, updated_at)
       SELECT a, $1, x, y, z, w, h, c, i, j, l, COALESCE(sz, '[]'::jsonb), now()
         FROM unnest($2::uuid[], $3::float8[], $4::float8[], $5::float8[], $6::real[], $7::smallint[], $8::integer[], $9::jsonb[], $10::jsonb[], $11::jsonb[], $13::jsonb[])
              AS t(a, x, y, z, w, h, c, i, j, l, sz)
       ON CONFLICT (account_id, world_id) DO UPDATE
         SET pos_x = EXCLUDED.pos_x, pos_y = EXCLUDED.pos_y, pos_z = EXCLUDED.pos_z,
             yaw = EXCLUDED.yaw, health = EXCLUDED.health, coins = EXCLUDED.coins,
             quest_journal = EXCLUDED.quest_journal, life_state = EXCLUDED.life_state, suspended_zombies = EXCLUDED.suspended_zombies, inventory = COALESCE(EXCLUDED.inventory, player_states.inventory), updated_at = now()`,
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
        states.map((s) => JSON.stringify(s.suspendedZombies ?? [])),
      ],
    );
    for (const s of states) if (s.careerEvent && this.progression) await this.progression.record(executor, s.accountId, s.careerEvent);
  }

  /** Delivery and the camp inventory commit together, before the player enters simulation. */
  deliverRequisitions(state: PlayerStateRecord): Promise<PlayerStateRecord> {
    const snapshot = structuredClone(state);
    const next = this.writing.then(() => withTransaction(this.db, async (db) => {
      const result = await db.query('SELECT id, reward FROM survival_requisitions WHERE account_id = $1 AND world_id = $2 AND NOT delivered ORDER BY id FOR UPDATE', [state.accountId, this.worldId]);
      const inv = new InventoryModel(snapshot.inventory!);
      for (const row of result.rows) {
        const r = row.reward;
        if (r.kind === 'coins') {
          if ((snapshot.coins ?? 0) + r.quantity > 2_147_483_647) continue;
          snapshot.coins = (snapshot.coins ?? 0) + r.quantity;
        } else if (r.kind === 'item') {
          const trial = new InventoryModel(inv.toJSON());
          let fits = true;
          for (let i = 0; i < r.quantity; i++) if (!trial.addToStash(r.id)) { fits = false; break; }
          if (!fits) continue;
          inv.load(trial.toJSON());
        } else continue;
        await db.query('UPDATE survival_requisitions SET delivered = true WHERE id = $1', [row.id]);
      }
      snapshot.inventory = inv.toJSON();
      if (result.rows.length) await this.writeMany([snapshot], undefined, db);
      return snapshot;
    }));
    this.writing = next.then(() => undefined, () => undefined);
    return next;
  }
}
