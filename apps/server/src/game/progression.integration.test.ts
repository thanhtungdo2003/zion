import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_RANK_CONFIG, InventoryModel, type InventoryData } from '@zion/shared';
import { ProgressionService } from './progression';
import { PlayerStateRepository } from '../repositories/player-states';
import { withTransaction } from '../db/pool';

/** Explicit opt-in: a disposable schema, never the game's public tables. */
describe.skipIf(process.env.ZION_CAREER_INTEGRATION !== '1' || !process.env.DATABASE_URL)('PostgreSQL account career and requisitions', () => {
  const schema = `codex_career_test_${randomUUID().replaceAll('-', '')}`;
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${schema}`, max: 8 });
  const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const account = randomUUID(), other = randomUUID();
  let service: ProgressionService, states: PlayerStateRepository;
  let created = false;
  beforeAll(async () => {
    await admin.query(`CREATE SCHEMA ${schema}`);
    created = true;
    await pool.query(`CREATE TABLE accounts(id uuid PRIMARY KEY);
      CREATE TABLE player_states(account_id uuid, world_id text, pos_x float8, pos_y float8, pos_z float8, yaw real, health smallint, coins integer, inventory jsonb, quest_journal jsonb, life_state jsonb, updated_at timestamptz, PRIMARY KEY(account_id, world_id));
      CREATE TABLE world_base_life(world_id text PRIMARY KEY, state jsonb, updated_at timestamptz);`);
    await pool.query(await readFile(new URL('../../migrations/013_account_career.sql', import.meta.url), 'utf8'));
    await pool.query('INSERT INTO accounts VALUES ($1), ($2)', [account, other]);
    service = new ProgressionService(pool, 'survival');
    await service.initialize();
    states = new PlayerStateRepository(pool, 'survival', service);
  });
  afterAll(async () => {
    await pool.end();
    // The identifier is generated above and constrained to a dedicated test prefix.
    if (!/^codex_career_test_[a-f0-9]{32}$/.test(schema)) throw new Error('Unexpected test schema');
    if (created) await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  });
  const state = (id = account, inventory: InventoryData = new InventoryModel().toJSON()) => ({ accountId: id, x: 10, y: 1, z: 10, yaw: 0, health: 100, coins: 100, inventory, journal: {} });

  it('commits quest, hidden score and each milestone exactly once under concurrent retries', async () => {
    await Promise.all(Array.from({ length: 12 }, () => withTransaction(pool, (db) => service.record(db, account, { id: 'mission:one', points: 1000 }))));
    const view = await service.view(account);
    expect(view.rank.title).toBe('Binh Nhì I');
    expect(view.milestones.filter((m) => m.awarded)).toHaveLength(6);
    expect(view.armory).toHaveLength(DEFAULT_RANK_CONFIG.rewards.slice(1, 6).flat().length);
    expect(JSON.stringify(view)).not.toMatch(/score|threshold|Points/);
    const before = view.armory.length;
    await states.saveMany([{ ...state(), careerEvent: { id: 'death:one', death: true } }]);
    expect((await service.title(account)).title).toBe('Tân Binh V');
    await states.saveMany([{ ...state(), careerEvent: { id: 'mission:two', points: 80 } }]);
    expect((await service.title(account)).title).toBe('Binh Nhì I');
    expect((await service.view(account)).armory).toHaveLength(before);
  });
  it('rolls back the world state, score and rewards together on a failed career mutation', async () => {
    const before = await states.load(account);
    await expect(states.saveMany([{ ...state(), coins: 9999, careerEvent: { id: 'rollback', points: Number.NaN } }])).rejects.toThrow();
    expect((await states.load(account))?.coins).toBe(before?.coins);
    expect((await pool.query('SELECT * FROM career_events WHERE event_id = $1', ['rollback'])).rows).toHaveLength(0);
  });
  it('checks ownership, consumes a parcel once and persists the camp delivery atomically', async () => {
    const view = await service.view(account), coins = view.armory.find((r) => r.kind === 'coins')!;
    await expect(service.deploy(other, coins.key)).rejects.toThrow();
    const attempts = await Promise.allSettled([service.deploy(account, coins.key), service.deploy(account, coins.key)]);
    expect(attempts.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const delivered = await states.deliverRequisitions(state());
    expect(delivered.coins).toBe(100 + coins.quantity);
    const loaded = await states.load(account);
    expect(loaded?.coins).toBe(delivered.coins);
    expect((await service.view(account)).pendingSurvival).toBe(0);
    expect((await states.deliverRequisitions(loaded!)).coins).toBe(delivered.coins);
  });
  it('retains an equipment parcel when the camp stash is full and delivers it after space is freed', async () => {
    const gun = (await service.view(account)).armory.find((r) => r.kind === 'item' && r.id === 'ak47')!;
    await service.deploy(account, gun.key);
    const full = new InventoryModel();
    while (full.addToStash('potato')) { /* fill every page */ }
    const first = await states.deliverRequisitions(state(account, full.toJSON()));
    expect(new InventoryModel(first.inventory!).countOf('ak47')).toBe(0);
    expect((await service.view(account)).pendingSurvival).toBe(1);
    const next = await states.deliverRequisitions(state());
    expect(new InventoryModel(next.inventory!).items.some((r) => r.itemId === 'ak47' && r.container.startsWith('stash'))).toBe(true);
    expect((await service.view(account)).pendingSurvival).toBe(0);
  });
  it('loads global config across worlds and keeps the score private', async () => {
    await service.configure({ ...DEFAULT_RANK_CONFIG, deathBase: 55 });
    const elsewhere = new ProgressionService(pool, 'another-mode');
    await elsewhere.initialize();
    expect(elsewhere.config.deathBase).toBe(55);
    expect((await elsewhere.view(account)).rank).toEqual((await service.view(account)).rank);
  });
});
