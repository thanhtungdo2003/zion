import { Rng, smoothstep } from '@zion/shared';
import { IndexHeap } from '../heap';
import { Simplex2 } from '../noise';
import type { Vec2 } from './geometry';
import { type CellRect, type Heightfield, seedNumber } from './heightfield';
import { carveRivers, type Lake, type River, type WaterData } from './water';

/**
 * Drainage of a Studio terrain, computed from its own heights (the same grid the game gets):
 *
 *  - Priority-Flood+ε (Barnes, Lehman & Mulla 2014) from the sea and the map edge: the order in
 *    which water reaches every cell, the level each closed basin fills to, and a downhill way
 *    out of every pit and flat.
 *  - Basins deep and wide enough hold lakes at their spill level (shore traced with marching
 *    squares); the rest are filled (alluvium), so no closed pits are left on dry land. When the
 *    terrain has fewer lakes than asked, basins are dug on flat valley floors and become lakes
 *    the same way.
 *  - D8 flow directions down the filled surface; flow accumulation weighted by rainfall (more on
 *    the heights). Watersheds are the trees of this drainage, one per outlet.
 *  - Rivers where the drained area passes a threshold, traced from each mouth up the main stem
 *    (the longest branch), tributaries joining it at their confluences; width and depth grow
 *    with the area drained. They start in the mountains and the high basins and end at the sea,
 *    at a lake or at a larger river; lakes have an outflow where their basin spills.
 *  - The beds are carved into the heights with banks (water.ts `carveRivers`), so the water,
 *    the channel and the ground are one data set.
 */

export interface HydroOptions {
  seed: string;
  seaLevel: number;
  /** Relief of the map (m): rain and lake heights scale with it. */
  maxHeight: number;
  /** Drained area (m²) at which a stream is a river; default from the land area. */
  riverArea?: number;
  /** River systems kept (largest first). */
  maxRivers?: number;
  /** Lakes kept (largest first); basins beyond are filled. */
  maxLakes?: number;
  /** Lakes wanted: missing ones are dug on valley floors. */
  minLakes?: number;
}

export interface HydroResult {
  water: WaterData;
  /** Drained area per grid vertex (m², rain-weighted). */
  flow: Float32Array;
}

const DI = [1, -1, 0, 0, 1, 1, -1, -1] as const;
const DJ = [0, 0, 1, -1, 1, -1, 1, -1] as const;
const DD = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2] as const;

interface Flood { order: Int32Array; count: number; fill: Float32Array; recv: Int32Array }

/** Priority-Flood+ε from the sea and the edge; steepest descent over the filled surface. */
function flood(hf: Heightfield, sea: number): Flood {
  const n = hf.cols, last = n - 1, N = n * n, H = hf.heights;
  const heap = new IndexHeap(Math.max(1024, n * 8)), done = new Uint8Array(N), order = new Int32Array(N);
  const fe = new Float64Array(N), fill = new Float32Array(N), recv = new Int32Array(N), outlet = new Uint8Array(N);
  for (let k = 0; k < N; k++) {
    const i = k % n, j = (k - i) / n;
    recv[k] = k;
    if (H[k]! < sea || i === 0 || j === 0 || i === last || j === last) { outlet[k] = done[k] = 1; fe[k] = H[k]!; fill[k] = H[k]!; heap.push(k, H[k]!); }
  }
  let count = 0;
  while (heap.size) {
    const c = heap.pop();
    order[count++] = c;
    const ci = c % n, cj = (c - ci) / n;
    for (let d = 0; d < 8; d++) {
      const i = ci + DI[d]!, j = cj + DJ[d]!;
      if (i < 0 || j < 0 || i > last || j > last) continue;
      const nb = j * n + i;
      if (done[nb]) continue;
      done[nb] = 1;
      fe[nb] = Math.max(H[nb]!, fe[c]! + 1e-5);
      fill[nb] = Math.max(H[nb]!, fill[c]!);
      heap.push(nb, fe[nb]!);
    }
  }
  for (let q = 0; q < count; q++) {
    const c = order[q]!;
    if (outlet[c]) continue;
    const ci = c % n, cj = (c - ci) / n;
    let best = c, bs = 0;
    for (let d = 0; d < 8; d++) {
      const i = ci + DI[d]!, j = cj + DJ[d]!;
      if (i < 0 || j < 0 || i > last || j > last) continue;
      const nb = j * n + i, s = (fe[c]! - fe[nb]!) / DD[d]!;
      if (s > bs) { bs = s; best = nb; }
    }
    recv[c] = best;
  }
  return { order, count, fill, recv };
}

