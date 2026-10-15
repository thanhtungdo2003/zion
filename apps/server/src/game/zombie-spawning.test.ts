import { afterEach, describe, expect, it, vi } from 'vitest';
import { CollisionWorld, Heightfield } from '@zion/physics';
import { EntityFlags, TICK_DT, ZombieVariant, zombieVariant, type EntityState } from '@zion/shared';
import { Zombie, ZombieDirector } from './zombies';
import type { Player } from './player';
import type { SpawnService } from './spawn';

interface DirectorHarness {
  spawnMap(players: readonly Player[], now: number, night: boolean): void;
  reinforce(z: Zombie, players: readonly Player[], now: number): void;
  spawnIndoors(players: readonly Player[], now: number, night: boolean): void;
}
function player(x: number, z: number): Player {
  return { active: true, dead: false, state: { x, y: 0, z }, suspendedZombies: [] } as unknown as Player;
}
function setup(darkness = 1) {
  const spawns = {
    loadedZombieChunks: () => [[2, 2] as const],
    validateAt: (x: number, z: number) => ({ x, y: .02, z }),
    allowsZombieSpawn: () => true,
    zombieDarkness: () => darkness,
    // Upstairs in a building 30 m away.
    indoorSpots: () => [{ x: 38, y: 3.4, z: 8 }],
    validateIndoor: (x: number, y: number, z: number) => ({ x, y: y + .02, z }),
  } as unknown as SpawnService;
  const director = new ZombieDirector({} as CollisionWorld, spawns, { attackPlayer: vi.fn() });
  return { director, harness: director as unknown as DirectorHarness };
}
afterEach(() => vi.restoreAllMocks());

describe('shared map zombie population', () => {
  it('spawns one scout and overlapping players do not multiply the population', () => {
    vi.spyOn(Math, 'random').mockReturnValue(.2);
    const a = setup(), b = setup();
    a.harness.spawnMap([player(8, 8)], 0, true);
    b.harness.spawnMap([player(8, 8), player(8, 8)], 0, true);
    expect(a.director.zombies.size).toBe(1);
    expect(b.director.zombies.size).toBe(1);
    expect([...a.director.zombies.values()][0]!.recruitsLeft).toBe(2);
    a.harness.spawnMap([player(8, 8)], 2000, true);
    expect(a.director.zombies.size).toBe(1);
  });

  it('prefers dark regions and respects the minimum distance to every player', () => {
    vi.spyOn(Math, 'random').mockReturnValue(.2);
    const dark = setup(), light = setup(.12), close = setup();
    dark.harness.spawnMap([player(8, 8)], 0, false);
    light.harness.spawnMap([player(8, 8)], 0, false);
    close.harness.spawnMap([player(8, 8), player(70, 70)], 0, true);
    expect(dark.director.zombies.size).toBe(1);
    expect(light.director.zombies.size).toBe(0);
    expect(close.director.zombies.size).toBe(0);
  });

  it('lurks indoors, upper floors included, with a cooldown per spot and away from players', () => {
    vi.spyOn(Math, 'random').mockReturnValue(.2);
    const { director, harness } = setup();
    harness.spawnIndoors([player(8, 8)], 0, false);
    expect(director.zombies.size).toBe(1);
    const z = [...director.zombies.values()][0]!;
    expect(z.state.y).toBeCloseTo(3.42, 5);
    director.zombies.clear();
    harness.spawnIndoors([player(8, 8)], 2000, false);
    expect(director.zombies.size).toBe(0);
    // Never right next to a player.
    const near = setup();
    near.harness.spawnIndoors([player(30, 8)], 0, true);
    expect(near.director.zombies.size).toBe(0);
  });

  it('recruits separately after detection, with a cooldown and no recursive recruitment', () => {
    vi.spyOn(Math, 'random').mockReturnValue(.5);
    const { director, harness } = setup();
    const scout = new Zombie(1_000_500, 180, 0, 128);
    const p = player(128, 128);
    scout.recruitsLeft = 3;
    director.zombies.set(scout.id, scout);
    harness.reinforce(scout, [p], 0);
    expect(director.zombies.size).toBe(1);
    scout.target = p;
    harness.reinforce(scout, [p], 0);
    expect(director.zombies.size).toBe(2);
    expect(scout.recruitsLeft).toBe(2);
    const recruit = [...director.zombies.values()].find(z => z !== scout)!;
    expect(recruit.recruitsLeft).toBe(0);
    expect(Math.hypot(recruit.state.x - scout.state.x, recruit.state.z - scout.state.z)).toBeGreaterThan(10);
    harness.reinforce(scout, [p], 1000);
    expect(director.zombies.size).toBe(2);
  });
});

