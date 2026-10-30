import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CollisionWorld, Heightfield, Layer, makeBox } from '@zion/physics';
import { WEAPON_BY_ITEM } from '@zion/shared';
import { BattleBotDirector, type BotHooks, type BotWorld } from './battle-bots';

/**
 * Bots on a field cut by a long fence (its only gap 150 m along), houses and a dead-end pocket:
 * a squad sent beyond it finds the gap and arrives, apart from one another, in bounded time.
 */
function field() {
  const w = new CollisionWorld({ worldSize: 256, seaLevel: 0 });
  for (let x = 0; x < 8; x++) for (let z = 0; z < 8; z++) w.addChunk(x, z, new Heightfield(x * 32, z * 32, 1, 33, new Float32Array(1089).fill(10), new Float32Array(1089).fill(NaN)), []);
  const box = (cx: number, cz: number, hx: number, hz: number, h = 2) => ({ shape: makeBox(cx, 10 + h / 2, cz, hx, h / 2, hz), layer: Layer.Static });
  // The fence (x 0–200 at z 128), a U-shaped pocket opening south below it, two houses beyond.
  w.setOwnerColliders(1, [box(100, 128, 100, .1), box(30, 112, .1, 16), box(70, 112, .1, 16), box(60, 160, 6, 6, 6), box(90, 175, 6, 6, 6)]);
  return w;
}
const world: BotWorld = { phase: 'running', circle: { x: 128, z: 128, radius: 400 }, nextCircle: { x: 128, z: 128, radius: 400 }, shrinking: false, remainingMs: 1e9, plane: null };

describe('battlefield bots find their way', () => {
  beforeEach(() => { let seed = 11; vi.spyOn(Math, 'random').mockImplementation(() => (seed = (seed * 16807) % 2147483647) / 2147483647); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('a squad sent past a long fence goes round by its far gap and arrives, not bunched', () => {
    const hooks: BotHooks = { shot: () => {}, projectile: () => {}, projectileEnd: () => {}, hitPlayer: () => {}, died: () => {}, chests: () => [], loot: () => [], enemy: () => false };
    const director = new BattleBotDirector(field(), hooks);
    const squad = [0, 1, 2, 3].map((i) => {
      const b = director.spawn(40 + i * 4, 10, 116);
      b.state.x = 40 + i * 4; b.state.z = 116; b.squad = 'blue-1';
      b.objective = { x: 50 + i * 2, y: 10, z: 165, radius: 3 };
      // Armed as a deployed warfare bot (a bot with no gun goes looting instead).
      b.gunItem = { uid: 1, itemId: 'ak47', container: 'primary', x: 0, y: 0, rotated: false, mag: 30 }; b.items = [b.gunItem]; b.weapon = WEAPON_BY_ITEM.ak47!; b.infiniteAmmo = true;
      return b;
    });
    let ms = 0, worstTick = 0;
    for (let i = 0; i < 30 * 150 && squad.some((b) => Math.hypot(b.state.x - b.objective!.x, b.state.z - b.objective!.z) > 5); i++) {
      const t0 = performance.now();
      director.step(i * 1000 / 30, i, world, []);
      worstTick = Math.max(worstTick, performance.now() - t0); ms = i * 1000 / 30;
    }
    for (const b of squad) expect(Math.hypot(b.state.x - b.objective!.x, b.state.z - b.objective!.z)).toBeLessThan(5);
    // Through the gap (beyond x 200), in well under the time limit, and spread out on arrival.
    expect(ms).toBeLessThan(140_000);
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) expect(Math.hypot(squad[i]!.state.x - squad[j]!.state.x, squad[i]!.state.z - squad[j]!.state.z)).toBeGreaterThan(.6);
    expect(worstTick).toBeLessThan(60);
  }, 300_000);
});