/** Rain-weighted drained area per cell (m²), upstream first. */
function accumulate(hf: Heightfield, f: Flood, sea: number, top: number): Float32Array {
  const N = hf.cols * hf.rows, A = new Float32Array(N), a0 = hf.cell * hf.cell, H = hf.heights;
  for (let k = 0; k < N; k++) A[k] = a0 * (1 + 1.5 * smoothstep(0, top, H[k]! - sea));
  for (let q = f.count - 1; q >= 0; q--) { const c = f.order[q]!, r = f.recv[c]!; if (r !== c) A[r] = A[r]! + A[c]!; }
  return A;
}

/** Closed basins: connected cells under their spill level, with their size and depth. */
function basins(hf: Heightfield, f: Flood): Array<{ cells: number[]; level: number; depth: number }> {
  const n = hf.cols, N = n * n, H = hf.heights, seen = new Uint8Array(N), out: Array<{ cells: number[]; level: number; depth: number }> = [];
  for (let k = 0; k < N; k++) {
    if (seen[k] || f.fill[k]! - H[k]! < .02) continue;
    const level = f.fill[k]!, cells = [k], stack = [k];
    seen[k] = 1;
    let depth = 0;
    while (stack.length) {
      const c = stack.pop()!, ci = c % n, cj = (c - ci) / n;
      depth = Math.max(depth, level - H[c]!);
      for (let d = 0; d < 8; d++) {
        const i = ci + DI[d]!, j = cj + DJ[d]!;
        if (i < 0 || j < 0 || i >= n || j >= n) continue;
        const nb = j * n + i;
        if (seen[nb] || f.fill[nb]! - H[nb]! < .02 || Math.abs(f.fill[nb]! - level) > .05) continue;
        seen[nb] = 1; cells.push(nb); stack.push(nb);
      }
    }
    out.push({ cells, level, depth });
  }
  return out;
}

/**
 * The shore of a lake: the contour where the ground meets `level` (marching squares over the
 * basin's cells), the longest closed loop, simplified.
 */
