import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateBattleLoot, type PlacedItem } from '@zion/shared';
import { CollisionWorld, Heightfield } from '@zion/physics';
import { BattleBotDirector, type BotHooks, type BotWorld } from './battle-bots';

function world() {
  const w = new CollisionWorld({ worldSize: 256, seaLevel: 0 });
  for (let x = 0; x < 8; x++) for (let z = 0; z < 8; z++) w.addChunk(x, z, new Heightfield(x * 32, z * 32, 1, 33, new Float32Array(1089).fill(10), new Float32Array(1089).fill(NaN)), []);
  return w;
}
const arena: BotWorld = { phase: 'running', circle: { x: 128, z: 128, radius: 120 }, nextCircle: { x: 128, z: 128, radius: 100 }, shrinking: false, remainingMs: 60_000, plane: null };

function setup(chests: Array<{ id: string; x: number; y: number; z: number; items: PlacedItem[] }> = []) {
  const deaths: string[] = [];
  const hooks: BotHooks = {
    shot: () => {}, projectile: () => {}, projectileEnd: () => {}, hitPlayer: () => {},
    died: (bot, by) => deaths.push(`${bot.name}<${by}`),
    chests: (x, z, r) => chests.filter(c => Math.hypot(c.x - x, c.z - z) <= r),
    loot: (id, choose) => {
      const chest = chests.find(c => c.id === id)!, take = new Set(choose(chest.items));
      const taken = chest.items.filter(i => take.has(i.uid)); chest.items = chest.items.filter(i => !take.has(i.uid));
      return taken;
    },
  };
  return { director: new BattleBotDirector(world(), hooks), deaths };
}
const run = (director: BattleBotDirector, seconds: number, from = 0, state = arena) => {
  for (let i = 0; i < seconds * 30; i++) director.step(from + i * 1000 / 30, i, state, []);
};

