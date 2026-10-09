import { clamp01, hashCombine, lerp, piecewiseLinear, smoothstep } from '@zion/shared';
import { Simplex2 } from './noise';

/**
 * Macro-scale world fields: continent shape, climate and large landforms. Everything here is a
 * pure function of (seed, x, z). Hydrology is computed on top of `macro` height; fine detail and
 * river carving are applied later in the column sampler.
 */
export interface BaseSample {
  /** Continentalness: < 0 ocean, ~0 coastline, > 0 inland. */
  c: number;
  /** 0..1 mountain range mask. */
  mountain: number;
  /** Climate before altitude/water adjustments, 0..1. */
  tempBase: number;
  humBase: number;
  /** 0..1 masks for landform overrides. */
  swamp: number;
  desert: number;
  /** Macro height relative to sea level (metres). */
  rel: number;
}

export function makeBaseSample(): BaseSample {
  return { c: 0, mountain: 0, tempBase: 0, humBase: 0, swamp: 0, desert: 0, rel: 0 };
}

/** Continentalness → relative height. Shelf, beach and gentle inland rise. */
const CONTINENT_SPLINE: ReadonlyArray<readonly [number, number]> = [
  [-1.0, -70],
  [-0.45, -48],
  [-0.18, -18],
  [-0.06, -4],
  [-0.015, -0.8],
  [0.0, 0.8],
  [0.05, 2.6],
  [0.18, 9],
  [0.4, 22],
  [0.7, 40],
  [1.0, 55],
];

export class WorldFields {
  private readonly warpA: Simplex2;
  private readonly warpB: Simplex2;
  private readonly coastEdge: Simplex2;
  private readonly continent: Simplex2;
  private readonly temperature: Simplex2;
  private readonly humidity: Simplex2;
  private readonly mountainMask: Simplex2;
  private readonly ridges: Simplex2;
  private readonly hills: Simplex2;
  private readonly small: Simplex2;
  private readonly dunes: Simplex2;
  private readonly detailA: Simplex2;
  private readonly detailB: Simplex2;
  private readonly rock: Simplex2;
  readonly patch: Simplex2;
  readonly cluster: Simplex2;

  constructor(
    readonly seed: number,
    readonly worldSize: number,
  ) {
    const sub = (salt: number) => new Simplex2(hashCombine(seed, salt));
    this.warpA = sub(101);
    this.warpB = sub(102);
    this.coastEdge = sub(103);
    this.continent = sub(104);
    this.temperature = sub(105);
    this.humidity = sub(106);
    this.mountainMask = sub(107);
    this.ridges = sub(108);
    this.hills = sub(109);
    this.small = sub(110);
    this.dunes = sub(111);
    this.detailA = sub(112);
    this.detailB = sub(113);
    this.rock = sub(114);
    this.patch = sub(115);
    this.cluster = sub(116);
  }

  base(x: number, z: number, o: BaseSample): BaseSample {
    const S = this.worldSize;
    const wx = x + this.warpA.fbm(x / 900, z / 900, 3) * 280;
    const wz = z + this.warpB.fbm(x / 900 + 17.3, z / 900 - 4.1, 3) * 280;

    // Continent: noise blended with a falloff so the map is an island ringed by ocean.
    const nx = x / S;
    const nz = z / S;
    const edge = Math.min(nx, 1 - nx, nz, 1 - nz) + this.coastEdge.fbm(x / 650, z / 650, 3) * 0.045;
    const falloff = smoothstep(0.03, 0.17, edge);
    let c = this.continent.fbm(wx / 1350, wz / 1350, 5) * 0.95 + 0.33;
    c = c * falloff - (1 - falloff) * 0.85;
    o.c = c;

    // Climate: latitude gradient (north = z 0 is cold) + large-scale variation.
    o.tempBase = clamp01(0.08 + 0.84 * nz + this.temperature.fbm(x / 1700, z / 1700, 3) * 0.34);
    o.humBase = clamp01(
      0.47 + this.humidity.fbm(x / 1250, z / 1250, 3) * 0.62 + 0.16 * (1 - smoothstep(-0.05, 0.3, c)),
    );

    const land = smoothstep(-0.02, 0.16, c);
    let rel = piecewiseLinear(CONTINENT_SPLINE, c);

    // Mountain ranges: ridged noise, only inland, gated by a broad mask.
    const mountain =
      smoothstep(0.06, 0.4, this.mountainMask.fbm(x / 2100, z / 2100, 3) + 0.08) * smoothstep(0.05, 0.26, c);
    if (mountain > 0) {
      const r = this.ridges.ridged(wx / 720, wz / 720, 5);
      rel += mountain * (r * r * 330 + 16);
    }
    rel += this.hills.fbm(x / 330, z / 330, 4) * 12 * land * (1 - mountain * 0.5);

    // Swamps form only in warm, very wet, low and flat terrain.
    const swamp =
      smoothstep(0.56, 0.7, o.humBase) *
      smoothstep(0.4, 0.56, o.tempBase) *
      (1 - smoothstep(0.15, 0.4, c)) *
      (1 - mountain) *
      land;
    if (swamp > 0) rel = lerp(rel, 1.3 + this.small.fbm(x / 70, z / 70, 2) * 0.9, swamp * 0.92);

    // Deserts: hot + dry; wind-shaped dunes.
    const desert =
      smoothstep(0.56, 0.68, o.tempBase) * (1 - smoothstep(0.34, 0.46, o.humBase)) * land * (1 - mountain);
    if (desert > 0) rel += this.dunes.ridged(x / 75, z / 95, 2) * 7 * desert;

    o.mountain = mountain;
    o.swamp = swamp;
    o.desert = desert;
    o.rel = rel;
    return o;
  }

  /** Small-scale relief added on top of macro height (metres). */
  detail(x: number, z: number, mountain: number): number {
    let d = this.detailA.fbm(x / 42, z / 42, 3) * 1.3 + this.detailB.fbm(x / 9, z / 9, 2) * 0.22;
    if (mountain > 0.05) d += mountain * this.rock.ridged(x / 26, z / 26, 3) * 5;
    return d;
  }

  /** Low-frequency patch noise ≈ [−1, 1] used for surface variety. */
  patchNoise(x: number, z: number): number {
    return this.patch.fbm(x / 24, z / 24, 2);
  }

  /** Forest/clearing clustering ≈ [−1, 1]. */
  clusterNoise(x: number, z: number): number {
    return this.cluster.fbm(x / 110, z / 110, 3);
  }
}