function shoreline(hf: Heightfield, cells: number[], level: number): Vec2[] | null {
  const n = hf.cols, H = hf.heights;
  let i0 = n, i1 = 0, j0 = n, j1 = 0;
  for (const c of cells) { const i = c % n, j = (c - i) / n; i0 = Math.min(i0, i); i1 = Math.max(i1, i); j0 = Math.min(j0, j); j1 = Math.max(j1, j); }
  i0 = Math.max(0, i0 - 1); j0 = Math.max(0, j0 - 1); i1 = Math.min(n - 1, i1 + 1); j1 = Math.min(n - 1, j1 + 1);
  const w = i1 - i0 + 1, member = new Uint8Array(w * (j1 - j0 + 1));
  for (const c of cells) { const i = c % n, j = (c - i) / n; member[(j - j0) * w + i - i0] = 1; }
  // Water depth at a vertex: positive inside the basin, negative everywhere else.
  const val = (i: number, j: number) => (member[(j - j0) * w + i - i0] ? Math.max(.001, level - H[j * n + i]!) : -1);
  // Edge points keyed by edge id; segments link them.
  const pos = new Map<number, Vec2>(), link = new Map<number, number[]>();
  const edgeH = (i: number, j: number) => (j * n + i) * 2, edgeV = (i: number, j: number) => (j * n + i) * 2 + 1;
  const point = (key: number, ax: number, az: number, av: number, bx: number, bz: number, bv: number) => {
    if (!pos.has(key)) { const t = av / (av - bv); pos.set(key, [(ax + (bx - ax) * t) * hf.cell, (az + (bz - az) * t) * hf.cell]); }
    return key;
  };
  const join = (a: number, b: number) => { (link.get(a) ?? link.set(a, []).get(a)!).push(b); (link.get(b) ?? link.set(b, []).get(b)!).push(a); };
  for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) {
    const v00 = val(i, j), v10 = val(i + 1, j), v01 = val(i, j + 1), v11 = val(i + 1, j + 1);
    const ends: number[] = [];
    if ((v00 > 0) !== (v10 > 0)) ends.push(point(edgeH(i, j), i, j, v00, i + 1, j, v10));
    if ((v10 > 0) !== (v11 > 0)) ends.push(point(edgeV(i + 1, j), i + 1, j, v10, i + 1, j + 1, v11));
    if ((v01 > 0) !== (v11 > 0)) ends.push(point(edgeH(i, j + 1), i, j + 1, v01, i + 1, j + 1, v11));
    if ((v00 > 0) !== (v01 > 0)) ends.push(point(edgeV(i, j), i, j, v00, i, j + 1, v01));
    if (ends.length === 2) join(ends[0]!, ends[1]!);
    else if (ends.length === 4) { join(ends[0]!, ends[1]!); join(ends[2]!, ends[3]!); }
  }
  // Walk the loops; keep the longest.
  const used = new Set<number>();
  let bestLoop: Vec2[] = [];
  for (const start of link.keys()) {
    if (used.has(start)) continue;
    const loop: Vec2[] = [];
    let prev = -1, cur = start;
    for (let guard = 0; guard < 200000; guard++) {
      used.add(cur); loop.push(pos.get(cur)!);
      const nx = (link.get(cur) ?? []).find((q) => q !== prev && !used.has(q));
      if (nx === undefined) break;
      prev = cur; cur = nx;
    }
    if (loop.length > bestLoop.length) bestLoop = loop;
  }
  if (bestLoop.length < 4) return null;
  let tol = hf.cell * .5, out = simplify(bestLoop, tol);
  while (out.length > 200) { tol *= 1.5; out = simplify(bestLoop, tol); }
  return out.length >= 3 ? out.map(([x, z]) => [Math.round(x * 10) / 10, Math.round(z * 10) / 10] as Vec2) : null;
}

/** Ramer–Douglas–Peucker on a closed loop. */
function simplify(pts: Vec2[], tol: number): Vec2[] {
  const keep = new Uint8Array(pts.length);
  const rdp = (a: number, b: number) => {
    const [ax, az] = pts[a]!, [bx, bz] = pts[b]!, dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz) || 1;
    let far = -1, fd = tol;
    for (let k = a + 1; k < b; k++) { const d = Math.abs((pts[k]![0] - ax) * dz - (pts[k]![1] - az) * dx) / len; if (d > fd) { fd = d; far = k; } }
    if (far >= 0) { keep[far] = 1; rdp(a, far); rdp(far, b); }
  };
  const mid = Math.floor(pts.length / 2);
  keep[0] = keep[mid] = 1;
  rdp(0, mid); rdp(mid, pts.length - 1); keep[pts.length - 1] = 1;
  return pts.filter((_, k) => keep[k]);
}

/**
 * How deep water would stand at cell `k` if the ground in `rect` drained only over its border
 * (a Priority-Flood of the rectangle; ground below the sea counts as an outlet).
 */
