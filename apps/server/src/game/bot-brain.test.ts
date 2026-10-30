import { describe, expect, it } from 'vitest';
import { CollisionWorld, Heightfield, Layer, makeBox, type ColliderInit } from '@zion/physics';
import { CoarseNav, RouteState, chooseTactic, personalityOf, routeStep, separation, tacticalPosition, PERSONALITIES, type FightSituation } from './bot-brain';
import { WalkingMap, WalkingSearch } from './navigation';

/** Flat 256 m ground with solids on it. */
function world(solids: ColliderInit[]): CollisionWorld {
  const w = new CollisionWorld({ worldSize: 256, seaLevel: -10 });
  for (let cx = 0; cx < 8; cx++) for (let cz = 0; cz < 8; cz++) w.addChunk(cx, cz, new Heightfield(cx * 32, cz * 32, 1, 33, new Float32Array(1089), new Float32Array(1089).fill(NaN)), []);
  for (const s of solids) w.setOwnerColliders(Math.random() * 1e9 | 0, [s]);
  return w;
}
/** A fence (thin, 2 m high) from (x0, z0) to (x1, z1), axis-aligned. */
const fence = (x0: number, z0: number, x1: number, z1: number): ColliderInit => ({ shape: makeBox((x0 + x1) / 2, 1, (z0 + z1) / 2, Math.max(.1, Math.abs(x1 - x0) / 2), 1, Math.max(.1, Math.abs(z1 - z0) / 2)), layer: Layer.Static });
const house = (x: number, z: number, h: number): ColliderInit => ({ shape: makeBox(x, 3, z, h, 3, h), layer: Layer.Static });

/** Walks a point along routeStep's waypoints (2 m per step) until it arrives or gives up. */
function walk(nav: CoarseNav, from: { x: number; z: number }, to: { x: number; z: number }, blocked?: (x: number, z: number) => boolean) {
  const r = new RouteState(), at = { ...from }, trail: Array<{ x: number; z: number }> = [];
  for (let t = 0; t < 4000; t++) {
    nav.beginTick();
    const now = t * 33;
    if (Math.hypot(at.x - to.x, at.z - to.z) < 3) return { arrived: true, trail, r };
    const next = routeStep(nav, r, at, to, now) ?? (r.points.length || r.search ? null : to);
    if (!next) continue;
    const d = Math.hypot(next.x - at.x, next.z - at.z) || 1, nx = at.x + (next.x - at.x) / d * Math.min(d, .2), nz = at.z + (next.z - at.z) / d * Math.min(d, .2);
    // Like the character controller: blocked one way, it slides along the other.
    if (!blocked?.(nx, nz)) { at.x = nx; at.z = nz; } else if (!blocked(nx, at.z)) at.x = nx; else if (!blocked(at.x, nz)) at.z = nz;
    trail.push({ ...at });
  }
  return { arrived: false, trail, r };
}

