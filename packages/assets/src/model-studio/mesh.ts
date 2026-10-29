import type { Opening } from './doc';
import { Random, fbm3, hash01, noise3 } from './noise';

/**
 * Triangle meshes for the Model Studio's procedural parts. UVs are in metres (a material's tile
 * size divides them), projected per face on the part's own axes, so neighbouring pieces of a
 * wall line their bricks up and a stretched box does not stretch its texture.
 */
export interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
}

/** A mesh and which of the part's material slots it uses ('main', 'inner', 'glass', …). */
export interface MeshPart { slot: string; mesh: MeshData }

type V3 = [number, number, number];

export class MeshBuilder {
  readonly p: number[] = [];
  readonly n: number[] = [];
  readonly uv: number[] = [];
  readonly idx: number[] = [];

  vertex(pos: V3, nrm: V3, u: number, v: number): number {
    this.p.push(pos[0], pos[1], pos[2]); this.n.push(nrm[0], nrm[1], nrm[2]); this.uv.push(u, v);
    return this.p.length / 3 - 1;
  }

  /** A planar polygon (convex, counter-clockwise seen from its front), UVs by box projection. */
  face(pts: V3[]): void {
    if (pts.length < 3) return;
    const nrm = faceNormal(pts);
    if (!nrm) return;
    const first = this.p.length / 3;
    for (const q of pts) { const [u, v] = boxUv(q, nrm); this.vertex(q, nrm, u, v); }
    for (let i = 1; i + 1 < pts.length; i++) this.idx.push(first, first + i, first + i + 1);
  }

  /** An axis-aligned rectangle face: corners a→b→c→d counter-clockwise from the front. */
  quad(a: V3, b: V3, c: V3, d: V3): void { this.face([a, b, c, d]); }

  /** An axis-aligned box from min to max (all six faces). */
  box(min: V3, max: V3, skip: { bottom?: boolean; top?: boolean } = {}): void {
    const [x0, y0, z0] = min, [x1, y1, z1] = max;
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]);
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]);
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]);
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]);
    if (!skip.top) this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]);
    if (!skip.bottom) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]);
  }

  append(m: MeshData): void {
    const first = this.p.length / 3;
    for (const v of m.positions) this.p.push(v);
    for (const v of m.normals) this.n.push(v);
    for (const v of m.uvs) this.uv.push(v);
    for (const i of m.indices) this.idx.push(first + i);
  }

  get empty(): boolean { return this.idx.length === 0; }

  build(): MeshData {
    return { positions: new Float32Array(this.p), normals: new Float32Array(this.n), uvs: new Float32Array(this.uv), indices: new Uint32Array(this.idx) };
  }
}

function faceNormal(pts: V3[]): V3 | null {
  // Newell's method (robust for any planar polygon).
  let x = 0, y = 0, z = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!, b = pts[(i + 1) % pts.length]!;
    x += (a[1] - b[1]) * (a[2] + b[2]); y += (a[2] - b[2]) * (a[0] + b[0]); z += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const l = Math.hypot(x, y, z);
  return l < 1e-9 ? null : [x / l, y / l, z / l];
}

/** Box projection in metres: walls read upright (v down the wall), floors and roofs by x/z. */
function boxUv(p: V3, n: V3): [number, number] {
  const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
  if (ay >= ax && ay >= az) return [p[0], n[1] > 0 ? p[2] : -p[2]];
  if (ax >= az) return [n[0] > 0 ? -p[2] : p[2], -p[1]];
  return [n[2] > 0 ? p[0] : -p[0], -p[1]];
}

/** Smooth vertex normals from the triangles (for organic shapes with shared vertices). */
export function smoothNormals(pos: number[], idx: number[]): number[] {
  const n = new Array<number>(pos.length).fill(0);
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i]! * 3, b = idx[i + 1]! * 3, c = idx[i + 2]! * 3;
    const ux = pos[b]! - pos[a]!, uy = pos[b + 1]! - pos[a + 1]!, uz = pos[b + 2]! - pos[a + 2]!;
    const vx = pos[c]! - pos[a]!, vy = pos[c + 1]! - pos[a + 1]!, vz = pos[c + 2]! - pos[a + 2]!;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const k of [a, b, c]) { n[k] += nx; n[k + 1] += ny; n[k + 2] += nz; }
  }
  for (let i = 0; i < n.length; i += 3) { const l = Math.hypot(n[i]!, n[i + 1]!, n[i + 2]!) || 1; n[i] /= l; n[i + 1] /= l; n[i + 2] /= l; }
  return n;
}

const P = (params: Record<string, number>, key: string, fallback: number, min = .001, max = 1e4) => {
  const v = params[key];
  return v === undefined || !Number.isFinite(v) ? fallback : Math.max(min, Math.min(max, v));
};

