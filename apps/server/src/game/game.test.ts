import { describe, expect, it } from 'vitest';
import { CollisionWorld, Heightfield, Layer, makeBox } from '@zion/physics';
import { InputBudget, SuspicionTracker, sanitizeChat } from './anticheat';
import { lodForDistance } from './chunk-streamer';
import { aimDirection, resolveBladeSweep, resolveMelee } from './combat';
import { InterestGrid } from './interest';
import { Player, PoseHistory } from './player';
import type { ClientSession } from './session';
import { KeyedWindowLimiter, TokenBucket } from '../security/rate-limit';

describe('rate limiting', () => {
  it('token bucket enforces sustained rate and burst', () => {
    const b = new TokenBucket(10, 5, 0);
    let ok = 0;
    for (let i = 0; i < 20; i++) if (b.take(1, 0)) ok++;
    expect(ok).toBe(5);
    expect(b.take(1, 100)).toBe(true); // +1 token after 100 ms
    expect(b.take(1, 100)).toBe(false);
  });

  it('keyed window limiter isolates keys and resets per window', () => {
    const l = new KeyedWindowLimiter(2, 1000);
    expect([l.hit('a', 0), l.hit('a', 1), l.hit('a', 2)]).toEqual([true, true, false]);
    expect(l.hit('b', 2)).toBe(true);
    expect(l.hit('a', 1001)).toBe(true);
  });
});

describe('anti-cheat', () => {
  it('input budget caps simulation steps to real time (speed-hack protection)', () => {
    const budget = new InputBudget(8, 0);
    let consumed = 0;
    // A client sending 3 inputs per server tick for 100 ticks…
    for (let tick = 0; tick < 100; tick++) {
      budget.earn();
      for (let k = 0; k < 3; k++) if (budget.tryConsume()) consumed++;
    }
    // …still only gets one step per tick.
    expect(consumed).toBe(100);
  });

  it('suspicion decays over time and trips the threshold under sustained abuse', () => {
    const t = new SuspicionTracker(10, 1, 0);
    expect(t.add('sequence_replay', undefined, 0)).toBe(false); // 6
    expect(t.current(4000)).toBeCloseTo(2, 5);
    expect(t.add('movement_anomaly', undefined, 4000)).toBe(true); // 2 + 8
  });

  it('sanitizes chat control and bidi characters', () => {
    expect(sanitizeChat('  hi\u0000 there‮  \n  friend ')).toBe('hi there friend');
  });
});

describe('streaming and interest management', () => {
  it('maps distance to LOD rings', () => {
    expect([0, 3, 4, 7, 8, 14, 15].map(lodForDistance)).toEqual([0, 0, 1, 1, 2, 2, -1]);
  });

  it('interest grid returns only nearby entities', () => {
    const grid = new InterestGrid<{ id: number; x(): number; z(): number }>();
    const mk = (id: number, x: number, z: number) => ({ id, x: () => x, z: () => z });
    const a = mk(1, 10, 10);
    const b = mk(2, 40, 10);
    const c = mk(3, 1000, 1000);
    [a, b, c].forEach((e) => grid.update(e));
    expect(grid.query(0, 0, 1, []).map((e) => e.id).sort()).toEqual([1, 2]);
    grid.remove(b);
    expect(grid.query(0, 0, 1, []).map((e) => e.id)).toEqual([1]);
  });
});

