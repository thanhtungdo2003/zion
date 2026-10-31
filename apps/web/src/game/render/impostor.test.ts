import { describe, expect, it } from 'vitest';
import { IMPOSTOR_GRID, hemiOctDecode, hemiOctEncode } from './impostor';

describe('impostor view grid', () => {
  it('maps every view direction of the upper hemisphere to the grid and back', () => {
    for (let i = 0; i < 200; i++) {
      const a = i * 2.39996, e = (i % 17) / 16 * Math.PI / 2;
      const d = [Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e)] as const;
      const [u, v] = hemiOctEncode(...d);
      expect(u).toBeGreaterThanOrEqual(0); expect(u).toBeLessThanOrEqual(1);
      expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1);
      const back = hemiOctDecode(u, v);
      for (let k = 0; k < 3; k++) expect(back[k]).toBeCloseTo(d[k], 5);
    }
  });

  it('spreads the views evenly: neighbouring views are never far apart', () => {
    let worst = 0;
    for (let j = 0; j < IMPOSTOR_GRID; j++) for (let i = 0; i + 1 < IMPOSTOR_GRID; i++) {
      const a = hemiOctDecode(i / (IMPOSTOR_GRID - 1), j / (IMPOSTOR_GRID - 1)), b = hemiOctDecode((i + 1) / (IMPOSTOR_GRID - 1), j / (IMPOSTOR_GRID - 1));
      worst = Math.max(worst, Math.acos(Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));
    }
    // Under 30° between neighbouring views on the 10 × 10 grid (three are blended, with parallax).
    expect(worst).toBeLessThan(30 * Math.PI / 180);
  });

  it('keeps views from below the horizon on the horizon', () => {
    const [u, v] = hemiOctEncode(1, -.5, 0), d = hemiOctDecode(u, v);
    expect(d[1]).toBeCloseTo(0, 5);
  });
});