function closedDepth(hf: Heightfield, rect: CellRect, k: number, sea: number): number {
  const w = rect.i1 - rect.i0 + 1, hgt = rect.j1 - rect.j0 + 1, fill = new Float32Array(w * hgt), done = new Uint8Array(w * hgt), heap = new IndexHeap(w * 4 + hgt * 4);
  const at = (q: number) => hf.heights[(rect.j0 + Math.floor(q / w)) * hf.cols + rect.i0 + q % w]!;
  for (let q = 0; q < w * hgt; q++) {
    const i = q % w, j = Math.floor(q / w);
    if (i === 0 || j === 0 || i === w - 1 || j === hgt - 1 || at(q) < sea) { done[q] = 1; fill[q] = at(q); heap.push(q, fill[q]!); }
  }
  while (heap.size) {
    const c = heap.pop(), ci = c % w, cj = Math.floor(c / w);
    for (let d = 0; d < 8; d++) {
      const i = ci + DI[d]!, j = cj + DJ[d]!;
      if (i < 0 || j < 0 || i >= w || j >= hgt) continue;
      const q = j * w + i;
      if (done[q]) continue;
      done[q] = 1; fill[q] = Math.max(at(q), fill[c]!); heap.push(q, fill[q]!);
    }
  }
  const ki = k % hf.cols - rect.i0, kj = Math.floor(k / hf.cols) - rect.j0;
  return ki < 0 || kj < 0 || ki >= w || kj >= hgt ? 0 : fill[kj * w + ki]! - hf.heights[k]!;
}

/** Digs a basin (a blob a few metres deep with soft sides) for a lake. */
function digBasin(hf: Heightfield, x: number, z: number, radius: number, depth: number, noise: Simplex2): void {
  const r = hf.rectAround(x, z, radius * 1.4);
  for (let j = r.j0; j <= r.j1; j++) for (let i = r.i0; i <= r.i1; i++) {
    const px = i * hf.cell, pz = j * hf.cell, a = Math.atan2(pz - z, px - x);
    const rr = radius * (1 + noise.noise(Math.cos(a) * 1.3 + x * .01, Math.sin(a) * 1.3 + z * .01) * .3);
    const d = Math.hypot(px - x, pz - z) / rr;
    if (d >= 1.15) continue;
    const k = j * hf.cols + i;
    hf.heights[k] = hf.heights[k]! - depth * (1 - smoothstep(.35, 1.15, d));
  }
}

