import {
  BoxGeometry,
  BufferAttribute,
  type BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  IcosahedronGeometry,
  PlaneGeometry,
  SphereGeometry,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Rng } from '@zion/shared';
import type { ProceduralGenerator } from '@zion/assets';

type Params = Record<string, number | string | boolean>;

const num = (p: Params, k: string, d: number): number => (typeof p[k] === 'number' ? (p[k] as number) : d);

/** Converts to non-indexed and paints a vertex colour with optional per-triangle jitter. */
function paint(g: BufferGeometry, hex: number, rng: Rng, jitter = 0.08): BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g;
  const count = geo.getAttribute('position').count;
  const col = new Float32Array(count * 3);
  const base = new Color(hex);
  const c = new Color();
  for (let i = 0; i < count; i += 3) {
    const k = 1 + (rng.next() * 2 - 1) * jitter;
    c.copy(base).multiplyScalar(k);
    for (let v = i; v < Math.min(i + 3, count); v++) {
      col[v * 3] = c.r;
      col[v * 3 + 1] = c.g;
      col[v * 3 + 2] = c.b;
    }
  }
  geo.setAttribute('color', new BufferAttribute(col, 3));
  if (geo.getAttribute('uv')) geo.deleteAttribute('uv');
  return geo;
}

function merge(parts: BufferGeometry[]): BufferGeometry {
  const g = mergeGeometries(parts, false);
  if (!g) throw new Error('procedural merge failed');
  g.computeBoundingSphere();
  return g;
}