/** Revolved shape (cylinder, cone, frustum): base at y = 0. */
function lathe(b: MeshBuilder, rBottom: number, rTop: number, h: number, seg: number, caps = true): void {
  const first = b.p.length / 3, slope = (rBottom - rTop) / h;
  for (let i = 0; i <= seg; i++) {
    const a = i / seg * Math.PI * 2, c = Math.cos(a), s = Math.sin(a), l = Math.hypot(1, slope);
    const nrm: V3 = [s / l, slope / l, c / l];
    b.vertex([s * rBottom, 0, c * rBottom], nrm, a * Math.max(rBottom, rTop), 0);
    b.vertex([s * rTop, h, c * rTop], nrm, a * Math.max(rBottom, rTop), -h);
  }
  for (let i = 0; i < seg; i++) { const k = first + i * 2; b.idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
  if (!caps) return;
  const ring = (r: number, y: number, up: boolean) => {
    if (r <= 1e-4) return;
    const pts: V3[] = [];
    for (let i = 0; i < seg; i++) { const a = i / seg * Math.PI * 2; pts.push([Math.sin(a) * r, y, Math.cos(a) * r]); }
    b.face(up ? pts : pts.reverse());
  };
  ring(rTop, h, true);
  ring(rBottom, 0, false);
}

function sphere(b: MeshBuilder, r: number, seg: number, cy: number): void {
  const rings = Math.max(4, Math.round(seg / 2)), first = b.p.length / 3;
  for (let j = 0; j <= rings; j++) {
    const t = j / rings * Math.PI, y = Math.cos(t), s = Math.sin(t);
    for (let i = 0; i <= seg; i++) {
      const a = i / seg * Math.PI * 2, nrm: V3 = [Math.sin(a) * s, y, Math.cos(a) * s];
      b.vertex([nrm[0] * r, cy + nrm[1] * r, nrm[2] * r], nrm, a * r, t * r);
    }
  }
  for (let j = 0; j < rings; j++) for (let i = 0; i < seg; i++) {
    const a = first + j * (seg + 1) + i, c = a + seg + 1;
    b.idx.push(a, c, a + 1, a + 1, c, c + 1);
  }
}

function torus(b: MeshBuilder, R: number, r: number, seg: number): void {
  const tube = Math.max(6, Math.round(seg / 2)), first = b.p.length / 3;
  for (let j = 0; j <= seg; j++) {
    const a = j / seg * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
    for (let i = 0; i <= tube; i++) {
      const t = i / tube * Math.PI * 2, ct = Math.cos(t), st = Math.sin(t);
      const nrm: V3 = [ca * ct, st, sa * ct];
      b.vertex([ca * (R + r * ct), r + r * st, sa * (R + r * ct)], nrm, a * R, t * r);
    }
  }
  for (let j = 0; j < seg; j++) for (let i = 0; i < tube; i++) {
    const a = first + j * (tube + 1) + i, c = a + tube + 1;
    b.idx.push(a, a + 1, c, a + 1, c + 1, c);
  }
}

/** A primitive shape from its parameters (metres). Base on y = 0 unless noted. */
export function primitiveMesh(shape: string, params: Record<string, number>): MeshData {
  const b = new MeshBuilder();
  const seg = Math.round(P(params, 'segments', 24, 3, 128));
  switch (shape) {
    case 'box': {
      const w = P(params, 'width', 1), h = P(params, 'height', 1), d = P(params, 'depth', 1);
      b.box([-w / 2, 0, -d / 2], [w / 2, h, d / 2]);
      break;
    }
    case 'cylinder': { const r = P(params, 'radius', .5); lathe(b, r, r, P(params, 'height', 1), seg); break; }
    case 'cone': lathe(b, P(params, 'radius', .5), P(params, 'radiusTop', 0, 0), P(params, 'height', 1), seg); break;
    case 'sphere': { const r = P(params, 'radius', .5); sphere(b, r, seg, r); break; }
    case 'capsule': {
      const r = P(params, 'radius', .3), h = Math.max(P(params, 'height', 1.6), r * 2);
      lathe(b, r, r, h - 2 * r, seg, false);
      const body = b.build(), out = new MeshBuilder();
      for (let i = 0; i < body.positions.length; i += 3) body.positions[i + 1] += r;
      out.append(body);
      const top = new MeshBuilder(); sphere(top, r, seg, h - r);
      const bot = new MeshBuilder(); sphere(bot, r, seg, r);
      out.append(top.build()); out.append(bot.build());
      return out.build();
    }
    case 'plane': {
      const w = P(params, 'width', 1), d = P(params, 'depth', 1);
      b.quad([-w / 2, 0, d / 2], [w / 2, 0, d / 2], [w / 2, 0, -d / 2], [-w / 2, 0, -d / 2]);
      break;
    }
    case 'wedge': {
      // Triangular prism along x; `ridge` 0..1 places the apex across the depth (.5 gable end, 0 ramp).
      const w = P(params, 'width', 1), h = P(params, 'height', 1), d = P(params, 'depth', 1), rz = -d / 2 + d * P(params, 'ridge', .5, 0, 1);
      const x0 = -w / 2, x1 = w / 2, z0 = -d / 2, z1 = d / 2;
      b.face([[x1, 0, z0], [x1, 0, z1], [x1, h, rz]]);
      b.face([[x0, 0, z1], [x0, 0, z0], [x0, h, rz]]);
      b.face([[x0, 0, z1], [x1, 0, z1], [x1, h, rz], [x0, h, rz]]);
      b.face([[x1, 0, z0], [x0, 0, z0], [x0, h, rz], [x1, h, rz]]);
      b.quad([x0, 0, z0], [x1, 0, z0], [x1, 0, z1], [x0, 0, z1]);
      break;
    }
    case 'torus': torus(b, P(params, 'radius', .5), P(params, 'tube', .1), seg); break;
    default: b.box([-.5, 0, -.5], [.5, 1, .5]);
  }
  return b.build();
}

/**
 * A natural rock: an icosphere pushed out by layered noise, cut into strata and flattened where
 * it sits, sunk a little into the ground. `size` the bounding box (m), `roughness` 0..1 how
 * jagged, `layers` how strongly it splits into beds, `detail` 1..5 subdivisions.
 */
export function rockMesh(params: Record<string, number>): MeshData {
  const sx = P(params, 'width', 2), sy = P(params, 'height', 1.4), sz = P(params, 'depth', 1.8);
  const seed = Math.round(P(params, 'seed', 1, 0, 0xffffffff)), rough = P(params, 'roughness', .5, 0, 1), layers = P(params, 'layers', .35, 0, 1);
  const detail = Math.round(P(params, 'detail', 4, 1, 5));
  // Icosphere.
  const t = (1 + Math.sqrt(5)) / 2;
  let verts: V3[] = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map((v) => { const l = Math.hypot(...(v as V3)); return [v[0]! / l, v[1]! / l, v[2]! / l] as V3; });
  let faces = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  for (let s = 0; s < detail; s++) {
    const mid = new Map<string, number>(), next: number[][] = [];
    const m = (a: number, c: number) => {
      const key = a < c ? `${a}_${c}` : `${c}_${a}`;
      let i = mid.get(key);
      if (i === undefined) { const p = verts[a]!, q = verts[c]!, x = (p[0] + q[0]) / 2, y = (p[1] + q[1]) / 2, z = (p[2] + q[2]) / 2, l = Math.hypot(x, y, z); i = verts.length; verts.push([x / l, y / l, z / l]); mid.set(key, i); }
      return i;
    };
    for (const [a, c, d] of faces as Array<[number, number, number]>) { const ab = m(a, c), bc = m(c, d), ca = m(d, a); next.push([a, ab, ca], [c, bc, ab], [d, ca, bc], [ab, bc, ca]); }
    faces = next;
  }
  const rnd = new Random(seed), ox = rnd.range(-50, 50), oz = rnd.range(-50, 50), tilt = rnd.range(-.25, .25);
  verts = verts.map(([x, y, z]) => {
    // Big lumps, then sharp detail; ridged noise gives broken facets.
    const lump = fbm3(seed, x * 1.1 + ox, y * 1.1, z * 1.1 + oz, 3) * .35;
    const ridged = (1 - Math.abs(noise3(seed + 5, x * 3 + ox, y * 3, z * 3 + oz))) * .3 * rough;
    const fine = fbm3(seed + 9, x * 6, y * 6, z * 6, 3) * .08 * rough;
    let r = 1 + lump + ridged + fine;
    let py = y * r;
    // Bedding planes: heights pulled toward terraces, slightly tilted.
    if (layers > 0) {
      const bed = .22, q = (py + x * tilt) / bed, f = q - Math.floor(q);
      py += (Math.round(q) - q) * bed * layers * .85 * (f > .5 ? 1 : .6);
    }
    // Flat underside where it rests.
    if (py < -.55) py = -.55 + (py + .55) * .15;
    r = Math.max(.3, r);
    return [x * r, py, z * r];
  });
  let minY = Infinity;
  for (const v of verts) minY = Math.min(minY, v[1]);
  let maxY = -Infinity, maxR = 0;
  for (const v of verts) { maxY = Math.max(maxY, v[1]); maxR = Math.max(maxR, Math.abs(v[0]), Math.abs(v[2])); }
  const scaleY = sy / (maxY - minY), scaleX = sx / 2 / maxR, scaleZ = sz / 2 / maxR, sink = sy * .08;
  const pos: number[] = [];
  for (const v of verts) pos.push(v[0] * scaleX, (v[1] - minY) * scaleY - sink, v[2] * scaleZ);
  const idx = faces.flat();
  const nrm = smoothNormals(pos, idx);
  // Unshared triangles for clean box-projected UVs (no seams smeared across a triangle).
  const b = new MeshBuilder();
  for (let i = 0; i < idx.length; i += 3) {
    const tri = [idx[i]!, idx[i + 1]!, idx[i + 2]!];
    const pts = tri.map((k) => [pos[k * 3]!, pos[k * 3 + 1]!, pos[k * 3 + 2]!] as V3);
    const fn = faceNormal(pts);
    if (!fn) continue;
    // A facet folded over by the displacement keeps its own normal (never shaded inside out).
    const folded = tri.reduce((sum, k) => sum + nrm[k * 3]! * fn[0] + nrm[k * 3 + 1]! * fn[1] + nrm[k * 3 + 2]! * fn[2], 0) < 0;
    for (let c = 0; c < 3; c++) {
      const k = tri[c]!, [u, v] = boxUv(pts[c]!, fn);
      b.vertex(pts[c]!, folded ? fn : [nrm[k * 3]!, nrm[k * 3 + 1]!, nrm[k * 3 + 2]!], u, v);
    }
    const f = b.p.length / 3 - 3;
    b.idx.push(f, f + 1, f + 2);
  }
  return b.build();
}

/**
 * Splits a rectangle [a0, a1] × [b0, b1] into the grid cells its holes' edges make: each cell
 * solid or open. Walls (along × up) and floors (x × z) cut their doors, windows and stairwells
 * from it, so every remaining face is a clean rectangle.
 */
function cells(a0: number, a1: number, b0: number, b1: number, holes: Array<[number, number, number, number]>) {
  const as = new Set([a0, a1]), bs = new Set([b0, b1]);
  for (const [x0, x1, y0, y1] of holes) {
    for (const v of [x0, x1]) if (v > a0 && v < a1) as.add(v);
    for (const v of [y0, y1]) if (v > b0 && v < b1) bs.add(v);
  }
  const A = [...as].sort((x, y) => x - y), B = [...bs].sort((x, y) => x - y);
  const open = (i: number, j: number) => {
    const ca = (A[i]! + A[i + 1]!) / 2, cb = (B[j]! + B[j + 1]!) / 2;
    return holes.some(([x0, x1, y0, y1]) => ca > x0 && ca < x1 && cb > y0 && cb < y1);
  };
  return { A, B, open };
}

/**
 * A straight wall along x (centred), base at y = 0, `thickness` across z, with its openings cut
 * through: outer face (+z, slot 'main'), inner face (−z, slot 'inner'), reveals round every
 * opening, top and ends. Openings overlapping the wall's ends are clipped.
 */
export function wallMesh(length: number, height: number, thickness: number, openings: readonly Opening[]): MeshPart[] {
  const outer = new MeshBuilder(), inner = new MeshBuilder();
  const L = length / 2, z1 = thickness / 2, z0 = -thickness / 2;
  const holes = openings
    .map((o) => [Math.max(-L, o.offset - o.width / 2), Math.min(L, o.offset + o.width / 2), Math.max(0, o.sill), Math.min(height, o.sill + o.height)] as [number, number, number, number])
    .filter(([x0, x1, y0, y1]) => x1 - x0 > .01 && y1 - y0 > .01);
  const { A, B, open } = cells(-L, L, 0, height, holes);
  for (let j = 0; j + 1 < B.length; j++) {
    // Runs of solid cells in a row become one quad.
    let i = 0;
    while (i + 1 < A.length) {
      if (open(i, j)) { i++; continue; }
      let k = i;
      while (k + 2 < A.length && !open(k + 1, j)) k++;
      const xa = A[i]!, xb = A[k + 1]!, ya = B[j]!, yb = B[j + 1]!;
      outer.quad([xa, ya, z1], [xb, ya, z1], [xb, yb, z1], [xa, yb, z1]);
      inner.quad([xb, ya, z0], [xa, ya, z0], [xa, yb, z0], [xb, yb, z0]);
      i = k + 1;
    }
  }
  // Reveals: the faces inside each opening (jambs, sill, head).
  for (const [x0, x1, y0, y1] of holes) {
    if (x0 > -L + 1e-4) outer.quad([x0, y0, z1], [x0, y0, z0], [x0, y1, z0], [x0, y1, z1]);
    if (x1 < L - 1e-4) outer.quad([x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]);
    if (y0 > 1e-4) outer.quad([x0, y0, z1], [x1, y0, z1], [x1, y0, z0], [x0, y0, z0]);
    if (y1 < height - 1e-4) outer.quad([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]);
  }
  // Top (except over openings reaching it) and the two ends.
  const top: Array<[number, number]> = [];
  let start = -L;
  for (const [x0, x1, , y1] of [...holes].sort((a, c) => a[0] - c[0])) if (y1 >= height - 1e-4) { if (x0 > start) top.push([start, x0]); start = Math.max(start, x1); }
  if (start < L) top.push([start, L]);
  for (const [xa, xb] of top) outer.quad([xa, height, z1], [xb, height, z1], [xb, height, z0], [xa, height, z0]);
  for (const [x, sign] of [[-L, -1], [L, 1]] as const) {
    const blocked = holes.filter(([x0, x1]) => (sign < 0 ? x0 <= -L + 1e-4 : x1 >= L - 1e-4)).map(([, , y0, y1]) => [y0, y1] as [number, number]).sort((a, c) => a[0] - c[0]);
    let y = 0;
    const run = (ya: number, yb: number) => { if (yb - ya > 1e-4) { if (sign > 0) outer.quad([x, ya, z1], [x, ya, z0], [x, yb, z0], [x, yb, z1]); else outer.quad([x, ya, z0], [x, ya, z1], [x, yb, z1], [x, yb, z0]); } };
    for (const [ya, yb] of blocked) { run(y, ya); y = Math.max(y, yb); }
    run(y, height);
  }
  return [{ slot: 'main', mesh: outer.build() }, { slot: 'inner', mesh: inner.build() }];
}

/** A floor/ceiling slab: top at y = thickness, base at 0, centred, with rectangular holes. */
export function slabMesh(width: number, depth: number, thickness: number, holes: ReadonlyArray<{ x: number; z: number; width: number; depth: number }>): MeshData {
  const b = new MeshBuilder(), W = width / 2, D = depth / 2, t = thickness;
  const rects = holes.map((h) => [h.x - h.width / 2, h.x + h.width / 2, h.z - h.depth / 2, h.z + h.depth / 2] as [number, number, number, number]);
  const { A, B, open } = cells(-W, W, -D, D, rects);
  const solid = (i: number, j: number) => i >= 0 && j >= 0 && i + 1 < A.length && j + 1 < B.length && !open(i, j);
  for (let j = 0; j + 1 < B.length; j++) for (let i = 0; i + 1 < A.length; i++) {
    if (!solid(i, j)) continue;
    const x0 = A[i]!, x1 = A[i + 1]!, z0 = B[j]!, z1 = B[j + 1]!;
    b.quad([x0, t, z1], [x1, t, z1], [x1, t, z0], [x0, t, z0]);
    b.quad([x0, 0, z0], [x1, 0, z0], [x1, 0, z1], [x0, 0, z1]);
    if (!solid(i, j + 1)) b.quad([x0, 0, z1], [x1, 0, z1], [x1, t, z1], [x0, t, z1]);
    if (!solid(i, j - 1)) b.quad([x1, 0, z0], [x0, 0, z0], [x0, t, z0], [x1, t, z0]);
    if (!solid(i + 1, j)) b.quad([x1, 0, z1], [x1, 0, z0], [x1, t, z0], [x1, t, z1]);
    if (!solid(i - 1, j)) b.quad([x0, 0, z0], [x0, 0, z1], [x0, t, z1], [x0, t, z0]);
  }
  return b.build();
}

/** A slab as its top and edges ('main') and its underside ('bottom', the ceiling below). */
export function slabParts(width: number, depth: number, thickness: number, holes: ReadonlyArray<{ x: number; z: number; width: number; depth: number }>): MeshPart[] {
  const all = slabMesh(width, depth, thickness, holes);
  const top: number[] = [], bottom: number[] = [];
  for (let i = 0; i < all.indices.length; i += 3) {
    const a = all.indices[i]!;
    (all.normals[a * 3 + 1]! < -.9 ? bottom : top).push(all.indices[i]!, all.indices[i + 1]!, all.indices[i + 2]!);
  }
  return [{ slot: 'main', mesh: { ...all, indices: new Uint32Array(top) } }, { slot: 'bottom', mesh: { ...all, indices: new Uint32Array(bottom) } }];
}

/** A straight flight going up toward +z from z = 0: solid steps (treads, risers, sides, back). */
export function stairsMesh(width: number, rise: number, run: number, steps: number): MeshData {
  const b = new MeshBuilder(), W = width / 2, r = rise / steps, g = run / steps;
  for (let i = 0; i < steps; i++) {
    const y0 = i * r, y1 = (i + 1) * r, z0 = i * g, z1 = (i + 1) * g;
    b.quad([-W, y1, z1], [W, y1, z1], [W, y1, z0], [-W, y1, z0]);
    // Riser faces the walker coming up (−z).
    b.quad([W, y0, z0], [-W, y0, z0], [-W, y1, z0], [W, y1, z0]);
    // Sides: the column under this tread.
    b.quad([W, 0, z1], [W, 0, z0], [W, y1, z0], [W, y1, z1]);
    b.quad([-W, 0, z0], [-W, 0, z1], [-W, y1, z1], [-W, y1, z0]);
  }
  b.quad([-W, 0, run], [W, 0, run], [W, rise, run], [-W, rise, run]);
  return b.build();
}

/**
 * A roof over a `width` (x) × `depth` (z) plan whose eaves sit at y = 0: gable (ridge along x),
 * hip, shed (falling toward +z) or flat; `overhang` past the walls, slab `thickness`. Gable, shed
 * and flat roofs are laid as panels of about a metre; `damage` removes a clustered share of them
 * (each hole gets its broken edges).
 */
export function roofMesh(style: string, width: number, depth: number, rise: number, overhang: number, thickness: number, damage: number, seed: number): MeshData {
  const b = new MeshBuilder(), o = overhang, W = width / 2 + o, t = thickness;
  if (style === 'hip') {
    const D = depth / 2 + o, slope = rise / (depth / 2), drop = o * slope, ridge = Math.max(0, W - D);
    const e = -drop, top = rise;
    const c: V3[] = [[-W, e, D], [W, e, D], [W, e, -D], [-W, e, -D]];
    const r0: V3 = [-ridge, top, 0], r1: V3 = [ridge, top, 0];
    const down = (p: V3): V3 => [p[0], p[1] - t, p[2]];
    b.face([c[0]!, c[1]!, r1, r0]); b.face([c[2]!, c[3]!, r0, r1]); b.face([c[1]!, c[2]!, r1]); b.face([c[3]!, c[0]!, r0]);
    b.face([down(r0), down(r1), down(c[1]!), down(c[0]!)]); b.face([down(r1), down(r0), down(c[3]!), down(c[2]!)]); b.face([down(r1), down(c[2]!), down(c[1]!)]); b.face([down(r0), down(c[0]!), down(c[3]!)]);
    for (let i = 0; i < 4; i++) { const p = c[i]!, q = c[(i + 1) % 4]!; b.quad(down(p), down(q), q, p); }
    return b.build();
  }
  // Panels: (s along x, k down the slope) → position on a slope plane.
  type Slope = { z0: number; z1: number; y0: number; y1: number };
  const slopes: Slope[] = [];
  if (style === 'gable') {
    const D = depth / 2 + o, run = depth / 2, k = rise / run;
    slopes.push({ z0: 0, z1: D, y0: rise, y1: rise - k * D }, { z0: 0, z1: -D, y0: rise, y1: rise - k * D });
  } else if (style === 'shed') {
    const D = depth / 2 + o, k = rise / depth;
    slopes.push({ z0: -D, z1: D, y0: rise + k * o, y1: -k * o });
  } else {
    const D = depth / 2 + o;
    slopes.push({ z0: -D, z1: D, y0: 0, y1: 0 });
  }
  const rnd = new Random(seed);
  const off = rnd.range(0, 100);
  for (const s of slopes) {
    const len = Math.hypot(s.z1 - s.z0, s.y1 - s.y0);
    const ni = Math.max(1, Math.round((W * 2) / 1.2)), nk = Math.max(1, Math.round(len / 1.2));
    const missing = (i: number, k: number) => {
      if (i < 0 || k < 0 || i >= ni || k >= nk) return true;
      if (damage <= 0) return false;
      // Clustered collapse: noise over the panel grid, plus a few lone missing panels.
      const n = noise3(seed, i * .45 + off, k * .45, s.z1 > 0 ? 1 : 7) * .5 + .5 + (hash01(seed, i, k, s.z1 > 0 ? 3 : 9) - .5) * .35;
      return n < damage * .9;
    };
    // Panel corner on the top surface; the underside is `t` lower.
    const at = (i: number, k: number, under = false): V3 => {
      const x = -W + (2 * W) * i / ni, f = k / nk;
      return [x, s.y0 + (s.y1 - s.y0) * f - (under ? t : 0), s.z0 + (s.z1 - s.z0) * f];
    };
    const flip = s.z1 < s.z0;
    const q = (a: V3, c: V3, d: V3, e: V3) => (flip ? b.quad(e, d, c, a) : b.quad(a, c, d, e));
    for (let k = 0; k < nk; k++) for (let i = 0; i < ni; i++) {
      if (missing(i, k)) continue;
      const p00 = at(i, k), p10 = at(i + 1, k), p01 = at(i, k + 1), p11 = at(i + 1, k + 1);
      const u00 = at(i, k, true), u10 = at(i + 1, k, true), u01 = at(i, k + 1, true), u11 = at(i + 1, k + 1, true);
      q(p01, p11, p10, p00);
      q(u00, u10, u11, u01);
      if (missing(i, k + 1)) q(u01, u11, p11, p01);
      if (missing(i, k - 1)) q(u10, u00, p00, p10);
      if (missing(i + 1, k)) q(u11, u10, p10, p11);
      if (missing(i - 1, k)) q(u00, u01, p01, p00);
    }
  }
  return b.build();
}

/** A planar face wound so its normal points along `out` (no winding mistakes in built shapes). */
function orientedFace(b: MeshBuilder, pts: V3[], out: V3): void {
  const n = faceNormal(pts);
  if (!n) return;
  b.face(n[0] * out[0] + n[1] * out[1] + n[2] * out[2] < 0 ? [...pts].reverse() : pts);
}

/** A vertical prism over a convex footprint (x, z corners), from `y0` up to `y1`. */
function prism(b: MeshBuilder, foot: Array<[number, number]>, y0: number, y1: number): void {
  if (y1 - y0 < 1e-4) return;
  const cx = foot.reduce((s, p) => s + p[0], 0) / foot.length, cz = foot.reduce((s, p) => s + p[1], 0) / foot.length;
  orientedFace(b, foot.map(([x, z]) => [x, y1, z] as V3), [0, 1, 0]);
  orientedFace(b, foot.map(([x, z]) => [x, y0, z] as V3), [0, -1, 0]);
  for (let i = 0; i < foot.length; i++) {
    const [ax, az] = foot[i]!, [bx, bz] = foot[(i + 1) % foot.length]!;
    orientedFace(b, [[ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az]], [(ax + bx) / 2 - cx, 0, (az + bz) / 2 - cz]);
  }
}

/** A sloped beam from (x0, z0) at top height y0 to (x1, z1) at y1: `w` wide, `d` deep below its top. */
function slopedBeam(b: MeshBuilder, x0: number, z0: number, y0: number, x1: number, z1: number, y1: number, w: number, d: number): void {
  const len = Math.hypot(x1 - x0, z1 - z0) || 1, px = -(z1 - z0) / len * w / 2, pz = (x1 - x0) / len * w / 2;
  const tl: V3 = [x0 - px, y0, z0 - pz], tr: V3 = [x0 + px, y0, z0 + pz], tl1: V3 = [x1 - px, y1, z1 - pz], tr1: V3 = [x1 + px, y1, z1 + pz];
  const dn = (p: V3): V3 => [p[0], p[1] - d, p[2]];
  const mid: V3 = [(x0 + x1) / 2, (y0 + y1) / 2 - d / 2, (z0 + z1) / 2];
  const face = (pts: V3[]) => {
    const c = pts.reduce((s, p) => [s[0] + p[0] / pts.length, s[1] + p[1] / pts.length, s[2] + p[2] / pts.length] as V3, [0, 0, 0] as V3);
    orientedFace(b, pts, [c[0] - mid[0], c[1] - mid[1], c[2] - mid[2]]);
  };
  face([tl, tr, tr1, tl1]); face([dn(tl), dn(tr), dn(tr1), dn(tl1)]);
  face([tl, tl1, dn(tl1), dn(tl)]); face([tr, tr1, dn(tr1), dn(tr)]);
  face([tl, tr, dn(tr), dn(tl)]); face([tl1, tr1, dn(tr1), dn(tl1)]);
}

export interface StairDesign {
  width: number; rise: number; run: number; steps: number;
  shape?: 'straight' | 'l' | 'u' | 'spiral'; style?: 'solid' | 'stringer' | 'open';
  turn?: 'left' | 'right'; landing?: number; treadThickness?: number; railing?: boolean;
}

/** Footprint of a spiral flight (post at its centre): the square it needs. */
export const spiralRadius = (width: number) => Math.max(.9, width + .15);

/**
 * A designed flight of stairs climbing from z = 0 toward +z (x across, centred), its first tread
 * edge at the origin: straight, L (quarter turn on a square landing), U (half turn, the second
 * flight beside the first) or spiral round a post; solid (filled under), stringer (treads
 * between side beams) or open (floating treads on a central beam); with a handrail on posts.
 * `run` is the horizontal length of one tread times the steps (the treads' depth comes from it).
 * Slot 'main' is the treads, landings and fill, 'rail' the beams, post and handrail.
 */
export function stairsDesign(d: StairDesign): MeshPart[] {
  const main = new MeshBuilder(), rail = new MeshBuilder(), tread = new MeshBuilder(), hand = new MeshBuilder();
  const n = Math.max(1, Math.round(d.steps)), r = d.rise / n, W = d.width / 2, style = d.style ?? 'solid', shape = d.shape ?? 'straight';
  const t = Math.min(d.treadThickness ?? .05, r), turn = d.turn === 'left' ? -1 : 1;
  const g = d.run / n;
  const pieces: Array<{ foot: Array<[number, number]>; top: number }> = [];
  const flights: Array<{ x: number; z: number; dx: number; dz: number; count: number; first: number }> = [];
  const rect = (cx: number, cz: number, dx: number, dz: number, along: number, across: number): Array<[number, number]> => {
    const px = -dz, pz = dx, a = along / 2, c = across / 2;
    return [[cx - dx * a - px * c, cz - dz * a - pz * c], [cx + dx * a - px * c, cz + dz * a - pz * c], [cx + dx * a + px * c, cz + dz * a + pz * c], [cx - dx * a + px * c, cz - dz * a + pz * c]];
  };
  const flight = (x: number, z: number, dx: number, dz: number, count: number, first: number) => {
    if (count < 1) return;
    flights.push({ x, z, dx, dz, count, first });
    for (let i = 0; i < count; i++) pieces.push({ foot: rect(x + dx * (i + .5) * g, z + dz * (i + .5) * g, dx, dz, g, d.width), top: (first + i + 1) * r });
  };
  const R = spiralRadius(d.width), spiralStep = Math.PI * 2 / Math.max(10, Math.min(16, n)) * turn;
  if (shape === 'spiral') {
    const r0 = .12;
    for (let i = 0; i < n; i++) {
      const a0 = i * spiralStep - Math.PI / 2, a1 = a0 + spiralStep * 1.04;
      pieces.push({ foot: [[Math.cos(a0) * r0, R + Math.sin(a0) * r0], [Math.cos(a0) * R, R + Math.sin(a0) * R], [Math.cos(a1) * R, R + Math.sin(a1) * R], [Math.cos(a1) * r0, R + Math.sin(a1) * r0]], top: (i + 1) * r });
    }
    prism(rail, Array.from({ length: 8 }, (_, k) => [Math.cos(k * Math.PI / 4) * r0, R + Math.sin(k * Math.PI / 4) * r0] as [number, number]), 0, d.rise + 1);
  } else if (shape === 'straight') flight(0, 0, 0, 1, n, 0);
  else {
    const n1 = Math.ceil((n - 1) / 2), n2 = n - 1 - n1, L = d.landing ?? d.width, lz = n1 * g, ly = (n1 + 1) * r;
    flight(0, 0, 0, 1, n1, 0);
    if (shape === 'l') {
      // A square landing, then the second flight leaves it sideways.
      pieces.push({ foot: rect(0, lz + L / 2, 0, 1, L, d.width), top: ly });
      flight(turn * W, lz + L / 2, turn, 0, n2, n1 + 1);
    } else {
      const gap = .1, off = turn * (d.width + gap);
      pieces.push({ foot: rect(off / 2, lz + L / 2, 0, 1, L, d.width * 2 + gap), top: ly });
      flight(off, lz, 0, -1, n2, n1 + 1);
    }
  }
  // Structure under each tread (concrete, the steel or timber of the flight) and the finish on
  // top (granite, terrazzo, tiles, boards) as separate materials, as stairs are built.
  const finish = Math.min(.03, r * .3);
  for (const p of pieces) {
    prism(main, p.foot, style === 'solid' ? 0 : p.top - t, p.top - finish);
    // The finish overhangs the riser by 2 cm (the nosing).
    prism(tread, p.foot, p.top - finish, p.top);
  }
  for (const f of flights) {
    const len = f.count * g, x1 = f.x + f.dx * len, z1 = f.z + f.dz * len, y0 = f.first * r, y1 = (f.first + f.count) * r, px = -f.dz, pz = f.dx;
    if (style === 'stringer') for (const side of [-1, 1]) {
      const ox = px * side * (W + .03), oz = pz * side * (W + .03);
      slopedBeam(rail, f.x + ox, f.z + oz, y0 + .12, x1 + ox, z1 + oz, y1 + .12, .06, .3);
    }
    if (style === 'open') slopedBeam(rail, f.x, f.z, y0 + r - t, x1, z1, y1 - t, .16, .22);
  }
  if (d.railing !== false) {
    if (shape === 'spiral') {
      for (let i = 0; i < n; i += 2) { const a = i * spiralStep - Math.PI / 2 + spiralStep / 2, x = Math.cos(a) * (R - .05), z = R + Math.sin(a) * (R - .05), y = (i + 1) * r; prism(rail, rect(x, z, 1, 0, .04, .04), y - t, y + .9); }
    } else for (const f of flights) {
      // Handrail on the outside of the turn: posts every other tread, the rail 0.9 m above the nosings.
      const side = shape === 'straight' ? 1 : -turn, px = -f.dz * side * (W - .04), pz = f.dx * side * (W - .04), len = f.count * g;
      for (let i = 0; i <= f.count; i += 2) {
        const k = Math.min(i, f.count - 1), x = f.x + f.dx * (k + .5) * g + px, z = f.z + f.dz * (k + .5) * g + pz, y = (f.first + k + 1) * r;
        prism(rail, rect(x, z, 1, 0, .04, .04), y, y + .9);
      }
      slopedBeam(hand, f.x + px, f.z + pz, (f.first + 1) * r + .95, f.x + f.dx * len + px, f.z + f.dz * len + pz, (f.first + f.count) * r + .95, .06, .05);
    }
  }
  return [{ slot: 'main', mesh: main.build() }, { slot: 'tread', mesh: tread.build() }, { slot: 'rail', mesh: rail.build() }, { slot: 'handrail', mesh: hand.build() }];
}