describe('battle royale bots', () => {
  // Bots roll dice for spread, strafing and timing: seed them so the scenarios are repeatable.
  beforeEach(() => { let seed = 7; vi.spyOn(Math, 'random').mockImplementation(() => (seed = (seed * 16807) % 2147483647) / 2147483647); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('walks to a chest and arms itself with a gun, ammo and armour', () => {
    const items = generateBattleLoot([], () => .3);
    const { director } = setup([{ id: 'c1', x: 140, y: 10, z: 128, items }]);
    const bot = director.spawn(120, 10, 128);
    run(director, 12);
    expect(bot.weapon).toBeGreaterThan(0);
    expect(bot.gunItem?.mag ?? 0).toBeGreaterThan(0);
    expect(bot.searched.has('c1')).toBe(true);
  });

  it('loses its target in a smoke cloud and is blinded by a flashbang', () => {
    const items = () => generateBattleLoot(generateBattleLoot([], () => .3), () => .3);
    const { director } = setup([{ id: 'a', x: 110, y: 10, z: 128, items: items() }, { id: 'b', x: 146, y: 10, z: 128, items: items() }]);
    const a = director.spawn(108, 10, 128), b = director.spawn(148, 10, 128);
    director.smoke(128, 128, 6, 1e9);
    run(director, 20);
    expect(a.dead || b.dead).toBe(false);
    director.flash(a.state.x, a.state.y + 1, a.state.z, 10, 3000, 20_000);
    expect(a.target).toBeNull();
    expect(a.reactAt).toBeGreaterThan(20_000 + 2000);
  });

  it('heads into the next safe circle when the zone closes', () => {
    const { director } = setup();
    const bot = director.spawn(30, 10, 128);
    const closing: BotWorld = { ...arena, circle: { x: 128, z: 128, radius: 95 }, nextCircle: { x: 160, z: 128, radius: 30 }, shrinking: true };
    run(director, 10, 0, closing);
    expect(bot.state.x).toBeGreaterThan(60);
  });

  it('spots an armed rival and fights until one of them is eliminated', () => {
    const items = () => generateBattleLoot(generateBattleLoot(generateBattleLoot([], () => .3), () => .3), () => .3);
    const { director, deaths } = setup([{ id: 'a', x: 110, y: 10, z: 128, items: items() }, { id: 'b', x: 146, y: 10, z: 128, items: items() }]);
    const a = director.spawn(108, 10, 128), b = director.spawn(148, 10, 128);
    run(director, 120);
    expect(deaths.length).toBeGreaterThan(0);
    expect(a.dead !== b.dead).toBe(true);
  });

  it('skydives from the plane and lands inside the circle', () => {
    const { director } = setup();
    const bot = director.spawn(128, 10, 128);
    director.board(0, arena.circle);
    bot.jumpAt = 0;
    const plane = { x: 128, y: 200, z: 128, yaw: 0, remainingMs: 10_000 };
    run(director, 25, 0, { ...arena, plane });
    expect(bot.state.flight).toBe(0);
    expect(bot.state.y).toBeLessThan(11);
  });
  it('knocks a squad bot down instead of killing it, and a squadmate runs over and revives it', () => {
    const { director, deaths } = setup();
    const a = director.spawn(120, 10, 128), b = director.spawn(150, 10, 128);
    a.squad = b.squad = 's1'; b.role = 'gunner';
    director.hit(a, 500, 'enemy', { x: 100, z: 128 }, 0);
    expect(a.downed).toBe(true); expect(a.dead).toBe(false); expect(deaths).toEqual([]);
    run(director, 14, 100);
    expect(a.downed).toBe(false); expect(a.health).toBe(30);
    // Shot again while down, nobody left standing: dead for good.
    director.hit(b, 500, 'enemy', null, 20_000); expect(b.downed).toBe(true);
    director.hit(b, 5, 'enemy', null, 20_100); expect(b.dead).toBe(true);
  });

  it('rolls out of the way when shot', () => {
    const { director } = setup();
    const bot = director.spawn(120, 10, 128);
    run(director, 1);
    director.hit(bot, 10, 'enemy', { x: 100, z: 128 }, 2000);
    expect(bot.rollRequest).toBe(true);
    run(director, .2, 2000);
    expect(bot.state.rollTicks > 0 || bot.rollRequest === false).toBe(true);
  });
  it('without a gun, fights with a looted blade or its fists', () => {
    const { director } = setup([{ id: 'c1', x: 124, y: 10, z: 128, items: [{ uid: 1, itemId: 'machete', container: 'backpack', x: 0, y: 0, rotated: false }] }]);
    const a = director.spawn(120, 10, 128), b = director.spawn(126, 10, 128);
    a.alert = { x: 126, z: 128, until: 1e9 }; b.alert = { x: 120, z: 128, until: 1e9 };
    run(director, 8);
    expect(a.health < 100 || b.health < 100).toBe(true);
  });
  it('never fights in the lobby: no targets, and hits do nothing while the game says no', () => {
    const { director } = setup();
    const a = director.spawn(120, 10, 128), b = director.spawn(126, 10, 128);
    a.alert = { x: 126, z: 128, until: 1e9 }; b.alert = { x: 120, z: 128, until: 1e9 };
    run(director, 8, 0, { ...arena, phase: 'waiting' });
    expect(a.health).toBe(100); expect(b.health).toBe(100);
    const guarded = new BattleBotDirector(world(), { shot: () => {}, projectile: () => {}, projectileEnd: () => {}, hitPlayer: () => {}, died: () => {}, chests: () => [], loot: () => [], canHurt: () => false });
    const c = guarded.spawn(120, 10, 128);
    guarded.hit(c, 50, 'test', null, 0);
    expect(c.health).toBe(100);
  });
  it('picks up a melee weapon from a crate when it has none', () => {
    const { director } = setup([{ id: 'c1', x: 130, y: 10, z: 128, items: [{ uid: 1, itemId: 'machete', container: 'backpack', x: 0, y: 0, rotated: false }] }]);
    const bot = director.spawn(120, 10, 128);
    run(director, 8);
    expect(bot.meleeItem?.itemId).toBe('machete');
  });
});