describe('crimson zombie leap', () => {
  it('has reduced health, leaps toward its target, lands and waits before another jump', () => {
    const collision = new CollisionWorld({ worldSize: 96, seaLevel: -50 });
    for (let x = 0; x < 3; x++) for (let z = 0; z < 3; z++) {
      collision.addChunk(x, z, new Heightfield(x * 32, z * 32, 1, 33, new Float32Array(1089), new Float32Array(1089).fill(NaN)), []);
    }
    const spawns = { loadedZombieChunks: () => [], indoorSpots: () => [] } as unknown as SpawnService;
    const director = new ZombieDirector(collision, spawns, { attackPlayer: vi.fn() });
    const z = new Zombie(1_000_001, 40, .02, 40, ZombieVariant.Crimson);
    const p = player(40, 30);
    z.target = p; z.jumpReadyAt = 1;
    director.zombies.set(z.id, z);
    director.step([p], 50, .5);
    expect(z.state.grounded).toBe(true);
    director.step([p], 700, .5);
    expect(z.health).toBe(65);
    expect(z.state.vy).toBeGreaterThan(0);
    expect(z.state.vz).toBeLessThan(0);
    const entities: EntityState[] = [];
    director.entitiesFor(p, 700, entities);
    expect(entities[0]!.flags & EntityFlags.Leaping).toBeTruthy();
    expect(zombieVariant(entities[0]!.weapon)).toBe(ZombieVariant.Crimson);
    const cooldown = z.jumpReadyAt;
    let peak = z.state.y;
    for (let i = 1; i <= 60; i++) {
      director.step([p], 700 + i * TICK_DT * 1000, .5);
      peak = Math.max(peak, z.state.y);
    }
    expect(peak).toBeGreaterThan(1.5);
    expect(z.state.grounded).toBe(true);
    expect(z.state.z).toBeLessThan(36);
    expect(z.jumpReadyAt).toBe(cooldown);
  });
});

describe('zombie detection', () => {
  interface DetectHarness { detect(z: Zombie, players: readonly Player[], sense: number): void }
  function detector(visible: () => boolean) {
    const collision = { lineOfSight: vi.fn(visible) } as unknown as CollisionWorld;
    const director = new ZombieDirector(collision, { loadedZombieChunks: () => [], indoorSpots: () => [] } as unknown as SpawnService, { attackPlayer: vi.fn() });
    return { director, harness: director as unknown as DetectHarness };
  }
  const ticks = (ms: number) => Math.ceil(ms / (TICK_DT * 1000));

  it('never targets a player hidden behind cover, however close', () => {
    const { harness } = detector(() => false);
    const z = new Zombie(1_000_010, 0, 0, 0), p = player(1, 0);
    for (let i = 0; i < ticks(10_000); i++) harness.detect(z, [p], 22);
    expect(z.target).toBeNull();
  });

  it('commits on the very first detection tick when the player is visible', () => {
    const { harness } = detector(() => true);
    const z = new Zombie(1_000_011, 0, 0, 0), p = player(5, 0);
    harness.detect(z, [p], 22);
    expect(z.target).toBe(p);
  });

  it('reduces detection range to 35% for a prone player, while detecting them close up', () => {
    const { harness } = detector(() => true);
    const z = new Zombie(1_000_012, 0, 0, 0), p = player(5, 0);
    p.state.prone = true; p.state.x = 10;
    harness.detect(z, [p], 22);
    expect(z.target).toBeNull();
    p.state.x = 5;
    harness.detect(z, [p], 22);
    expect(z.target).toBe(p);
  });

  it('getting shot commits immediately', () => {
    const { director } = detector(() => false);
    const z = new Zombie(1_000_014, 0, 0, 0), p = player(30, 0);
    director.hit(z, 'torso', 1, 1, 0, 0, 0, p);
    expect(z.target).toBe(p);
  });
});