describe('bot navigation (coarse planner)', () => {
  it('goes round a 140 m fence to its far gap, where the local search gives up', () => {
    // A fence across the field with its only gap at the far end (x 220–236).
    const w = world([fence(0, 128, 220, 128)]);
    const local = new WalkingSearch(new WalkingMap(w), { x: 40, y: 0, z: 100 }, { x: 40, y: 0, z: 160 }, 20_000);
    for (let i = 0; i < 400 && !local.done; i++) local.advance(200);
    expect(local.path.length).toBe(0);
    const nav = new CoarseNav(w), run = walk(nav, { x: 40, z: 100 }, { x: 40, z: 160 }, (x, z) => Math.abs(z - 128) < .4 && x < 220);
    expect(run.arrived).toBe(true);
    // It went through the gap.
    expect(run.trail.some((p) => p.x > 218 && Math.abs(p.z - 128) < 4)).toBe(true);
  });

  it('backs out of a dead end and finds the way round houses', () => {
    // A U-shaped pocket open to the south, the goal beyond its closed north wall; houses round it.
    const w = world([fence(60, 140, 100, 140), fence(60, 100, 60, 140), fence(100, 100, 100, 140), house(130, 150, 6), house(40, 170, 6)]);
    const nav = new CoarseNav(w), run = walk(nav, { x: 80, z: 120 }, { x: 80, z: 175 }, (x, z) => (Math.abs(z - 140) < .4 && x > 60 && x < 100) || (Math.abs(x - 60) < .4 && z > 100 && z < 140) || (Math.abs(x - 100) < .4 && z > 100 && z < 140));
    expect(run.arrived).toBe(true);
  });

  it('remembers an edge a bot got stuck on (shared) and plans round it', () => {
    // An invisible snag: the planner thinks the gap is open but the walker cannot pass there.
    const w = world([fence(0, 128, 120, 128), fence(136, 128, 256, 128)]);
    const nav = new CoarseNav(w);
    // The walker cannot use the gap at x 120–136 (something the grid did not see), so it must
    // give up on it; with no other way it reports the goal unreachable instead of looping.
    const run = walk(nav, { x: 128, z: 110 }, { x: 128, z: 150 }, (_x, z) => Math.abs(z - 128) < 1.5);
    expect(run.arrived).toBe(false);
    expect(run.r.blockedUntil).toBeGreaterThan(0);
    expect(nav.stats.searches).toBeGreaterThan(1);
  });

  it('plans within a bounded budget per tick for many bots at once', () => {
    const w = world([fence(0, 128, 220, 128)]), nav = new CoarseNav(w, 700, 2.5);
    const routes = Array.from({ length: 40 }, () => new RouteState());
    let worst = 0;
    for (let t = 0; t < 1500 && routes.some((r) => !r.points.length); t++) {
      const t0 = performance.now();
      nav.beginTick();
      worst = Math.max(worst, performance.now() - t0);
      // (Standing still, so asked only until each has its route: it would otherwise count as stuck.)
      routes.forEach((r, i) => { if (!r.points.length) routeStep(nav, r, { x: 20 + i * 4, z: 100 }, { x: 20 + i * 4, z: 160 }, t * 33); });
    }
    expect(routes.every((r) => r.points.length > 0)).toBe(true);
    expect(worst).toBeLessThan(25);
  });
});

describe('bot tactics', () => {
  const base: FightSituation = { health: 100, distance: 25, reloading: false, allies: 2, enemies: 1, fightSec: 2, hurtSec: 10, coverNear: true };
  it('personalities choose differently in the same fight', () => {
    const picks = new Set(PERSONALITIES.map((p) => chooseTactic(p, { ...base, health: 45, hurtSec: 1, fightSec: 8 }, null)));
    expect(picks.size).toBeGreaterThan(1);
    expect(chooseTactic(PERSONALITIES[0]!, { ...base, distance: 60 }, null)).toBe('push');
    expect(chooseTactic(PERSONALITIES[3]!, { ...base, health: 30, enemies: 3, allies: 0 }, null)).toBe('fallback');
    expect(chooseTactic(PERSONALITIES[2]!, { ...base, reloading: true, hurtSec: 1 }, null)).toBe('cover');
  });

  it('sticks with a tactic unless another is clearly better', () => {
    const p = personalityOf(7), s = { ...base };
    const first = chooseTactic(p, s, null);
    expect(chooseTactic(p, { ...s, distance: s.distance + 1 }, first)).toBe(first);
  });

  it('scores firing positions: sight of the target, cover in front, away from teammates', () => {
    // A low wall 3 m east of the bot between it and the target.
    const w = world([{ shape: makeBox(103, .45, 100, .2, .45, 6), layer: Layer.Static }]);
    const spot = tacticalPosition(w, { x: 100, y: 0, z: 100 }, { x: 130, y: 0, z: 100 }, PERSONALITIES[2]!, [{ x: 112, z: 100 }], 0)!;
    expect(spot).not.toBeNull();
    expect(Math.hypot(spot.x - 112, spot.z - 100)).toBeGreaterThan(3);
  });

  it('separates teammates that bunch up', () => {
    const push = separation({ x: 0, z: 0 }, [{ x: .5, z: 0 }, { x: 0, z: -.6 }]);
    expect(push.x).toBeLessThan(0);
    expect(push.z).toBeGreaterThan(0);
  });
});
