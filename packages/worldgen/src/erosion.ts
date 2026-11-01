import { Rng } from '@zion/shared';

/**
 * Hydraulic and thermal erosion on a height grid, and the flow and sediment maps the ecology reads.
 *
 * The droplet model and the thermal pass follow GPU-Terrain-Generator by Denys Fakas
 * (https://github.com/Denys-Fakas/GPU-Terrain-Generator, MIT License, Copyright (c) 2026
 * Denys-Fakas: shaders/compute/hydraulic_drops.comp and thermal_accum.comp), ported from GLSL
 * compute shaders to a sequential CPU loop (each droplet changes the grid at once instead of through
 * atomic delta buffers, so the result is deterministic and needs no GPU on the server):
 *  - erosion and deposition both through a normalised Gaussian brush (no one-cell trenches or
 *    spikes), erosion capped by the local slope so it never digs pits;
 *  - carried sediment capped at 1.5× the capacity, the speed capped;
 *  - thermal: each cell sheds the excess over the talus slope to all eight lower neighbours in
 *    proportion to the excess (diagonals at their real distance), alternating checkerboard phases.
 * Added here: every droplet leaves its water on the cells it crosses (`flow`, the drainage a
 * stream follows) and the net change per cell is kept apart (`sediment`: + deposited, − carved).
 */

export interface ErosionGrid {
  cols: number;
  rows: number;
  /** Metres between samples. */
  cell: number;
  heights: Float32Array;
}

export interface ErosionOptions {
  seed: number;
  /** Droplets per cell (0.3–1). */
  density?: number;
  /** Below this height droplets end (the sea). */
  seaLevel?: number;
  /** Steepest slope that stays put in the thermal pass (rise / run). */
  talus?: number;
  thermalPasses?: number;
  /** 0..1 per cell: how much of the change is kept (protected ground: 0). */
  keep?: (i: number, j: number) => number;
  /** Called now and then with 0..1 (long runs report progress). */
  progress?: (p: number) => void;
}

export interface ErosionResult {
  /** Water that passed each cell, 0..1 (log-scaled: rills ≈ .3, streams ≈ .6, valley floors → 1). */
  flow: Float32Array;
  /** Net change per cell (m): + where sediment settled, − where it was carved away. */
  sediment: Float32Array;
}

const INERTIA = .05, SED_CAP = 4, MIN_SLOPE = .01, ERODE = .3, DEPOSIT = .3, EVAPORATE = .015, GRAVITY = 4, MAX_STEPS = 64, MAX_SPEED = 4, BRUSH = 2;

