import { type Rng, smoothstep } from '@zion/shared';
import { type Simplex2 } from '../noise';
import { distanceToPolygonEdge, pointInPolygon } from './geometry';
import { type CellRect, type Heightfield } from './heightfield';

export const TERRAIN_TOOLS = ['raise', 'lower', 'smooth', 'flatten', 'sculpt', 'noise', 'erosion', 'paint'] as const;
export type TerrainTool = typeof TERRAIN_TOOLS[number];
export const BRUSH_SHAPES = ['circle', 'square'] as const;
export type BrushShape = typeof BRUSH_SHAPES[number];
/** Stamp patterns for the Sculpt tool. */
export const SCULPT_PATTERNS = [
  { id: 'dome', name: 'Vòm đồi' }, { id: 'ridge', name: 'Sống núi' }, { id: 'crater', name: 'Miệng hố' },
  { id: 'plateau', name: 'Cao nguyên' }, { id: 'terrace', name: 'Ruộng bậc thang' }, { id: 'dune', name: 'Đụn cát' },
] as const;
export type SculptPattern = typeof SCULPT_PATTERNS[number]['id'];

export interface BrushSettings {
  radius: number;
  /** 0..1 per dab. */
  strength: number;
  /** 0 = hard edge, 1 = soft all the way to the centre. */
  falloff: number;
  shape: BrushShape;
  /** Flatten: the height to level to (m). */
  targetHeight: number;
  pattern: SculptPattern;
  /** Paint: the Surface id. */
  surface: number;
  /** Brush direction for directional patterns (ridge, dune), radians. */
  angle: number;
}

export const DEFAULT_BRUSH: BrushSettings = { radius: 60, strength: .5, falloff: .6, shape: 'circle', targetHeight: 40, pattern: 'dome', surface: 0, angle: 0 };

/** Brush weight (0..1) at offset (dx, dz) from its centre. */
export function brushWeight(b: BrushSettings, dx: number, dz: number): number {
  const d = b.shape === 'square' ? Math.max(Math.abs(dx), Math.abs(dz)) / b.radius : Math.hypot(dx, dz) / b.radius;
  if (d >= 1) return 0;
  const hard = 1 - b.falloff;
  return d <= hard ? 1 : 1 - smoothstep(hard, 1, d);
}

/** Shape of a sculpt stamp at unit offset (u, v) ∈ disc; returns a height in units of the radius. */
function stamp(pattern: SculptPattern, u: number, v: number, angle: number): number {
  const c = Math.cos(angle), s = Math.sin(angle), a = u * c + v * s, b = -u * s + v * c;
  const r = Math.hypot(u, v);
  switch (pattern) {
    case 'dome': return Math.cos(Math.min(1, r) * Math.PI / 2) ** 2 * .35;
    case 'ridge': return Math.max(0, 1 - Math.abs(b) * 2.2) ** 1.5 * (1 - a * a) * .3;
    case 'crater': return (r < .55 ? -.12 * (1 - (r / .55) ** 2) : .1 * Math.cos((r - .55) / .45 * Math.PI / 2) ** 2);
    case 'plateau': return smoothstep(1, .55, r) * .18;
    case 'terrace': return Math.round(smoothstep(1, 0, r) * 5) / 5 * .2;
    default: return Math.max(0, Math.sin((a + 1) * Math.PI * 1.5)) * (1 - r) * .06 + (1 - r) * .02;
  }
}

/**
 * One dab of a terrain tool at (x, z). Returns the cells it changed, or null. `dt` scales the
 * strength (dabs are applied while dragging, ~30 per second).
 */
