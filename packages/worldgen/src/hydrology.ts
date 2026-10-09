import { CHUNK_SIZE, chunkKey, hash2, hashToUnit } from '@zion/shared';
import { makeBaseSample, type WorldFields } from './fields';
import { IndexHeap } from './heap';

/** Hydrology grid resolution in metres. */
export const HYDRO_CELL = 16;

const DX = [1, -1, 0, 0, 1, 1, -1, -1] as const;
const DZ = [0, 0, 1, -1, 1, -1, 1, -1] as const;
const DIST = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2] as const;

/** Drainage area (cells × rainfall) at which a stream becomes a carved river. */
const RIVER_THRESHOLD = 170;
const MIN_LAKE_CELLS = 6;
const MAX_LAKE_CELLS = 180;
const LAKE_MIN_DEPTH = 1.0;
const EPS = 1e-4;
const SEG_STRIDE = 9;

export interface RiverQuery {
  /** Distance from the river centre line (m). */
  dist: number;
  halfWidth: number;
  /** Water surface height at the closest point. */
  surface: number;
  depth: number;
}

export interface HydrologyStats {
  riverSegments: number;
  lakes: number;
  lakeCells: number;
  oceanCells: number;
  maxAccumulation: number;
}

/**
 * Global hydrology on a coarse grid (computed once per world, deterministic):
 *
 *  1. Priority-flood (Barnes et al. 2014) from the map border fills depressions; cells raised by
 *     the fill become lakes whose surface is the spill height.
 *  2. An ε-variant of the flood gives a surface where every cell drains; D8 steepest descent on it
 *     yields a drainage tree that routes through lakes to the sea.
 *  3. Flow accumulation weighted by rainfall (humidity) marks river cells; river width/depth grow
 *     with drainage area and water surface strictly decreases downstream.
 *  4. River segments are smoothed, indexed per chunk and later carved into the fine terrain.
 */
export class Hydrology {
  readonly n: number;
  readonly macro: Float32Array;
  readonly filled: Float32Array;
  readonly lakeId: Int32Array;
  readonly lakeLevels: number[] = [];
  readonly ocean: Uint8Array;
  readonly accumulation: Float32Array;
  readonly proximity: Float32Array;
  readonly segments: Float32Array;
  readonly segmentCount: number;
  private readonly buckets = new Map<number, Int32Array>();
  readonly stats: HydrologyStats;