export function* buildHydrology(hf: Heightfield, opts: HydroOptions): Generator<number, HydroResult> {
  const sea = opts.seaLevel, n = hf.cols, N = n * n, H = hf.heights, cell = hf.cell, top = Math.max(30, opts.maxHeight);
  let landCells = 0;
  for (let k = 0; k < N; k++) if (H[k]! > sea) landCells++;
  const landArea = landCells * cell * cell;
  // (Scaled with the map: a 1 km island has streams too, of a smaller catchment.)
  const scale = Math.max(.25, Math.min(2, hf.size / 4096));
  const riverArea = opts.riverArea ?? Math.max(6e4 * scale * scale, Math.min(1e6, landArea * .009));

  /* Lakes: natural basins first; if too few, basins dug on flat valley floors. */
  let f = flood(hf, sea);
  yield .2;
  const wantLakes = opts.minLakes ?? 0, maxLakes = opts.maxLakes ?? 12;
  const lakeOk = (b: { cells: number[]; depth: number; level: number }) => b.cells.length * cell * cell >= 1500 * scale && b.depth >= 1.5 && b.level > sea + 1;
  let natural = basins(hf, f).filter(lakeOk).length;
  if (natural < wantLakes) {
    const A = accumulate(hf, f, sea, top), rng = new Rng(seedNumber(opts.seed, 'hydro-lakes')), noise = new Simplex2(seedNumber(opts.seed, 'hydro-lake-shape'));
    // The flattest valley floors and high basins that water reaches (not crests, not the coast).
    const cand: Array<[number, number, number]> = [], step = Math.max(2, Math.round(16 / cell));
    for (let j = 8; j < n - 8; j += step) for (let i = 8; i < n - 8; i += step) {
      const k = j * n + i, h = H[k]!, x = i * cell, z = j * cell;
      if (h < sea + 10 || h > sea + top * .65 || A[k]! < riverArea * .01 || A[k]! > riverArea * 80) continue;
      const o = 40 * scale, flat = hf.slopeAt(x, z) + (hf.slopeAt(x + o, z) + hf.slopeAt(x - o, z) + hf.slopeAt(x, z + o) + hf.slopeAt(x, z - o)) / 4;
      cand.push([x, z, flat + rng.next() * .05]);
    }
    cand.sort((a, b) => a[2] - b[2]);
    const dug: Vec2[] = [];
    for (const [x, z] of cand) {
      if (natural >= wantLakes) break;
      if (dug.some(([px, pz]) => Math.hypot(px - x, pz - z) < 450 * scale)) continue;
      // Deep enough to close below the lowest ground round it, never down to the sea (it would
      // open to it); kept only if the water really cannot run out (a local Priority-Flood over
      // the surroundings), else the ground is put back.
      const h = hf.heightAt(x, z), radius = (60 + rng.next() * 70) * Math.sqrt(scale);
      let rim = Infinity;
      for (const ring of [1.6, 1.9]) for (let a = 0; a < 160; a++) rim = Math.min(rim, hf.heightAt(x + Math.cos(a * Math.PI / 80) * radius * ring, z + Math.sin(a * Math.PI / 80) * radius * ring));
      const depth = Math.max(4, h - rim + 3 + rng.next() * 2);
      if (h - depth < sea + 2) continue;
      const area = hf.rectAround(x, z, radius * 3), before = hf.snapshot(area);
      digBasin(hf, x, z, radius, depth, noise);
      if (closedDepth(hf, area, hf.index(hf.clampI(Math.round(x / cell)), hf.clampJ(Math.round(z / cell))), sea) < 2) { hf.restore(before); continue; }
      dug.push([x, z]); natural++;
    }
    if (dug.length) f = flood(hf, sea);
  }
  yield .35;
  const all = basins(hf, f).sort((a, b) => b.cells.length - a.cells.length);
  const lakes: Lake[] = [], lakeCell = new Uint8Array(N), lakeCells: number[][] = [];
  for (const b of all) {
    const poly = lakes.length < maxLakes && lakeOk(b) ? shoreline(hf, b.cells, b.level - .25) : null;
    if (poly) {
      const level = Math.round((b.level - .25) * 10) / 10;
      lakes.push({ id: `lake-${lakes.length}`, name: `Hồ ${lakes.length + 1}`, polygon: poly, level, depth: Math.round(b.depth * 10) / 10 });
      for (const c of b.cells) lakeCell[c] = 1;
      lakeCells.push(b.cells);
    } else for (const c of b.cells) H[c] = f.fill[c]!; // filled with alluvium: no dry pits
  }
  // The same drainage, now over the filled basins.
  f = flood(hf, sea);
  const A = accumulate(hf, f, sea, top);
  yield .55;

  /* Rivers: the drainage tree where it carries enough water, mouth upwards along the main stem. */
  const river = new Uint8Array(N);
  for (let k = 0; k < N; k++) if (A[k]! >= riverArea && H[k]! >= sea && !lakeCell[k]) river[k] = 1;
  // Longest way upstream from each river cell (sources first).
  const upLen = new Float32Array(N), donors = new Map<number, number[]>();
  for (let q = f.count - 1; q >= 0; q--) {
    const c = f.order[q]!, r = f.recv[c]!;
    if (!river[c] || r === c || !river[r]) continue;
    const ci = c % n, ri = r % n, d = Math.hypot(ci - ri, (c - ci) / n - (r - ri) / n) * cell;
    upLen[r] = Math.max(upLen[r]!, upLen[c]! + d);
    (donors.get(r) ?? donors.set(r, []).get(r)!).push(c);
  }
  // Mouths: river cells draining into the sea, a lake, the edge (or a filled flat).
  const mouths: number[] = [];
  for (let k = 0; k < N; k++) if (river[k] && (f.recv[k] === k || !river[f.recv[k]!])) mouths.push(k);
  mouths.sort((a, b) => A[b]! - A[a]!);
  const widthAt = (k: number) => Math.round(Math.min(48, 2.5 + 7.5 * Math.sqrt(A[k]! / 1e6)) * 10) / 10;
  const minLen = Math.max(120 * scale, cell * 25), stride = Math.max(1, Math.round(12 / cell));
  const rivers: River[] = [];
  let systems = 0;
  for (const mouth of mouths) {
    if (systems >= (opts.maxRivers ?? 24)) break;
    if (upLen[mouth]! < minLen * 1.5) continue;
    systems++;
    // Each head: [first cell, junction cell (null at the mouth)].
    const heads: Array<[number, number | null, number]> = [[mouth, null, 0]];
    while (heads.length) {
      const [startCell, junction, order] = heads.shift()!;
      if (upLen[startCell]! < minLen) continue;
      const path: number[] = [];
      for (let c: number | undefined = startCell; c !== undefined;) {
        path.push(c);
        const ds = donors.get(c);
        if (!ds?.length) break;
        let main = ds[0]!;
        for (const d of ds) if (upLen[d]! > upLen[main]!) main = d;
        for (const d of ds) if (d !== main) heads.push([d, c, order + 1]);
        c = main;
      }
      // Source → mouth (or confluence), thinned and rounded.
      path.reverse();
      if (junction !== null) path.push(junction);
      const cells = path.filter((_, q) => q % stride === 0 || q === path.length - 1);
      let pts = cells.map((c) => ({ x: (c % n) * cell, z: Math.floor(c / n) * cell, width: widthAt(c) }));
      if (pts.length >= 3) {
        const smooth = [pts[0]!];
        for (let q = 0; q < pts.length - 1; q++) {
          const a = pts[q]!, b = pts[q + 1]!;
          if (q > 0) smooth.push({ x: a.x * .75 + b.x * .25, z: a.z * .75 + b.z * .25, width: a.width });
          if (q < pts.length - 2) smooth.push({ x: a.x * .25 + b.x * .75, z: a.z * .25 + b.z * .75, width: b.width });
        }
        smooth.push(pts[pts.length - 1]!);
        pts = smooth;
      }
      // (A map file keeps at most 512 points per river.)
      const keep = Math.ceil(pts.length / 500);
      if (keep > 1) pts = pts.filter((_, q) => q % keep === 0 || q === pts.length - 1);
      pts = pts.map((p) => ({ x: Math.round(p.x * 10) / 10, z: Math.round(p.z * 10) / 10, width: p.width }));
      if (pts.length < 2) continue;
      const w = Math.max(...pts.map((p) => p.width));
      if (rivers.length >= 120) break;
      rivers.push({ id: `river-${rivers.length}`, name: order === 0 ? `Sông ${systems}` : `Suối ${systems}.${rivers.length}`, depth: Math.round(Math.min(3.5, Math.max(1, .8 + w * .07)) * 10) / 10, points: pts });
    }
  }
  yield .75;

  /* The beds, cut into the ground; lake floors kept under their water. */
  carveRivers(hf, rivers);
  // (Under water the floor lies at least half a metre down: no ankle-deep film at the edges.)
  lakes.forEach((l, q) => { for (const c of lakeCells[q]!) if (H[c]! < l.level && H[c]! > l.level - .5) H[c] = l.level - .5; });
  yield 1;
  return { water: { lakes, rivers }, flow: A };
}
