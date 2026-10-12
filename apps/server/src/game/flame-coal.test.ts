import { describe, expect, it, vi } from 'vitest';
import { CollisionWorld, Heightfield, Layer, makeBox, makeRayHit } from '@zion/physics';
import { DEFAULT_BASE_LIFE, WEAPON_SPECS, WeaponId, type ClientMessage, type CookingBatch, type GunSpec } from '@zion/shared';
import type { CampSite } from '@zion/worldgen';
import { BaseLife, type LifeWorld } from './base-life';
import { GameServer } from './game-server';
import { Livestock } from './livestock';
import { Player } from './player';
import type { ClientSession } from './session';

interface Harness {
  life: BaseLife;
  lifeWorld: LifeWorld;
  animals: Map<string, Livestock>;
  players: Map<number, Player>;
  tryFlame(p: Player, spec: GunSpec, now: number): void;
  stepBurning(now: number): void;
  onLife(p: Player, msg: Extract<ClientMessage, { t: 'life' }>): Promise<void>;
  commitLife(p: Player, msg: Extract<ClientMessage, { t: 'life' }>, timed: boolean, batch?: CookingBatch): Promise<void>;
}
function setup(water = NaN) {
  const collision = new CollisionWorld({ worldSize: 64, seaLevel: -10 });
  for (let x = 0; x < 2; x++) for (let z = 0; z < 2; z++) collision.addChunk(x, z,
    new Heightfield(x * 32, z * 32, 1, 33, new Float32Array(1089), new Float32Array(1089).fill(water)), []);
  const life = new BaseLife(structuredClone(DEFAULT_BASE_LIFE));
  const session = { open: true, sendJson: vi.fn() } as unknown as ClientSession;
  const p = new Player(1, 'a', 'A', session, 16, 0, 16);
  p.active = true; p.life = life.initial();
  const saveMany = vi.fn(async () => {}), dropAnimalLoot = vi.fn();
  const server = Object.assign(Object.create(GameServer.prototype), {
    deps: { world: { generator: { camp: { x: 32, y: 0, z: 32 } } }, playerStates: { saveMany } },
    collision, blastHit: makeRayHit(), life, lifeWorld: { plots: {}, nextGrowth: 0 }, lifeBusy: false,
    animals: new Map(), players: new Map([[p.id, p]]), wild: new Map(),
    zombies: { near: () => [], zombies: new Map(), alert: vi.fn() },
    vegetation: { burn: vi.fn() }, grid: { query: () => [] }, scratch: [],
    useRound: vi.fn(() => true), broadcastAt: vi.fn(), broadcastNear: vi.fn(), dropAnimalLoot,
    sendLife: vi.fn(), sendInv: vi.fn(), sendQuests: vi.fn(), log: { error: vi.fn() },
    quests: { event: vi.fn() },
  }) as Harness;
  return { server, p, collision, saveMany, dropAnimalLoot };
}
function addAnimal(server: Harness, collision: CollisionWorld, index: number, x = 16, z = 12) {
  const def = DEFAULT_BASE_LIFE.animals![index]!;
  const animal = new Livestock(100 + index, def, { x: 16, y: 0, z: 16 } as CampSite,
    { x, y: 0, z, health: def.health, loot: 0 }, collision, () => .5);
  animal.active = true;
  server.animals.set(String(index), animal);
  return animal;
}

describe('flamethrower hunting', () => {
  it.each([0, 1])('damages animal %i and cooks its loot on a fatal flame hit', index => {
    const { server, p, collision, dropAnimalLoot } = setup();
    const animal = addAnimal(server, collision, index);
    animal.record.health = 5;
    server.tryFlame(p, WEAPON_SPECS[WeaponId.Flamethrower] as GunSpec, 100);
    expect(animal.dead).toBe(true);
    expect(animal.lootItem).toBe(index === 0 ? 'cooked_mutton' : 'cooked_porkchop');
    expect(dropAnimalLoot).toHaveBeenCalledOnce();
  });
  it('ignites animals and cooks an afterburn kill even after the attacker disconnects', () => {
    const { server, p, collision, dropAnimalLoot } = setup();
    const animal = addAnimal(server, collision, 0);
    server.tryFlame(p, WEAPON_SPECS[WeaponId.Flamethrower] as GunSpec, 100);
    expect(animal.record.health).toBe(animal.def.health - 5);
    expect(animal.burnUntil).toBeGreaterThan(600);
    animal.record.health = 1; server.players.clear();
    server.stepBurning(600);
    expect(animal.dead).toBe(true); expect(animal.lootItem).toBe('cooked_mutton');
    server.stepBurning(1100); expect(dropAnimalLoot).toHaveBeenCalledOnce();
  });
  it('respects walls and cone direction, and a later bullet kill still drops raw meat', () => {
    const { server, p, collision } = setup();
    const animal = addAnimal(server, collision, 0), behind = addAnimal(server, collision, 1, 16, 20);
    collision.setOwnerColliders(1, [{ shape: makeBox(16, 1, 14, 2, 2, .1), layer: Layer.Static }]);
    server.tryFlame(p, WEAPON_SPECS[WeaponId.Flamethrower] as GunSpec, 100);
    expect(animal.record.health).toBe(animal.def.health); expect(behind.record.health).toBe(behind.def.health);
    animal.hit(1, p, 200, true); animal.hit(1000, p, 300);
    expect(animal.lootItem).toBe('raw_mutton');
    animal.respawn(); expect(animal.record.cooked).toBeUndefined(); expect(animal.burnUntil).toBe(0);
  });
});

