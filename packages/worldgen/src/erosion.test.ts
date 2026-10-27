import { describe, expect, it } from 'vitest';
import { erodeGrid } from './erosion';
import { ecologyAt, groveDensity, suitability } from './ecology';

/** A cone-shaped hill with some bumps, 129 × 129 cells of 4 m. */
function hill(): { cols: number; rows: number; cell: number; heights: Float32Array } {
  const cols = 129, cell = 4, heights = new Float32Array(cols * cols);
  for (let j = 0; j < cols; j++) for (let i = 0; i < cols; i++) {
    const dx = i - 64, dy = j - 64, r = Math.hypot(dx, dy);
    heights[j * cols + i] = Math.max(0, 80 - r * 1.2) + Math.sin(i * .37) * Math.cos(j * .29) * 1.5;
  }
  return { cols, rows: cols, cell, heights };
}

describe('erosion', () => {
  it('is deterministic per seed', () => {
    const a = hill(), b = hill();
    erodeGrid(a, { seed: 7, density: .4 });
    erodeGrid(b, { seed: 7, density: .4 });
    expect(Array.from(a.heights)).toEqual(Array.from(b.heights));
  });

  it('carves the slopes, gathers water below and keeps the change bounded', () => {
    const g = hill(), before = g.heights.slice();
    const { flow, sediment } = erodeGrid(g, { seed: 3, density: .6 });
    let maxChange = 0, carved = 0, deposited = 0;
    for (let k = 0; k < before.length; k++) {
      const d = g.heights[k]! - before[k]!;
      maxChange = Math.max(maxChange, Math.abs(d));
      if (d < 0) carved -= d; else deposited += d;
      expect(sediment[k]).toBeCloseTo(d, 4);
    }
    expect(carved).toBeGreaterThan(10);
    expect(deposited).toBeGreaterThan(5);
    expect(maxChange).toBeLessThan(20);
    // More water passes the foot of the hill than its summit.
    const at = (i: number, j: number) => flow[j * g.cols + i]!;
    let foot = 0, top = 0;
    for (let a = 0; a < 64; a++) {
      const t = a / 64 * Math.PI * 2;
      foot += at(Math.round(64 + Math.cos(t) * 55), Math.round(64 + Math.sin(t) * 55));
      top += at(Math.round(64 + Math.cos(t) * 4), Math.round(64 + Math.sin(t) * 4));
    }
    expect(foot).toBeGreaterThan(top);
  });

  it('leaves protected ground as it was', () => {
    const g = hill(), before = g.heights.slice();
    erodeGrid(g, { seed: 5, density: .5, keep: (i) => (i < 64 ? 0 : 1) });
    for (let j = 0; j < g.rows; j++) for (let i = 0; i < 64; i++) expect(g.heights[j * g.cols + i]).toBe(before[j * g.cols + i]);
  });
});

describe('ecology', () => {
  it('reads hollows as wet and crests as dry and rocky', () => {
    const valley = { height: (x: number) => Math.abs(x) * .6 };
    const crest = { height: (x: number) => -Math.abs(x) * .9 };
    const low = ecologyAt(valley, 0, 0), high = ecologyAt(crest, 0, 0);
    expect(low.ridge).toBeLessThan(0);
    expect(high.ridge).toBeGreaterThan(0);
    expect(low.wetness).toBeGreaterThan(high.wetness);
    expect(low.soil).toBeGreaterThan(high.soil);
    expect(suitability(low).broadleaf).toBeGreaterThan(suitability(high).broadleaf);
  });

  it('faces the sun on south slopes', () => {
    const south = ecologyAt({ height: (_x, z) => -z * .4 }, 0, 0), north = ecologyAt({ height: (_x, z) => z * .4 }, 0, 0);
    expect(south.sun).toBeGreaterThan(north.sun);
  });

  it('grows groves with glades between them', () => {
    let dense = 0, open = 0, n = 0;
    for (let z = 0; z < 600; z += 5) for (let x = 0; x < 600; x += 5) {
      const g = groveDensity(11, x, z);
      expect(g).toBeGreaterThanOrEqual(0);
      expect(g).toBeLessThanOrEqual(1);
      if (g > .6) dense++;
      if (g < .2) open++;
      n++;
    }
    expect(dense / n).toBeGreaterThan(.1);
    expect(open / n).toBeGreaterThan(.05);
    expect(groveDensity(11, 123, 456)).toBe(groveDensity(11, 123, 456));
  });
});