/** Displaces vertices radially by a hash of their (rounded) position so shared corners stay welded. */
function displace(g: BufferGeometry, rng: Rng, min: number, max: number, inwardOnly = false): void {
  const pos = g.getAttribute('position');
  const cache = new Map<string, number>();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const key = `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
    let f = cache.get(key);
    if (f === undefined) {
      f = min + rng.next() * (max - min);
      if (inwardOnly) f = Math.min(1, f);
      cache.set(key, f);
    }
    pos.setXYZ(i, x * f, y * f, z * f);
  }
  g.computeVertexNormals();
}

function spruce(p: Params, rng: Rng): BufferGeometry {
  const h = num(p, 'height', 11);
  const r = num(p, 'radius', 2.6);
  const tiers = num(p, 'tiers', 6);
  const parts = [paint(new CylinderGeometry(0.17, 0.3, h * 0.42, 6).translate(0, h * 0.21, 0), 0x4a3524, rng)];
  for (let t = 0; t < tiers; t++) {
    const f = t / (tiers - 1);
    const height = h * 0.3 * (1 - f * 0.45);
    const radius = r * (1 - f * 0.78);
    const y = h * 0.17 + f * h * 0.64 + height / 2;
    const cone = new ConeGeometry(radius, height, 8, 1).rotateY(rng.next() * Math.PI).translate(0, y, 0);
    parts.push(paint(cone, t % 2 ? 0x2b4b2d : 0x31553a, rng, 0.12));
  }
  return merge(parts);
}

function broadleaf(p: Params, rng: Rng, leaf = 0x3f6f2c, bark = 0x5a4430): BufferGeometry {
  const h = num(p, 'height', 8.5);
  const r = num(p, 'radius', 3.4);
  const trunk = num(p, 'trunk', 0.4);
  const parts = [paint(new CylinderGeometry(trunk * 0.55, trunk, h * 0.55, 7).translate(0, h * 0.275, 0), bark, rng)];
  const blobs = 5;
  for (let i = 0; i < blobs; i++) {
    const a = (i / blobs) * Math.PI * 2 + rng.next();
    const d = i === 0 ? 0 : r * 0.45;
    const br = r * (0.5 + rng.next() * 0.25);
    const g = new IcosahedronGeometry(br, 1);
    displace(g, rng, 0.85, 1.1);
    g.translate(Math.cos(a) * d, h * 0.62 + (rng.next() - 0.3) * r * 0.4, Math.sin(a) * d);
    parts.push(paint(g, leaf, rng, 0.14));
  }
  return merge(parts);
}

function birch(p: Params, rng: Rng): BufferGeometry {
  const h = num(p, 'height', 9);
  const r = num(p, 'radius', 1.8);
  const trunk = paint(new CylinderGeometry(0.11, 0.2, h * 0.75, 6, 6).translate(0, h * 0.375, 0), 0xd9d4c6, rng, 0.35);
  const parts = [trunk];
  for (let i = 0; i < 4; i++) {
    const g = new IcosahedronGeometry(r * (0.45 + rng.next() * 0.2), 1);
    displace(g, rng, 0.85, 1.1);
    g.translate((rng.next() - 0.5) * r * 0.8, h * (0.55 + i * 0.1), (rng.next() - 0.5) * r * 0.8);
    parts.push(paint(g, 0x7d9c3c, rng, 0.15));
  }
  return merge(parts);
}

function jungle(p: Params, rng: Rng): BufferGeometry {
  const h = num(p, 'height', 15);
  const r = num(p, 'radius', 4.5);
  const parts = [paint(new CylinderGeometry(0.35, 0.75, h * 0.78, 8).translate(0, h * 0.39, 0), 0x5b4a36, rng)];
  for (let i = 0; i < 3; i++) {
    const b = new BoxGeometry(0.12, 1.6, 1.3).translate(0, 0.8, 0.75).rotateY((i / 3) * Math.PI * 2 + rng.next() * 0.5);
    parts.push(paint(b, 0x54432f, rng));
  }
  for (let i = 0; i < 3; i++) {
    const g = new SphereGeometry(r * (0.65 + rng.next() * 0.3), 9, 6);
    g.scale(1, 0.42, 1);
    g.translate((rng.next() - 0.5) * r * 0.7, h * (0.78 + i * 0.06), (rng.next() - 0.5) * r * 0.7);
    parts.push(paint(g, i === 1 ? 0x2b5a20 : 0x336b26, rng, 0.15));
  }
  return merge(parts);
}

function palm(p: Params, rng: Rng): BufferGeometry {
  const h = num(p, 'height', 9);
  const r = num(p, 'radius', 3);
  const parts: BufferGeometry[] = [];
  const segs = 6;
  let x = 0;
  const lean = 0.18 + rng.next() * 0.2;
  for (let i = 0; i < segs; i++) {
    const seg = h / segs;
    const nx = x + lean * (i / segs) * 1.2;
    const g = new CylinderGeometry(0.2 - i * 0.012, 0.24 - i * 0.012, seg * 1.05, 7).translate(0, seg / 2, 0);
    g.rotateZ(-lean * 0.3).translate(x, i * seg, 0);
    parts.push(paint(g, i % 2 ? 0x7a6448 : 0x6e5a40, rng));
    x = nx;
  }
  const leaves = 8;
  for (let i = 0; i < leaves; i++) {
    const leaf = new PlaneGeometry(r, 0.55, 4, 1).translate(r / 2, 0, 0);
    const pos = leaf.getAttribute('position');
    for (let v = 0; v < pos.count; v++) {
      const lx = pos.getX(v);
      pos.setY(v, -0.12 * lx * lx); // droop
    }
    leaf.rotateX(-Math.PI / 2).rotateZ(0.25).rotateY((i / leaves) * Math.PI * 2 + rng.next() * 0.3).translate(x, h, 0);
    parts.push(paint(leaf, 0x3f7a2a, rng, 0.12));
  }
  return merge(parts);
}

function dead(p: Params, rng: Rng): BufferGeometry {
  const h = num(p, 'height', 7);
  const parts = [paint(new CylinderGeometry(0.1, 0.24, h, 5).translate(0, h / 2, 0), 0x6b5b4a, rng)];
  for (let i = 0; i < 5; i++) {
    const len = h * (0.25 + rng.next() * 0.2);
    const b = new CylinderGeometry(0.03, 0.08, len, 4).translate(0, len / 2, 0);
    b.rotateZ((rng.next() > 0.5 ? 1 : -1) * (0.6 + rng.next() * 0.5)).rotateY(rng.next() * Math.PI * 2);
    b.translate(0, h * (0.35 + rng.next() * 0.55), 0);
    parts.push(paint(b, 0x625343, rng));
  }
  return merge(parts);
}

function willow(p: Params, rng: Rng): BufferGeometry {
  const h = num(p, 'height', 8);
  const r = num(p, 'radius', 3.8);
  const parts = [paint(new CylinderGeometry(0.3, 0.5, h * 0.5, 7).translate(0, h * 0.25, 0), 0x4e4232, rng)];
  const crown = new SphereGeometry(r * 0.7, 10, 7);
  crown.scale(1, 0.6, 1).translate(0, h * 0.68, 0);
  parts.push(paint(crown, 0x5a7d3a, rng, 0.12));
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const cone = new ConeGeometry(r * 0.22, h * 0.5, 5).rotateX(Math.PI).translate(Math.cos(a) * r * 0.62, h * 0.45, Math.sin(a) * r * 0.62);
    parts.push(paint(cone, 0x6a8a42, rng, 0.12));
  }
  return merge(parts);
}

function cactus(p: Params, rng: Rng): BufferGeometry {
  const h = num(p, 'height', 3.2);
  const color = 0x4b7a3b;
  const parts = [
    paint(new CylinderGeometry(0.3, 0.33, h, 8).translate(0, h / 2, 0), color, rng),
    paint(new SphereGeometry(0.3, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, h, 0), color, rng),
  ];
  for (const side of [-1, 1]) {
    const y = h * (0.35 + rng.next() * 0.25);
    parts.push(paint(new CylinderGeometry(0.17, 0.17, 0.7, 6).rotateZ(Math.PI / 2).translate(side * 0.6, y, 0), color, rng));
    const up = h * 0.35;
    parts.push(paint(new CylinderGeometry(0.17, 0.18, up, 6).translate(side * 0.95, y + up / 2, 0), color, rng));
  }
  return merge(parts);
}

function bush(p: Params, rng: Rng): BufferGeometry {
  const r = num(p, 'radius', 0.9);
  const parts: BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) {
    const g = new IcosahedronGeometry(r * (0.5 + rng.next() * 0.25), 1);
    displace(g, rng, 0.8, 1.1);
    g.scale(1, 0.75, 1).translate((rng.next() - 0.5) * r * 0.8, r * 0.5, (rng.next() - 0.5) * r * 0.8);
    parts.push(paint(g, 0x3f6b2b, rng, 0.15));
  }
  return merge(parts);
}

function fern(p: Params, rng: Rng): BufferGeometry {
  const r = num(p, 'radius', 0.9);
  const parts: BufferGeometry[] = [];
  for (let i = 0; i < 8; i++) {
    const leaf = new PlaneGeometry(0.28, r, 1, 3).translate(0, r / 2, 0);
    leaf.rotateX(-0.9 - rng.next() * 0.4).rotateY((i / 8) * Math.PI * 2 + rng.next() * 0.4);
    parts.push(paint(leaf, 0x3e7d2e, rng, 0.15));
  }
  return merge(parts);
}

function reeds(p: Params, rng: Rng): BufferGeometry {
  const h = num(p, 'height', 1.6);
  const parts: BufferGeometry[] = [];
  for (let i = 0; i < 14; i++) {
    const bh = h * (0.6 + rng.next() * 0.5);
    const blade = new PlaneGeometry(0.06, bh, 1, 2).translate(0, bh / 2, 0);
    blade.rotateZ((rng.next() - 0.5) * 0.3).rotateY(rng.next() * Math.PI).translate((rng.next() - 0.5) * 0.9, 0, (rng.next() - 0.5) * 0.9);
    parts.push(paint(blade, rng.next() > 0.3 ? 0x7d8c3e : 0x9a9450, rng, 0.1));
  }
  return merge(parts);
}

function rock(p: Params, rng: Rng): BufferGeometry {
  const radius = num(p, 'radius', 1);
  const g = new IcosahedronGeometry(radius, 1);
  displace(g, rng, 0.84, 1.0);
  g.scale(1, 0.88, 1).translate(0, num(p, 'cy', 0), 0);
  return merge([paint(g, 0x7a766f, rng, 0.1)]);
}

function slab(p: Params, rng: Rng): BufferGeometry {
  const hx = num(p, 'hx', 2);
  const hy = num(p, 'hy', 1.2);
  const hz = num(p, 'hz', 1.4);
  const g = new BoxGeometry(hx * 2, hy * 2, hz * 2, 3, 2, 3);
  displace(g, rng, 0.9, 1.0, true);
  g.translate(0, num(p, 'cy', hy * 0.77), 0);
  return merge([paint(g, 0x6f6b65, rng, 0.08)]);
}

const GENERATORS: Record<ProceduralGenerator, (p: Params, rng: Rng) => BufferGeometry> = {
  spruce,
  broadleaf: (p, rng) => broadleaf(p, rng),
  birch,
  jungle,
  palm,
  dead,
  willow,
  cactus,
  bush,
  fern,
  reeds,
  rock,
  slab,
};

/** Builds a deterministic low-poly mesh (metres, base at y = 0) for a procedural asset. */
export function buildProceduralGeometry(generator: ProceduralGenerator, params: Params, seed: number): BufferGeometry {
  return GENERATORS[generator](params, new Rng(typeof params.seed === 'number' ? params.seed : seed));
}
