import { Rng } from '@zion/shared';

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;
const GRAD_X = new Float64Array([1, -1, 1, -1, 1, -1, 0, 0]);
const GRAD_Y = new Float64Array([1, 1, -1, -1, 0, 0, 1, -1]);

/**
 * 2D simplex noise (Gustavson) with a seeded permutation table. Uses only +, −, ×, floor and a
 * constant sqrt, so results are bit-identical on every IEEE-754 platform. Output ≈ [−1, 1].
 */
export class Simplex2 {
  private readonly perm = new Uint8Array(512);
  private readonly grad = new Uint8Array(512);

  constructor(seed: number) {
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    const rng = new Rng(seed);
    for (let i = 255; i > 0; i--) {
      const j = rng.int(i + 1);
      const t = p[i]!;
      p[i] = p[j]!;
      p[j] = t;
    }
    for (let i = 0; i < 512; i++) {
      this.perm[i] = p[i & 255]!;
      this.grad[i] = this.perm[i]! & 7;
    }
  }

  noise(xin: number, yin: number): number {
    const perm = this.perm;
    const grad = this.grad;
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t);
    const y0 = yin - (j - t);
    const i1 = x0 > y0 ? 1 : 0;
    const j1 = 1 - i1;
    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;
    const ii = i & 255;
    const jj = j & 255;
    let n = 0;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) {
      const g = grad[ii + perm[jj]!]!;
      t0 *= t0;
      n += t0 * t0 * (GRAD_X[g]! * x0 + GRAD_Y[g]! * y0);
    }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) {
      const g = grad[ii + i1 + perm[jj + j1]!]!;
      t1 *= t1;
      n += t1 * t1 * (GRAD_X[g]! * x1 + GRAD_Y[g]! * y1);
    }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) {
      const g = grad[ii + 1 + perm[jj + 1]!]!;
      t2 *= t2;
      n += t2 * t2 * (GRAD_X[g]! * x2 + GRAD_Y[g]! * y2);
    }
    return 70 * n;
  }

  /** Fractional Brownian motion, normalised to ≈ [−1, 1]. */
  fbm(x: number, y: number, octaves: number, lacunarity = 2, gain = 0.5): number {
    let sum = 0;
    let amp = 1;
    let freq = 1;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      // Per-octave offset decorrelates octaves sharing the lattice origin.
      sum += amp * this.noise(x * freq + o * 19.19, y * freq - o * 7.73);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }

  /** Ridged multifractal (Musgrave), ≈ [0, 1]; sharp crests suited to mountain ranges. */
  ridged(x: number, y: number, octaves: number): number {
    let sum = 0;
    let amp = 0.5;
    let freq = 1;
    let weight = 1;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      let n = this.noise(x * freq + o * 31.7, y * freq + o * 11.3);
      n = n < 0 ? 1 + n : 1 - n;
      n *= n;
      n *= weight;
      weight = n * 2;
      if (weight > 1) weight = 1;
      sum += n * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2.03;
    }
    return sum / norm;
  }
}
