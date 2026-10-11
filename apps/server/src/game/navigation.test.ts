import { describe, expect, it, vi } from 'vitest';
import { CollisionWorld, Heightfield, Layer, makeBox, type ColliderInit } from '@zion/physics';
import { TICK_DT, ZOMBIE_ID_BASE } from '@zion/shared';
import { WalkingMap, WalkingSearch, type NavPoint } from './navigation';
import { Zombie, ZombieDirector } from './zombies';
import type { Player } from './player';
import type { SpawnService } from './spawn';

function world(solids: ColliderInit[] = [], height = (x: number, _z: number) => x * 0): CollisionWorld {
  const result = new CollisionWorld({ worldSize: 96, seaLevel: -50 });
  for (let cx = 0; cx < 3; cx++) for (let cz = 0; cz < 3; cz++) {
    const heights = new Float32Array(33 * 33);
    for (let z = 0; z < 33; z++) for (let x = 0; x < 33; x++) heights[z * 33 + x] = height(cx * 32 + x, cz * 32 + z);
    result.addChunk(cx, cz, new Heightfield(cx * 32, cz * 32, 1, 33, heights,
      new Float32Array(33 * 33).fill(NaN)), cx === 0 && cz === 0 ? solids : []);
  }
  return result;
}

function box(x: number, z: number, hx: number, hz: number, top = 3): ColliderInit {
  return { shape: makeBox(x, top / 2, z, hx, top / 2, hz), layer: Layer.Static };
}

const point = (x: number, z: number, y = 0.01): NavPoint => ({ x, y, z });

function find(map: WalkingMap, start: NavPoint, goal: NavPoint): NavPoint[] {
  const search = new WalkingSearch(map, start, goal);
  for (let i = 0; i < 1000 && !search.done; i++) expect(search.advance(64)).toBeLessThanOrEqual(64);
  expect(search.done).toBe(true);
  return search.path;
}

describe('walking navigation', () => {
  it('takes a direct route when the capsule corridor is clear', () => {
    const map = new WalkingMap(world());
    expect(map.reaches(point(10, 10), point(25, 22))).toBe(true);
  });

  it('finds the shorter side of a wall and every segment has capsule clearance', () => {
    const map = new WalkingMap(world([box(16, 15, 0.15, 7)]));
    const start = point(10, 19);
    const goal = point(22, 19);
    expect(map.reaches(start, goal)).toBe(false);
    const path = find(map, start, goal);
    expect(path.at(-1)).toEqual(goal);
    expect(Math.max(...path.map(p => p.z))).toBeGreaterThan(22);
    expect(Math.min(...path.map(p => p.z))).toBeGreaterThan(18);
    let last = start;
    let length = 0;
    for (const next of path) {
      expect(map.reaches(last, next)).toBe(true);
      length += Math.hypot(next.x - last.x, next.z - last.z);
      last = next;
    }
    expect(length).toBeLessThan(17);
  });

  it('escapes a U-shaped obstacle even when the exit leads away from the player', () => {
    const map = new WalkingMap(world([box(16, 16, 0.15, 5), box(12, 11, 4, 0.15), box(12, 21, 4, 0.15)]));
    const path = find(map, point(13, 16), point(20, 16));
    expect(path.at(-1)).toEqual(point(20, 16));
    expect(Math.min(...path.map(p => p.x))).toBeLessThan(8);
  });

  it('uses a doorway but rejects gaps narrower than the body and thin intervening walls', () => {
    const map = new WalkingMap(world([box(16, 10, 0.03, 5.4), box(16, 22, 0.03, 5.4)]));
    expect(map.reaches(point(12, 16), point(20, 16))).toBe(true);
    expect(map.reaches(point(12, 15.5), point(20, 15.5))).toBe(false);
    const narrow = new WalkingMap(world([box(16, 10, 0.01, 5.7), box(16, 22, 0.01, 5.7)]));
    expect(narrow.reaches(point(12, 16), point(20, 16))).toBe(false);
  });

  it('accepts a low step and rejects tall ledges, ceilings, cliffs and steep terrain', () => {
    expect(new WalkingMap(world([box(16, 16, 2, 2, 0.3)])).reaches(point(12, 16), point(20, 16))).toBe(true);
    expect(new WalkingMap(world([box(16, 16, 2, 2, 0.8)])).reaches(point(12, 16), point(20, 16))).toBe(false);
    const ceiling = { shape: makeBox(16, 1.5, 16, 2, 0.1, 2), layer: Layer.Static };
    expect(new WalkingMap(world([ceiling])).reaches(point(12, 16), point(20, 16))).toBe(false);
    expect(new WalkingMap(world([], x => x * 2)).reaches(point(12, 16, 24), point(20, 16, 40))).toBe(false);
    expect(new WalkingMap(world()).trace(point(12, 16, 3), 13, 16)).toBeNull();
  });

  it('rejects deep water, unloaded chunks and world borders', () => {
    const wet = world([], () => -52);
    expect(new WalkingMap(wet).trace(point(12, 16, -52), 13, 16)).toBeNull();
    const unloaded = world();
    unloaded.removeChunk(1, 0);
    expect(new WalkingMap(unloaded).trace(point(28, 16), 35, 16)).toBeNull();
    expect(new WalkingMap(world()).trace(point(3, 16), 1, 16)).toBeNull();
  });

  it('finishes without an unsafe fallback when the target is enclosed', () => {
    const map = new WalkingMap(world([box(16, 16, 2, 2)]));
    expect(find(map, point(10, 16), point(16, 16))).toEqual([]);
  });
});