/** Erodes `grid.heights` in place; returns where the water went and where the ground moved. */
export function erodeGrid(grid: ErosionGrid, options: ErosionOptions): ErosionResult {
  const { cols, rows, cell } = grid, h = grid.heights, n = cols * rows;
  const before = h.slice();
  const flow = new Float32Array(n);
  const rng = new Rng(options.seed);
  const sea = options.seaLevel ?? -Infinity;
  // Heights move per cell, but slopes are compared per metre: scale the sediment capacity so a
  // coarse grid erodes like a fine one.
  const capK = SED_CAP * Math.max(1, 4 / cell);
  // Gaussian brush (σ² = R²/4 as in the shader), normalised once.
  const offsets: Array<[number, number, number]> = [];
  {
    const sig2 = BRUSH * BRUSH * .25 + .001;
    let sum = 0;
    for (let dy = -BRUSH; dy <= BRUSH; dy++) for (let dx = -BRUSH; dx <= BRUSH; dx++) if (dx * dx + dy * dy <= BRUSH * BRUSH) { const w = Math.exp(-(dx * dx + dy * dy) / (2 * sig2)); offsets.push([dx, dy, w]); sum += w; }
    for (const o of offsets) o[2] /= sum;
  }
  const brush = (px: number, py: number, amount: number) => {
    const cx = Math.floor(px), cy = Math.floor(py);
    for (const [dx, dy, w] of offsets) {
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
      h[y * cols + x] = h[y * cols + x]! + amount * w;
    }
  };
  // Bilinear height and gradient at a point (grid units).
  const sample = (px: number, py: number, out: [number, number, number]) => {
    const x0 = Math.max(0, Math.min(cols - 2, Math.floor(px))), y0 = Math.max(0, Math.min(rows - 2, Math.floor(py)));
    const u = px - x0, v = py - y0, k = y0 * cols + x0;
    const h00 = h[k]!, h10 = h[k + 1]!, h01 = h[k + cols]!, h11 = h[k + cols + 1]!;
    out[0] = (h00 * (1 - u) + h10 * u) * (1 - v) + (h01 * (1 - u) + h11 * u) * v;
    out[1] = (h10 - h00) * (1 - v) + (h11 - h01) * v;
    out[2] = (h01 - h00) * (1 - u) + (h11 - h10) * u;
  };
  const here: [number, number, number] = [0, 0, 0], next: [number, number, number] = [0, 0, 0];
  const drops = Math.round(n * (options.density ?? .6));
  for (let d = 0; d < drops; d++) {
    let px = rng.next() * (cols - 5) + 2, py = rng.next() * (rows - 5) + 2;
    let dirX = 0, dirY = 0, speed = 1, water = 1, sediment = 0;
    for (let step = 0; step < MAX_STEPS; step++) {
      sample(px, py, here);
      if (here[0] < sea) { brush(px, py, sediment); break; }
      flow[Math.floor(py) * cols + Math.floor(px)] += water;
      dirX = dirX * INERTIA - here[1] * (1 - INERTIA);
      dirY = dirY * INERTIA - here[2] * (1 - INERTIA);
      const len = Math.max(Math.hypot(dirX, dirY), 1e-4);
      dirX /= len; dirY /= len;
      const nx = px + dirX, ny = py + dirY;
      if (nx < 1.5 || nx > cols - 2.5 || ny < 1.5 || ny > rows - 2.5) { brush(px, py, sediment); break; }
      sample(nx, ny, next);
      const deltaH = next[0] - here[0];
      const slope = Math.max(-deltaH, MIN_SLOPE);
      const capacity = slope * speed * water * capK;
      if (sediment > capacity || deltaH > 0) {
        const dep = Math.max(0, deltaH > 0 ? Math.min(deltaH, sediment) : (sediment - capacity) * DEPOSIT);
        sediment -= dep;
        brush(px, py, dep);
      } else {
        // Capped by the slope: erosion never digs a pit deeper than the drop it runs down.
        const ero = Math.max(0, Math.min((capacity - sediment) * ERODE, slope * .4));
        sediment += ero;
        brush(px, py, -ero);
      }
      speed = Math.min(MAX_SPEED, Math.sqrt(Math.max(0, speed * speed - deltaH * GRAVITY)));
      sediment = Math.min(sediment, capacity * 1.5);
      water *= 1 - EVAPORATE;
      if (speed < .015 || water < .01) { brush(px, py, sediment); break; }
      px = nx; py = ny;
    }
    if (options.progress && d % 50000 === 49999) options.progress(d / drops * .9);
  }
  // Thermal: material above the talus slope slides to the lower neighbours (scree, softened cliffs).
  const talus = (options.talus ?? .9) * cell, passes = options.thermalPasses ?? 6;
  // (Offsets and limits per direction in flat arrays: this loop runs over every cell many times.)
  const DX = [1, -1, 0, 0, 1, -1, 1, -1], DY = [0, 0, 1, -1, 1, 1, -1, -1];
  const off = new Int32Array(8), lim = new Float64Array(8), excess = new Float32Array(8);
  for (let q = 0; q < 8; q++) { off[q] = DY[q]! * cols + DX[q]!; lim[q] = talus * (DX[q] && DY[q] ? Math.SQRT2 : 1); }
  for (let pass = 0; pass < passes; pass++) for (let phase = 0; phase < 2; phase++) {
    for (let j = 1; j < rows - 1; j++) for (let i = 1 + ((j + phase) & 1); i < cols - 1; i += 2) {
      const k = j * cols + i, hk = h[k]!;
      let total = 0;
      for (let q = 0; q < 8; q++) {
        const e = hk - h[k + off[q]!]! - lim[q]!;
        excess[q] = e > 0 ? e : 0;
        total += excess[q]!;
      }
      if (total < 1e-4) continue;
      const move = total * .25;
      h[k] = hk - move;
      for (let q = 0; q < 8; q++) if (excess[q]) h[k + off[q]!] = h[k + off[q]!]! + move * excess[q]! / total;
    }
  }
  // Protected ground keeps its height; the change elsewhere is what `sediment` records.
  const sedimentOut = new Float32Array(n);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const k = j * cols + i, keep = options.keep ? options.keep(i, j) : 1;
    const change = (h[k]! - before[k]!) * keep;
    h[k] = before[k]! + change;
    sedimentOut[k] = change;
  }
  // Water passages on a log scale against the drops that fell on each cell.
  const norm = Math.log1p(drops / n * 400);
  for (let k = 0; k < n; k++) flow[k] = Math.min(1, Math.log1p(flow[k]!) / norm);
  options.progress?.(1);
  return { flow, sediment: sedimentOut };
}

