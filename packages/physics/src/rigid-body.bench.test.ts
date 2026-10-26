import { describe, expect, it } from 'vitest';
import { CollisionWorld } from './world';
import { Heightfield } from './heightfield';
import { JoltVehicles, MAX_FREE_BODIES, loadJolt } from './jolt-vehicles';
import { yawPose } from './rigid-body';

/**
 * Optional, bounded load test of free rigid bodies (skipped unless ZION_BENCH=1):
 *   ZION_BENCH=1 npx vitest run packages/physics/src/rigid-body.bench.test.ts --maxWorkers=1
 * Steps 8 → MAX_FREE_BODIES crates dropped in a heap for at most 4 simulated seconds each, at the
 * server's 30 Hz tick (two 60 Hz substeps), and stops early if a step blows the time budget or
 * the heap grows past the memory limit. Prints one line per load level.
 */
const BUDGET_MS = 8;
const HEAP_LIMIT_MB = 900;

describe.skipIf(!process.env.ZION_BENCH)('free rigid body load (opt-in)', () => {
  it('stays inside the per-tick budget as the heap grows', async () => {
    await loadJolt();
    const world = new CollisionWorld({ worldSize: 96, seaLevel: -10 });
    for (let x = 0; x < 3; x++) for (let z = 0; z < 3; z++) world.addChunk(x, z, new Heightfield(x * 32, z * 32, 1, 33, new Float32Array(1089), new Float32Array(1089).fill(NaN)), []);
    const rows: string[] = [];
    for (const count of [8, 24, 48, MAX_FREE_BODIES]) {
      const sim = new JoltVehicles(world);
      try {
        for (let i = 0; i < count; i++) {
          sim.addBody(i, { parts: [{ type: 'box', cx: 0, cy: .3, cz: 0, hx: .3, hy: .3, hz: .3, yaw: 0 }], mass: 15, material: 'wood' },
            yawPose(44 + (i % 6) * .7, 1 + Math.floor(i / 36) * .7, 44 + (Math.floor(i / 6) % 6) * .7, i * .3));
        }
        // Averaged over ticks that actually stepped (a heap that has gone to sleep costs nothing).
        let total = 0, worst = 0, steps = 0, settled = -1;
        for (let i = 0; i < 120; i++) {
          sim.step([], () => undefined, 1 / 30, i * 1000 / 30);
          if (sim.stats.steps) { total += sim.stats.stepMs; worst = Math.max(worst, sim.stats.stepMs); steps++; } else if (settled < 0) settled = i;
          if (worst > BUDGET_MS * 4 || process.memoryUsage().heapUsed / 2 ** 20 > HEAP_LIMIT_MB) break;
        }
        const heap = process.memoryUsage().heapUsed / 2 ** 20;
        rows.push(`${count} bodies: ${(total / steps).toFixed(3)} ms avg / ${worst.toFixed(3)} ms worst per awake tick, all asleep after ${settled < 0 ? '>120' : settled} ticks, heap ${heap.toFixed(0)} MB`);
        expect(total / steps).toBeLessThan(BUDGET_MS);
      } finally { sim.dispose(); }
    }
    console.log(rows.join('\n'));
  }, 120_000);
});