export function applyBrush(hf: Heightfield, tool: TerrainTool, b: BrushSettings, x: number, z: number, rng: Rng, noise: Simplex2): CellRect | null {
  const rect = hf.rectAround(x, z, b.radius);
  const { cols, cell } = hf, h = hf.heights;
  const strength = Math.max(0, Math.min(1, b.strength));
  if (tool === 'erosion') return erode(hf, b, x, z, rng) ? rect : null;
  // Smoothing reads neighbours: work from a copy so the result does not depend on scan order.
  const source = tool === 'smooth' ? hf.snapshot({ i0: Math.max(0, rect.i0 - 1), j0: Math.max(0, rect.j0 - 1), i1: Math.min(cols - 1, rect.i1 + 1), j1: Math.min(hf.rows - 1, rect.j1 + 1) }) : null;
  const sw = source ? source.rect.i1 - source.rect.i0 + 1 : 0;
  const read = (i: number, j: number) => {
    const ii = Math.max(source!.rect.i0, Math.min(source!.rect.i1, i)), jj = Math.max(source!.rect.j0, Math.min(source!.rect.j1, j));
    return source!.heights[(jj - source!.rect.j0) * sw + ii - source!.rect.i0]!;
  };
  let changed = false;
  for (let j = rect.j0; j <= rect.j1; j++) for (let i = rect.i0; i <= rect.i1; i++) {
    const wx = i * cell, wz = j * cell, w = brushWeight(b, wx - x, wz - z);
    if (w <= 0) continue;
    const k = j * cols + i;
    switch (tool) {
      case 'raise': h[k]! += w * strength * b.radius * .03; break;
      case 'lower': h[k]! -= w * strength * b.radius * .03; break;
      case 'smooth': {
        let sum = 0;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) sum += read(i + di, j + dj) * (di || dj ? (di && dj ? 1 : 2) : 4);
        h[k] = h[k]! + (sum / 16 - h[k]!) * w * Math.min(1, strength * 1.5);
        break;
      }
      case 'flatten': h[k] = h[k]! + (b.targetHeight - h[k]!) * w * Math.min(1, strength * .6); break;
      case 'sculpt': h[k]! += stamp(b.pattern, (wx - x) / b.radius, (wz - z) / b.radius, b.angle) * b.radius * w * strength * .25; break;
      case 'noise': h[k]! += noise.noise(wx * .045, wz * .045) * w * strength * Math.max(1, b.radius * .02) * 1.2; break;
      case 'paint': if (w > .35 && hf.surface[k] !== b.surface) hf.surface[k] = b.surface; break;
    }
    changed = true;
  }
  return changed ? rect : null;
}

/**
 * Local hydraulic erosion: droplets that start inside the brush run downhill, picking up
 * sediment where they speed up and laying it down where they slow (after Beyer, 2015).
 * Deterministic for a given random stream.
 */
export function erode(hf: Heightfield, b: BrushSettings, x: number, z: number, rng: Rng, drops = Math.round(40 + b.strength * 160)): boolean {
  const { cols, rows, cell } = hf, h = hf.heights;
  const inertia = .05, capacity = 4, deposition = .3, erosion = .3, evaporation = .02, gravity = 4, minSlope = .01;
  const grad = (px: number, pz: number) => {
    const i = Math.floor(px), j = Math.floor(pz), u = px - i, v = pz - j, k = j * cols + i;
    const a = h[k]!, bb = h[k + 1]!, c = h[k + cols]!, d = h[k + cols + 1]!;
    return { gx: (bb - a) * (1 - v) + (d - c) * v, gz: (c - a) * (1 - u) + (d - bb) * u, height: a * (1 - u) * (1 - v) + bb * u * (1 - v) + c * (1 - u) * v + d * u * v };
  };
  let any = false;
  for (let n = 0; n < drops; n++) {
    const ang = rng.next() * Math.PI * 2, rad = Math.sqrt(rng.next()) * b.radius;
    let px = (x + Math.cos(ang) * rad) / cell, pz = (z + Math.sin(ang) * rad) / cell;
    let dx = 0, dz = 0, speed = 1, water = 1, sediment = 0;
    for (let life = 0; life < 40; life++) {
      if (px < 1 || pz < 1 || px >= cols - 2 || pz >= rows - 2) break;
      const i = Math.floor(px), j = Math.floor(pz), u = px - i, v = pz - j;
      const g = grad(px, pz);
      dx = dx * inertia - g.gx * (1 - inertia); dz = dz * inertia - g.gz * (1 - inertia);
      const len = Math.hypot(dx, dz);
      if (len < 1e-6) break;
      dx /= len; dz /= len; px += dx; pz += dz;
      if (px < 1 || pz < 1 || px >= cols - 2 || pz >= rows - 2) break;
      // Stay within the brush (plus a margin) so the stroke stays local.
      if (Math.hypot(px * cell - x, pz * cell - z) > b.radius * 1.2) break;
      const dh = grad(px, pz).height - g.height;
      const cap = Math.max(-dh, minSlope) * speed * water * capacity;
      const k = j * cols + i;
      const weights = [(1 - u) * (1 - v), u * (1 - v), (1 - u) * v, u * v], cells = [k, k + 1, k + cols, k + cols + 1];
      if (sediment > cap || dh > 0) {
        const amount = dh > 0 ? Math.min(dh, sediment) : (sediment - cap) * deposition;
        sediment -= amount;
        for (let q = 0; q < 4; q++) h[cells[q]!]! += amount * weights[q]!;
      } else {
        const amount = Math.min((cap - sediment) * erosion, -dh);
        for (let q = 0; q < 4; q++) h[cells[q]!]! -= amount * weights[q]!;
        sediment += amount;
      }
      speed = Math.sqrt(Math.max(0, speed * speed + dh * -gravity));
      water *= 1 - evaporation;
      any = true;
    }
  }
  return any;
}