describe('lag compensation', () => {
  it('pose history interpolates between recorded ticks and clamps outside', () => {
    const h = new PoseHistory();
    h.push(0, 0, 0, 0, 0);
    h.push(100, 10, 0, 0, 0);
    const out = { t: 0, x: 0, y: 0, z: 0, yaw: 0 };
    h.sample(50, out);
    expect(out.x).toBeCloseTo(5);
    h.sample(500, out);
    expect(out.x).toBe(10);
    h.sample(-50, out);
    expect(out.x).toBe(0);
  });

  function flatWorld(colliders: Parameters<CollisionWorld['addChunk']>[3] = []): CollisionWorld {
    const w = new CollisionWorld({ worldSize: 64, seaLevel: -10 });
    for (let cx = 0; cx < 2; cx++) {
      for (let cz = 0; cz < 2; cz++) {
        w.addChunk(cx, cz, new Heightfield(cx * 32, cz * 32, 1, 33, new Float32Array(33 * 33), new Float32Array(33 * 33).fill(Number.NaN)), cx + cz === 0 ? colliders : []);
      }
    }
    return w;
  }

  function player(id: number, x: number, z: number, history: Array<[number, number, number]>): Player {
    const p = new Player(id, `acc-${id}`, `p${id}`, {} as ClientSession, x, 0, z);
    p.active = true;
    for (const [t, hx, hz] of history) p.history.push(t, hx, 0, hz, 0);
    return p;
  }

  it('hits a target where the attacker saw it (rewound), not where it is now', () => {
    const attacker = player(1, 10, 10, [[1000, 10, 10]]);
    attacker.yaw = 0; // facing −Z
    attacker.pitch = -0.2;
    // Target was 1.5 m in front 150 ms ago, has since moved 3 m sideways.
    const target = player(2, 13, 8.5, [
      [850, 10, 8.5],
      [1000, 13, 8.5],
    ]);
    const world = flatWorld();
    expect(resolveMelee(attacker, [target], world, 1000, undefined)).toBeNull();
    const hit = resolveMelee(attacker, [target], world, 1000, 850);
    expect(hit?.target).toBe(target);
    expect(hit?.rewoundMs).toBe(150);
  });

  it('never rewinds further than the lag-compensation window', () => {
    const attacker = player(1, 10, 10, [[2000, 10, 10]]);
    const target = player(2, 13, 8.5, [
      [1000, 10, 8.5],
      [2000, 13, 8.5],
    ]);
    attacker.pitch = -0.2;
    // Claimed render time 1 s in the past is clamped to 250 ms → target already moved away.
    expect(resolveMelee(attacker, [target], flatWorld(), 2000, 1000)).toBeNull();
  });

  it('walls block melee (line of sight)', () => {
    const attacker = player(1, 10, 10, [[0, 10, 10]]);
    attacker.pitch = -0.2;
    const target = player(2, 10, 8.4, [[0, 10, 8.4]]);
    expect(resolveMelee(attacker, [target], flatWorld(), 0, undefined)?.zone).toBeDefined();
    const wall = flatWorld([{ shape: makeBox(10, 1, 9.3, 2, 2, 0.05), layer: Layer.Static }]);
    expect(resolveMelee(attacker, [target], wall, 0, undefined)).toBeNull();
  });

  it('blades cut the nearest enemy in front whatever the pitch, not ones behind or out of reach', () => {
    const blade = { range: 2.6, damage: 38, halfAngle: 1.05 };
    const attacker = player(1, 10, 10, [[0, 10, 10]]);
    attacker.pitch = -0.6; // cursor far off: blades don't care
    const front = player(2, 11.2, 8.4, [[0, 11.2, 8.4]]); // ahead and off to the side
    const near = player(3, 10, 9.2, [[0, 10, 9.2]]);
    const behind = player(4, 10, 11, [[0, 10, 11]]);
    const far = player(5, 10, 6, [[0, 10, 6]]);
    expect(resolveBladeSweep(attacker, [front, behind, far], flatWorld(), 0, undefined, blade)?.target).toBe(front);
    expect(resolveBladeSweep(attacker, [front, near], flatWorld(), 0, undefined, blade)?.target).toBe(near);
    expect(resolveBladeSweep(attacker, [behind, far], flatWorld(), 0, undefined, blade)).toBeNull();
    const wall = flatWorld([{ shape: makeBox(10, 1, 9.6, 2, 2, 0.05), layer: Layer.Static }]);
    expect(resolveBladeSweep(attacker, [near], wall, 0, undefined, blade)).toBeNull();
  });

  it('aim direction follows the camera convention', () => {
    const [x, y, z] = aimDirection(0, 0);
    expect([x, y, z].map((v) => Math.round(v * 1000) / 1000)).toEqual([-0, 0, -1]);
    expect(aimDirection(0, Math.PI / 2)[1]).toBeCloseTo(1);
  });
});