/** A grid of values sampled bilinearly in world metres (origin at 0, 0). */
export class FieldGrid {
  constructor(readonly cols: number, readonly rows: number, readonly cell: number, readonly values: Float32Array) {}

  at(x: number, z: number): number {
    const fx = Math.max(0, Math.min(this.cols - 1.0001, x / this.cell)), fz = Math.max(0, Math.min(this.rows - 1.0001, z / this.cell));
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, k = j * this.cols + i, g = this.values;
    return (g[k]! * (1 - u) + g[k + 1]! * u) * (1 - v) + (g[k + this.cols]! * (1 - u) + g[k + this.cols + 1]! * u) * v;
  }
}

/**
 * Erosion of a whole world given by its height function: the height change (m), the flow and
 * the sediment as fields to sample anywhere. `keep(x, z)` protects ground (coast, plains, pads).
 */
/** `ridge`: −1 hollow … +1 crest, the eroded ground against the ground 24 m around. */
export interface ErodedWorld { delta: FieldGrid; flow: FieldGrid; sediment: FieldGrid; ridge: FieldGrid }

const eroded = new Map<string, ErodedWorld>();

export function erodeWorld(key: string, size: number, cell: number, height: (x: number, z: number) => number, options: Omit<ErosionOptions, 'keep'> & { keep?: (x: number, z: number) => number; maxChange?: number }): ErodedWorld {
  const cached = eroded.get(key);
  if (cached) return cached;
  const cols = Math.round(size / cell) + 1, heights = new Float32Array(cols * cols);
  for (let j = 0; j < cols; j++) for (let i = 0; i < cols; i++) heights[j * cols + i] = height(i * cell, j * cell);
  const before = heights.slice();
  const keep = options.keep, max = options.maxChange ?? 8;
  const result = erodeGrid({ cols, rows: cols, cell, heights }, { ...options, keep: keep ? (i, j) => keep(i * cell, j * cell) : undefined });
  const delta = new Float32Array(cols * cols);
  // Soft limit: big changes saturate smoothly (a hard clip leaves terraces with cliff edges).
  for (let k = 0; k < delta.length; k++) delta[k] = max * Math.tanh((heights[k]! - before[k]!) / max);
  const ridge = new Float32Array(cols * cols), r = Math.max(1, Math.round(24 / cell)), at = (i: number, j: number) => heights[Math.max(0, Math.min(cols - 1, j)) * cols + Math.max(0, Math.min(cols - 1, i))]!;
  for (let j = 0; j < cols; j++) for (let i = 0; i < cols; i++) ridge[j * cols + i] = Math.max(-1, Math.min(1, (at(i, j) - (at(i + r, j) + at(i - r, j) + at(i, j + r) + at(i, j - r)) / 4) / 3));
  const world = { delta: new FieldGrid(cols, cols, cell, delta), flow: new FieldGrid(cols, cols, cell, result.flow), sediment: new FieldGrid(cols, cols, cell, result.sediment), ridge: new FieldGrid(cols, cols, cell, ridge) };
  eroded.set(key, world);
  return world;
}
