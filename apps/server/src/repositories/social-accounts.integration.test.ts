import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AccountRepository } from './accounts';

describe.skipIf(process.env.ZION_AUTH_INTEGRATION !== '1' || !process.env.DATABASE_URL)('PostgreSQL social identities', () => {
  const schema = `codex_auth_test_${randomUUID().replaceAll('-', '')}`;
  const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${schema}`, max: 4 });
  const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const accounts = new AccountRepository(db);
  let created = false;
  beforeAll(async () => {
    await admin.query(`CREATE SCHEMA ${schema}`); created = true;
    await db.query(await readFile(new URL('../../migrations/001_init.sql', import.meta.url), 'utf8'));
    await db.query(await readFile(new URL('../../migrations/015_social_accounts.sql', import.meta.url), 'utf8'));
    await db.query("INSERT INTO worlds (id, seed, config, generator_version) VALUES ('test', 1, '{}', 1)");
  });
  afterAll(async () => {
    await db.end();
    if (!/^codex_auth_test_[a-f0-9]{32}$/.test(schema)) throw new Error('Unexpected test schema');
    if (created) await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  });
  it('promotes a named guest without changing the UUID, name or saved character', async () => {
    const original = (await accounts.create('Tên Khách Cũ', null, true))!;
    await db.query("INSERT INTO player_states (account_id, world_id, pos_x, pos_y, pos_z, yaw, health) VALUES ($1, 'test', 10, 20, 30, 1, 67)", [original.id]);
    const linked = await accounts.social('google', 'google-guest', 'Other Name', original.id);
    expect(linked).toMatchObject({ id: original.id, username: original.username, isGuest: false });
    expect((await accounts.social('google', 'google-guest', 'Another Name'))?.id).toBe(original.id);
    expect(await accounts.identities(original.id)).toEqual(['google']);
    expect((await db.query('SELECT health, pos_x FROM player_states WHERE account_id = $1', [original.id])).rows).toEqual([{ health: 67, pos_x: 10 }]);
    expect(await accounts.social('facebook', 'fb-guest', 'Ignored', original.id)).toMatchObject({ id: original.id });
    expect(await accounts.identities(original.id)).toEqual(['facebook', 'google']);
  });
  it('serializes concurrent first logins and does not create orphan accounts', async () => {
    const before = Number((await db.query('SELECT count(*) FROM accounts')).rows[0].count);
    const sessions = await Promise.all([1, 2, 3].map(n => accounts.social('google', 'concurrent', `New_${n}`)));
    expect(sessions.every(account => account?.id === sessions[0]?.id)).toBe(true);
    expect(Number((await db.query('SELECT count(*) FROM accounts')).rows[0].count)).toBe(before + 1);
  });
  it('refuses takeover and multiple links for the same provider, leaving both guests intact', async () => {
    const a = (await accounts.create('Guest_A', null, true))!, b = (await accounts.create('Guest_B', null, true))!;
    await accounts.social('facebook', 'owned', 'Ignored', a.id);
    expect(await accounts.social('facebook', 'owned', 'Ignored', b.id)).toBeNull();
    expect(await accounts.social('facebook', 'different', 'Ignored', a.id)).toBeNull();
    expect((await accounts.findById(b.id))?.isGuest).toBe(true);
    expect(await accounts.identities(b.id)).toEqual([]);
    expect((await accounts.social('facebook', 'owned', 'Ignored'))?.id).toBe(a.id);
  });
});