  constructor(
    fields: WorldFields,
    readonly worldSize: number,
    readonly seaLevel: number,
  ) {
    const n = Math.round(worldSize / HYDRO_CELL);
    this.n = n;
    const N = n * n;
    this.macro = new Float32Array(N);
    const rain = new Float32Array(N);
    const b = makeBaseSample();
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        fields.base((i + 0.5) * HYDRO_CELL, (j + 0.5) * HYDRO_CELL, b);
        this.macro[j * n + i] = seaLevel + b.rel;
        rain[j * n + i] = 0.4 + b.humBase;
      }
    }

    // --- 1. Depression filling (flat) and ε-filling (drainable) ---------------------------------
    this.filled = this.priorityFlood(false) as Float32Array;
    const filledE = this.priorityFlood(true) as Float64Array;

    this.ocean = new Uint8Array(N);
    let oceanCells = 0;
    for (let k = 0; k < N; k++) {
      if (this.filled[k]! <= seaLevel) {
        this.ocean[k] = 1;
        oceanCells++;
      }
    }

    // --- Lakes: connected filled regions above sea level -----------------------------------------
    this.lakeId = new Int32Array(N).fill(-1);
    let lakeCells = 0;
    const stack: number[] = [];
    for (let k = 0; k < N; k++) {
      if (this.lakeId[k] !== -1 || !this.isLakeCandidate(k)) continue;
      const id = this.lakeLevels.length;
      const level = this.filled[k]!;
      const members: number[] = [];
      stack.push(k);
      this.lakeId[k] = id;
      while (stack.length) {
        const c = stack.pop()!;
        members.push(c);
        const ci = c % n;
        const cj = (c - ci) / n;
        for (let d = 0; d < 8; d++) {
          const ni = ci + DX[d]!;
          const nj = cj + DZ[d]!;
          if (ni < 0 || nj < 0 || ni >= n || nj >= n) continue;
          const nk = nj * n + ni;
          if (this.lakeId[nk] !== -1 || this.filled[nk] !== level || !this.isLakeCandidate(nk)) continue;
          this.lakeId[nk] = id;
          stack.push(nk);
        }
      }
      let lakeLevel = level;
      let kept = members;
      if (members.length > MAX_LAKE_CELLS) {
        // Oversized basin: the outlet has eroded down (a breach canyon is carved by the outflow
        // river), lowering the lake until it covers at most MAX_LAKE_CELLS of the deepest cells.
        const byDepth = members.slice().sort((a, b) => this.macro[a]! - this.macro[b]! || a - b);
        lakeLevel = Math.min(level, this.macro[byDepth[MAX_LAKE_CELLS - 1]!]! + LAKE_MIN_DEPTH);
        kept = members.filter((m) => lakeLevel - this.macro[m]! > LAKE_MIN_DEPTH);
        for (const m of members) if (lakeLevel - this.macro[m]! <= LAKE_MIN_DEPTH) this.lakeId[m] = -2;
      }
      if (kept.length < MIN_LAKE_CELLS) {
        for (const m of members) this.lakeId[m] = -2; // too small: dry hollow
      } else {
        this.lakeLevels.push(lakeLevel);
        lakeCells += kept.length;
      }
    }
    // Ids stay dense: a dropped component never pushed a level, so its id is reused by the next lake.
    for (let k = 0; k < N; k++) if (this.lakeId[k] === -2) this.lakeId[k] = -1;

    // --- 2. D8 drainage on the ε-filled surface --------------------------------------------------
    const down = new Int32Array(N).fill(-1);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const k = j * n + i;
        if (this.ocean[k]) continue;
        let best = -1;
        let bestSlope = 0;
        for (let d = 0; d < 8; d++) {
          const ni = i + DX[d]!;
          const nj = j + DZ[d]!;
          if (ni < 0 || nj < 0 || ni >= n || nj >= n) continue;
          const nk = nj * n + ni;
          const slope = (filledE[k]! - filledE[nk]!) / DIST[d]!;
          if (slope > bestSlope) {
            bestSlope = slope;
            best = nk;
          }
        }
        down[k] = best;
      }
    }

    // --- 3. Flow accumulation (process high → low) ------------------------------------------------
    const order = new Int32Array(N);
    for (let k = 0; k < N; k++) order[k] = k;
    const sorted = Array.from(order).sort((a, b2) => filledE[b2]! - filledE[a]! || a - b2);
    this.accumulation = new Float32Array(N);
    for (let k = 0; k < N; k++) this.accumulation[k] = rain[k]!;
    let maxAcc = 0;
    for (const k of sorted) {
      const d = down[k]!;
      if (d >= 0 && !this.ocean[k]) this.accumulation[d] = this.accumulation[d]! + this.accumulation[k]!;
    }
    for (let k = 0; k < N; k++) if (!this.ocean[k] && this.accumulation[k]! > maxAcc) maxAcc = this.accumulation[k]!;

    // --- River nodes -----------------------------------------------------------------------------
    const isRiver = new Uint8Array(N);
    for (let k = 0; k < N; k++) {
      if (this.ocean[k] || down[k]! < 0) continue;
      const lake = this.lakeId[k]! >= 0;
      if (this.accumulation[k]! < RIVER_THRESHOLD) continue;
      // Lake cells only emit the outflow segment (lake → first river cell downstream).
      if (lake && this.lakeId[down[k]!]! === this.lakeId[k]) continue;
      isRiver[k] = 1;
    }

    const halfW = new Float32Array(N);
    const depth = new Float32Array(N);
    for (let k = 0; k < N; k++) {
      if (!isRiver[k]) continue;
      const a = this.accumulation[k]! / RIVER_THRESHOLD - 1;
      const w = Math.min(26, 2.6 + 2.3 * Math.sqrt(a > 0 ? a : 0));
      halfW[k] = w * 0.5;
      depth[k] = 0.7 + w * 0.06;
    }

    // Node positions: jittered cell centres, then smoothed along the channel to remove D8 zig-zags.
    const px = new Float64Array(N);
    const pz = new Float64Array(N);
    const mainUp = new Int32Array(N).fill(-1);
    for (let k = 0; k < N; k++) {
      const i = k % n;
      const j = (k - i) / n;
      const fixed = this.ocean[k] || (this.lakeId[k]! >= 0 && !isRiver[k]);
      const jit = fixed ? 0 : 7;
      px[k] = (i + 0.5) * HYDRO_CELL + (hashToUnit(hash2(fields.seed ^ 0x51ed, i, j)) - 0.5) * jit;
      pz[k] = (j + 0.5) * HYDRO_CELL + (hashToUnit(hash2(fields.seed ^ 0x2c1b, i, j)) - 0.5) * jit;
      if (isRiver[k]) {
        const d = down[k]!;
        if (mainUp[d] === -1 || this.accumulation[k]! > this.accumulation[mainUp[d]!]!) mainUp[d] = k;
      }
    }
    for (let iter = 0; iter < 2; iter++) {
      const nx = Float64Array.from(px);
      const nz = Float64Array.from(pz);
      for (let k = 0; k < N; k++) {
        if (!isRiver[k]) continue;
        const d = down[k]!;
        const u = mainUp[k]!;
        if (u < 0 || !isRiver[d]) continue;
        nx[k] = 0.5 * px[k]! + 0.25 * px[d]! + 0.25 * px[u]!;
        nz[k] = 0.5 * pz[k]! + 0.25 * pz[d]! + 0.25 * pz[u]!;
      }
      px.set(nx);
      pz.set(nz);
    }

    // Water surface: just below the local bank, then forced to decrease strictly downstream. Where a
    // river leaves a basin over a higher rim, the downstream pass lowers the surface below the rim,
    // and terrain carving turns that into a gorge (a breached outlet).
    const surface = new Float64Array(N).fill(Number.NaN);
    for (let k = 0; k < N; k++) {
      if (this.ocean[k]) surface[k] = seaLevel;
      else if (this.lakeId[k]! >= 0) surface[k] = this.lakeLevels[this.lakeId[k]!]!;
      else if (isRiver[k]) surface[k] = this.macro[k]! - (0.6 + halfW[k]! * 0.1);
    }
    for (const k of sorted) {
      if (!isRiver[k]) continue;
      const d = down[k]!;
      if (d < 0 || this.ocean[d] || this.lakeId[d]! >= 0) continue;
      const cap = surface[k]! - 0.02;
      if (!(surface[d]! <= cap)) surface[d] = cap;
    }
    for (let k = 0; k < N; k++) if (isRiver[k] && surface[k]! < seaLevel) surface[k] = seaLevel;
    // Rivers entering a lake (or the sea) must not run uphill into it: raise the reach above.
    for (let q = sorted.length - 1; q >= 0; q--) {
      const k = sorted[q]!;
      if (!isRiver[k]) continue;
      const d = down[k]!;
      if (d < 0) continue;
      const ds = surface[d]!;
      if (ds === ds && surface[k]! < ds) surface[k] = ds;
    }

    // Segments.
    const segs: number[] = [];
    for (let k = 0; k < N; k++) {
      if (!isRiver[k]) continue;
      const d = down[k]!;
      const endHalf = isRiver[d] ? halfW[d]! : halfW[k]!;
      const ds = surface[d]!;
      segs.push(px[k]!, pz[k]!, px[d]!, pz[d]!, surface[k]!, ds === ds ? ds : seaLevel, halfW[k]!, endHalf, depth[k]!);
    }
    this.segments = Float32Array.from(segs);
    this.segmentCount = segs.length / SEG_STRIDE;
    this.indexSegments();

    // --- Water proximity (humidity boost) via two-pass chamfer distance --------------------------
    this.proximity = this.computeProximity(isRiver);

    this.stats = {
      riverSegments: this.segmentCount,
      lakes: this.lakeLevels.length,
      lakeCells,
      oceanCells,
      maxAccumulation: maxAcc,
    };
  }

  private isLakeCandidate(k: number): boolean {
    return this.filled[k]! - this.macro[k]! > LAKE_MIN_DEPTH && this.filled[k]! > this.seaLevel + 0.2;
  }

  private priorityFlood(epsilon: boolean): Float32Array | Float64Array {
    const n = this.n;
    const N = n * n;
    const out = epsilon ? new Float64Array(N) : new Float32Array(N);
    out.set(this.macro);
    const closed = new Uint8Array(N);
    const heap = new IndexHeap(4 * n + 16);
    for (let i = 0; i < n; i++) {
      for (const k of [i, (n - 1) * n + i, i * n, i * n + n - 1]) {
        if (closed[k]) continue;
        closed[k] = 1;
        heap.push(k, out[k]!);
      }
    }
    while (heap.size) {
      const c = heap.pop();
      const ci = c % n;
      const cj = (c - ci) / n;
      const level = out[c]!;
      for (let d = 0; d < 8; d++) {
        const ni = ci + DX[d]!;
        const nj = cj + DZ[d]!;
        if (ni < 0 || nj < 0 || ni >= n || nj >= n) continue;
        const nk = nj * n + ni;
        if (closed[nk]) continue;
        closed[nk] = 1;
        const floor = epsilon ? level + EPS : level;
        if (out[nk]! < floor) out[nk] = floor;
        heap.push(nk, out[nk]!);
      }
    }
    return out;
  }

  private indexSegments(): void {
    const tmp = new Map<number, number[]>();
    const s = this.segments;
    for (let q = 0; q < this.segmentCount; q++) {
      const o = q * SEG_STRIDE;
      const reach = Math.max(s[o + 6]!, s[o + 7]!) * 1.9 + 7;
      const x0 = Math.floor((Math.min(s[o]!, s[o + 2]!) - reach) / CHUNK_SIZE);
      const x1 = Math.floor((Math.max(s[o]!, s[o + 2]!) + reach) / CHUNK_SIZE);
      const z0 = Math.floor((Math.min(s[o + 1]!, s[o + 3]!) - reach) / CHUNK_SIZE);
      const z1 = Math.floor((Math.max(s[o + 1]!, s[o + 3]!) + reach) / CHUNK_SIZE);
      for (let cx = x0; cx <= x1; cx++) {
        for (let cz = z0; cz <= z1; cz++) {
          const key = chunkKey(cx, cz);
          let list = tmp.get(key);
          if (!list) tmp.set(key, (list = []));
          list.push(q);
        }
      }
    }
    for (const [k, v] of tmp) this.buckets.set(k, Int32Array.from(v));
  }

  private computeProximity(isRiver: Uint8Array): Float32Array {
    const n = this.n;
    const N = n * n;
    const dist = new Float32Array(N).fill(1e9);
    for (let k = 0; k < N; k++) if (isRiver[k] || this.lakeId[k]! >= 0) dist[k] = 0;
    const relax = (k: number, nk: number, w: number) => {
      const v = dist[nk]! + w;
      if (v < dist[k]!) dist[k] = v;
    };
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const k = j * n + i;
        if (i > 0) relax(k, k - 1, 1);
        if (j > 0) {
          relax(k, k - n, 1);
          if (i > 0) relax(k, k - n - 1, Math.SQRT2);
          if (i < n - 1) relax(k, k - n + 1, Math.SQRT2);
        }
      }
    }
    for (let j = n - 1; j >= 0; j--) {
      for (let i = n - 1; i >= 0; i--) {
        const k = j * n + i;
        if (i < n - 1) relax(k, k + 1, 1);
        if (j < n - 1) {
          relax(k, k + n, 1);
          if (i < n - 1) relax(k, k + n + 1, Math.SQRT2);
          if (i > 0) relax(k, k + n - 1, Math.SQRT2);
        }
      }
    }
    const out = new Float32Array(N);
    for (let k = 0; k < N; k++) {
      const v = 1 - dist[k]! / 10;
      out[k] = v > 0 ? v : 0;
    }
    return out;
  }

  /* ----------------------------------- queries -------------------------------------------- */

  /** Nearest river (by distance to its water edge) affecting (x, z), or false if none nearby. */
  riverAt(x: number, z: number, out: RiverQuery): boolean {
    const list = this.buckets.get(chunkKey(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE)));
    if (!list) return false;
    const s = this.segments;
    let bestScore = Infinity;
    for (let q = 0; q < list.length; q++) {
      const o = list[q]! * SEG_STRIDE;
      const ax = s[o]!;
      const az = s[o + 1]!;
      const bx = s[o + 2]!;
      const bz = s[o + 3]!;
      const abx = bx - ax;
      const abz = bz - az;
      const len2 = abx * abx + abz * abz;
      let t = len2 > 0 ? ((x - ax) * abx + (z - az) * abz) / len2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const cx = ax + abx * t - x;
      const cz = az + abz * t - z;
      const d = Math.sqrt(cx * cx + cz * cz);
      const hw = s[o + 6]! + (s[o + 7]! - s[o + 6]!) * t;
      const reach = hw * 1.9 + 7;
      if (d > reach) continue;
      const score = d - hw;
      if (score < bestScore) {
        bestScore = score;
        out.dist = d;
        out.halfWidth = hw;
        out.surface = s[o + 4]! + (s[o + 5]! - s[o + 4]!) * t;
        out.depth = s[o + 8]!;
      }
    }
    return bestScore !== Infinity;
  }

  /**
   * Lake surface if (x,z) lies inside a lake cell or within half a cell of one, else NaN.
   * The visible shoreline is then defined by where fine terrain rises above this level.
   */
  lakeLevelNear(x: number, z: number): number {
    const n = this.n;
    const ci = Math.floor(x / HYDRO_CELL);
    const cj = Math.floor(z / HYDRO_CELL);
    const reach = HYDRO_CELL * 0.5;
    let level = Number.NaN;
    for (let dj = -1; dj <= 1; dj++) {
      const j = cj + dj;
      if (j < 0 || j >= n) continue;
      const ez = Math.max(j * HYDRO_CELL - z, 0, z - (j + 1) * HYDRO_CELL);
      if (ez > reach) continue;
      for (let di = -1; di <= 1; di++) {
        const i = ci + di;
        if (i < 0 || i >= n) continue;
        const id = this.lakeId[j * n + i]!;
        if (id < 0) continue;
        const ex = Math.max(i * HYDRO_CELL - x, 0, x - (i + 1) * HYDRO_CELL);
        if (ex * ex + ez * ez > reach * reach) continue;
        const l = this.lakeLevels[id]!;
        if (!(l <= level)) level = l;
      }
    }
    return level;
  }

  /** Bilinear water-proximity factor 0..1. */
  proximityAt(x: number, z: number): number {
    const n = this.n;
    const fx = x / HYDRO_CELL - 0.5;
    const fz = z / HYDRO_CELL - 0.5;
    let i = Math.floor(fx);
    let j = Math.floor(fz);
    let tx = fx - i;
    let tz = fz - j;
    if (i < 0) {
      i = 0;
      tx = 0;
    } else if (i >= n - 1) {
      i = n - 2;
      tx = 1;
    }
    if (j < 0) {
      j = 0;
      tz = 0;
    } else if (j >= n - 1) {
      j = n - 2;
      tz = 1;
    }
    const p = this.proximity;
    const a = p[j * n + i]!;
    const b = p[j * n + i + 1]!;
    const c = p[(j + 1) * n + i]!;
    const d = p[(j + 1) * n + i + 1]!;
    return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
  }

  /** Segment endpoints for debugging/visualisation: [ax, az, bx, bz, surfaceA, surfaceB, halfWA, halfWB, depth]. */
  segment(q: number): Float32Array {
    return this.segments.subarray(q * SEG_STRIDE, (q + 1) * SEG_STRIDE);
  }
}