/**
 * Cut and fill for a building site: the ground inside the polygon eases onto its best-fit
 * plane (keeping the general fall of the land), blending back to the natural ground over
 * `feather` metres inside the outline.
 */
export function levelRegion(hf: Heightfield, polygon: ReadonlyArray<readonly [number, number]>, feather = 30, amount = 1): CellRect | null {
  const xs = polygon.map((p) => p[0]), zs = polygon.map((p) => p[1]);
  const rect = { i0: hf.clampI(Math.floor(Math.min(...xs) / hf.cell)), i1: hf.clampI(Math.ceil(Math.max(...xs) / hf.cell)), j0: hf.clampJ(Math.floor(Math.min(...zs) / hf.cell)), j1: hf.clampJ(Math.ceil(Math.max(...zs) / hf.cell)) };
  const poly = polygon as Array<[number, number]>;
  // Least-squares plane h = a + b·x + c·z over the cells inside.
  let n = 0, sx = 0, sz = 0, sh = 0, sxx = 0, szz = 0, sxz = 0, sxh = 0, szh = 0;
  const stride = Math.max(1, Math.round((rect.i1 - rect.i0) / 120));
  for (let j = rect.j0; j <= rect.j1; j += stride) for (let i = rect.i0; i <= rect.i1; i += stride) {
    const x = i * hf.cell, z = j * hf.cell;
    if (!pointInPolygon(x, z, poly)) continue;
    const h = hf.get(i, j);
    n++; sx += x; sz += z; sh += h; sxx += x * x; szz += z * z; sxz += x * z; sxh += x * h; szh += z * h;
  }
  if (n < 3) return null;
  const mx = sx / n, mz = sz / n, mh = sh / n;
  const cxx = sxx / n - mx * mx, czz = szz / n - mz * mz, cxz = sxz / n - mx * mz, cxh = sxh / n - mx * mh, czh = szh / n - mz * mh;
  const det = cxx * czz - cxz * cxz;
  const b = det > 1e-9 ? (cxh * czz - czh * cxz) / det : 0, c = det > 1e-9 ? (czh * cxx - cxh * cxz) / det : 0;
  // Keep the fall gentle: at most 6 % across the site.
  const g = Math.hypot(b, c), k = g > .06 ? .06 / g : 1;
  for (let j = rect.j0; j <= rect.j1; j++) for (let i = rect.i0; i <= rect.i1; i++) {
    const x = i * hf.cell, z = j * hf.cell;
    if (!pointInPolygon(x, z, poly)) continue;
    const w = smoothstep(0, feather, distanceToPolygonEdge(x, z, poly)) * amount;
    const target = mh + (x - mx) * b * k + (z - mz) * c * k, idx = j * hf.cols + i;
    hf.heights[idx] = hf.heights[idx]! + (target - hf.heights[idx]!) * w;
  }
  return rect;
}