describe('portable cooking coals', () => {
  const ignite = (uid: number) => ({ t: 'life', op: 'ignite', target: 'coal_carton', uid } as const);
  it('places two ten-minute fires, consumes one charge per placement and cooks outside camp', async () => {
    const { server, p, saveMany } = setup();
    const carton = p.inv.add('coal_carton')!;
    expect(carton.count).toBe(2);
    await server.onLife(p, ignite(carton.uid));
    expect(p.inv.carriedItem(carton.uid)?.count).toBe(1);
    const first = Object.values(server.lifeWorld.coals!)[0]!;
    expect(first).toMatchObject({ x: 16, y: 0, z: 14 });
    expect(first.expiresAt - Date.now()).toBeGreaterThan(599_000);
    p.inv.add('raw_porkchop');
    await server.onLife(p, { t: 'life', op: 'cook', target: first.id });
    const action = p.lifeAction!; expect(action.kind).toBe('cook');
    p.lifeAction = null;
    await server.commitLife(p, { t: 'life', op: 'cook', target: first.id }, true, action.cookBatch);
    expect(p.inv.countOf('cooked_porkchop')).toBe(1);
    p.state.x += 4;
    await server.onLife(p, ignite(carton.uid));
    expect(p.inv.carriedItem(carton.uid)).toBeNull();
    expect(Object.keys(server.lifeWorld.coals!)).toHaveLength(2);
    await server.onLife(p, ignite(carton.uid));
    expect(Object.keys(server.lifeWorld.coals!)).toHaveLength(2);
    expect(saveMany).toHaveBeenCalledTimes(3);
    expect(server.life.expireCoals(server.lifeWorld, first.expiresAt + 600_000)).toBe(true);
    expect(server.lifeWorld.coals).toEqual({});
  });
  it('keeps the carton and world unchanged if persistence fails', async () => {
    const { server, p, saveMany } = setup();
    const carton = p.inv.add('coal_carton')!;
    saveMany.mockRejectedValueOnce(new Error('database unavailable'));
    await server.onLife(p, ignite(carton.uid));
    expect(p.inv.carriedItem(carton.uid)?.count).toBe(2);
    expect(server.lifeWorld.coals).toBeUndefined();
  });
  it.each(['wall', 'water', 'unloaded'] as const)('rejects placement at %s without consuming coal', async obstacle => {
    const { server, p, collision, saveMany } = setup(obstacle === 'water' ? 1 : NaN);
    const carton = p.inv.add('coal_carton')!;
    if (obstacle === 'wall') collision.setOwnerColliders(1, [{ shape: makeBox(16, 1, 15, 2, 2, .1), layer: Layer.Static }]);
    if (obstacle === 'unloaded') p.state.x = 100;
    await server.onLife(p, ignite(carton.uid));
    expect(saveMany).not.toHaveBeenCalled(); expect(carton.count).toBe(2);
  });
  it('refuses cooking that outlasts the fire and preserves ingredients if it expires mid-action', async () => {
    const { server, p } = setup();
    const carton = p.inv.add('coal_carton')!;
    await server.onLife(p, ignite(carton.uid));
    const fire = Object.values(server.lifeWorld.coals!)[0]!;
    p.inv.add('raw_mutton'); fire.expiresAt = Date.now() + 1;
    await server.onLife(p, { t: 'life', op: 'cook', target: fire.id }); expect(p.lifeAction).toBeNull();
    fire.expiresAt = Date.now() + 60_000;
    await server.onLife(p, { t: 'life', op: 'cook', target: fire.id });
    const action = p.lifeAction!; p.lifeAction = null; fire.expiresAt = Date.now() - 1;
    await server.commitLife(p, { t: 'life', op: 'cook', target: fire.id }, true, action.cookBatch);
    expect(p.inv.countOf('raw_mutton')).toBe(1); expect(p.inv.countOf('cooked_mutton')).toBe(0);
  });
});