function simulation(solids: ColliderInit[], start: NavPoint, goal: NavPoint) {
  const collision = world(solids);
  const attackPlayer = vi.fn();
  const director = new ZombieDirector(collision, { validateAt: () => null, loadedZombieChunks: () => [] } as unknown as SpawnService, { attackPlayer });
  const zombie = new Zombie(ZOMBIE_ID_BASE, start.x, start.y, start.z);
  const player = { active: true, dead: false, state: { ...goal }, suspendedZombies: [] } as unknown as Player;
  zombie.target = player; // Pathfinding starts after this player has been detected.
  director.zombies.set(zombie.id, zombie);
  let tick = 0;
  return {
    collision, zombie, player, attackPlayer,
    run(ticks: number, tod = 0.5) {
      for (let i = 0; i < ticks; i++) director.step([player], tick++ * TICK_DT * 1000, tod);
    },
  };
}

describe('zombie path following', () => {
  it.each([0.5, 0.9])('walks around a wall and reaches the player at time of day %s', tod => {
    const sim = simulation([box(16, 15, 0.15, 7)], point(10, 19), point(22, 19));
    sim.run(600, tod);
    expect(sim.attackPlayer).toHaveBeenCalled();
    expect(Math.hypot(sim.zombie.state.x - 22, sim.zombie.state.z - 19)).toBeLessThan(1.5);
  });

  it('replans after a new obstacle blocks its route and follows a moving target', () => {
    const sim = simulation([], point(10, 19), point(26, 19));
    sim.run(30);
    sim.collision.setOwnerColliders(123, [box(16, 19, 0.15, 3)]);
    sim.player.state.z = 23;
    sim.run(600);
    expect(sim.attackPlayer).toHaveBeenCalled();
    expect(Math.hypot(sim.zombie.state.x - 26, sim.zombie.state.z - 23)).toBeLessThan(1.5);
  });

  it('can approach a player hugging a wall without needing to occupy the same position', () => {
    const sim = simulation([box(22, 19, 0.15, 5)], point(10, 19), point(21.49, 19));
    sim.run(450);
    expect(sim.attackPlayer).toHaveBeenCalled();
  });

  it('follows a low step using the actual character controller', () => {
    const sim = simulation([box(16, 19, 2, 3, 0.3)], point(10, 19), point(22, 19));
    sim.run(450);
    expect(sim.attackPlayer, JSON.stringify(sim.zombie.state)).toHaveBeenCalled();
  });

  it('cannot attack through a wall or reach a player far above it', () => {
    const sim = simulation([box(16, 16, 0.05, 10)], point(15.5, 16), point(16.5, 16));
    sim.run(60);
    expect(sim.attackPlayer).not.toHaveBeenCalled();
    const high = simulation([], point(15, 16), point(15.5, 16, 4));
    high.run(60);
    expect(high.attackPlayer).not.toHaveBeenCalled();
  });
});
