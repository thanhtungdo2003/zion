/**
 * Scalar helpers. Only IEEE-754 basic arithmetic (+ - * / sqrt, floor) is used here so that
 * results are bit-identical across JavaScript engines. Transcendental functions (sin, exp, pow…)
 * are intentionally avoided in anything that feeds deterministic simulation or world generation.
 */

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function inverseLerp(a: number, b: number, v: number): number {
  return a === b ? 0 : (v - a) / (b - a);
}

/** Hermite smoothstep, returns 0 when v <= edge0 and 1 when v >= edge1. */
export function smoothstep(edge0: number, edge1: number, v: number): number {
  const t = clamp01((v - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** Piecewise-linear interpolation through sorted control points [[x0,y0],[x1,y1],…]. */
export function piecewiseLinear(points: ReadonlyArray<readonly [number, number]>, x: number): number {
  const first = points[0]!;
  if (x <= first[0]) return first[1];
  for (let i = 1; i < points.length; i++) {
    const p1 = points[i]!;
    if (x <= p1[0]) {
      const p0 = points[i - 1]!;
      return lerp(p0[1], p1[1], (x - p0[0]) / (p1[0] - p0[0]));
    }
  }
  return points[points.length - 1]![1];
}

export function wrapAngle(a: number): number {
  const TWO_PI = Math.PI * 2;
  a = a % TWO_PI;
  if (a > Math.PI) a -= TWO_PI;
  else if (a < -Math.PI) a += TWO_PI;
  return a;
}

export function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export function vec3(x = 0, y = 0, z = 0): Vec3 {
  return { x, y, z };
}

export function distSq3(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}
