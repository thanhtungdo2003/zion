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

/**
 * Blocky rock: a base slab and 2-5 angular blocks stacked and tilted on it, faceted by a light
 * jitter of the corners; coloured per style (granite, sandstone strata, basalt, snow-capped,
 * mossy top, pale limestone).
 */
const ROCK_COLORS: Record<string, [number, number, number]> = { granite: [0x7a7872, 0x8d8a83, 0x5f5d58], sandstone: [0xc29a63, 0xd4ae76, 0xa97f4d], basalt: [0x45454a, 0x55555b, 0x34343a], snow: [0x7c8088, 0x8e939b, 0xeef2f6], mossy: [0x6c6d62, 0x7d7e72, 0x4f6b32], limestone: [0xc9c4b4, 0xd8d4c6, 0xaaa597] };
function blockyRock(p: Params, rng: Rng): BufferGeometry {
  const s = num(p, 'size', 1), style = typeof p.style === 'string' ? p.style : 'granite', [base, light, top] = ROCK_COLORS[style] ?? ROCK_COLORS.granite!;
  const parts: BufferGeometry[] = [];
  const block = (w: number, h: number, d: number, x: number, y: number, z: number, color: number) => {
    const g = new BoxGeometry(w, h, d, 1, 1, 1);
    displace(g, rng, .9, 1.04, true);
    g.rotateY((rng.next() - .5) * .9).rotateZ((rng.next() - .5) * .25).rotateX((rng.next() - .5) * .2).translate(x, y, z);
    parts.push(paint(g, color, rng, .07));
  };
  const bw = s * (1 + rng.next() * .3), bh = s * (.35 + rng.next() * .2), bd = s * (.8 + rng.next() * .3);
  block(bw, bh, bd, 0, bh / 2 - s * .06, 0, base);
  let y = bh - s * .08;
  const n = 2 + Math.floor(rng.next() * 3);
  for (let i = 0; i < n; i++) {
    const w = bw * (.45 + rng.next() * .4), h = s * (.22 + rng.next() * .3), d = bd * (.45 + rng.next() * .4), last = i === n - 1;
    const color = style === 'sandstone' ? (i % 2 ? light : base) : last && (style === 'snow' || style === 'mossy') ? top : rng.next() < .5 ? light : base;
    block(w, h, d, (rng.next() - .5) * bw * .4, y + h / 2, (rng.next() - .5) * bd * .4, color);
    y += h * (.7 + rng.next() * .2);
  }
  // A fallen chip beside the stack.
  if (rng.next() < .7) block(s * .3, s * .18, s * .26, bw * .55, s * .07, (rng.next() - .5) * bd, base);
  return merge(parts);
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

/**
 * Ivy and moss grown over a camp utility pole (same unscaled frame: a 0.25 m post up to 3.25 m,
 * a 0.125 m one above). `lying` lays it along +X to cover a fallen pole.
 */
function ivy(p: Params, rng: Rng): BufferGeometry {
  const h = num(p, 'height', 4.6);
  const radius = (y: number) => (y < 3.25 ? .25 : .125) + .035;
  const parts: BufferGeometry[] = [];
  // Moss creeping up from the footing, thick at the base.
  const moss = new CylinderGeometry(.29, .33, .7 + rng.next() * .6, 8, 3, true);
  displace(moss, rng, .95, 1.12);
  parts.push(paint(moss.translate(0, .55, 0), 0x4b5f29, rng, .2));
  const skirt = new CylinderGeometry(.56, .62, .3, 8, 1, true);
  displace(skirt, rng, .94, 1.08);
  parts.push(paint(skirt.translate(0, .13, 0), 0x56682f, rng, .2));
  const greens = [0x3d6b26, 0x557f2e, 0x2f5a20, 0x4a7428];
  for (let strand = 0; strand < 3; strand++) {
    const top = h * (.55 + rng.next() * .45), turn = (rng.next() < .5 ? -1 : 1) * (1.2 + rng.next() * 1.6), start = rng.next() * Math.PI * 2;
    for (let y = .3; y < top; y += .11) {
      // Fewer leaves towards the top of each strand.
      if (rng.next() < (y / top) * .55) continue;
      for (let k = 0; k < 2; k++) {
        const a = start + (y / h) * turn * Math.PI + (rng.next() - .5) * .9, r = radius(y) + rng.next() * .05, s = .14 + rng.next() * .1;
        const leaf = new PlaneGeometry(s, s * .85).rotateX((rng.next() - .5) * .9).rotateZ((rng.next() - .5) * 1.2);
        leaf.translate(0, 0, r).rotateY(a).translate(0, y + (rng.next() - .5) * .08, 0);
        parts.push(paint(leaf, greens[Math.floor(rng.next() * greens.length)]!, rng, .12));
      }
    }
  }
  const g = merge(parts);
  if (p.lying) { g.rotateZ(-Math.PI / 2 + .06); g.translate(0, .22, 0); g.computeBoundingSphere(); }
  return g;
}

const GENERATORS: Record<ProceduralGenerator, (p: Params, rng: Rng) => BufferGeometry> = {
  water_tank: (_p, rng) => {
    const parts = [paint(new CylinderGeometry(1.9, 1.9, 3.2, 20).translate(0, 1.6, 0), 0x89928a, rng)];
    parts.push(paint(new ConeGeometry(2.05, .4, 20).translate(0, 3.4, 0), 0x5c6a64, rng));
    for (const y of [.15, 1.6, 3.1]) parts.push(paint(new CylinderGeometry(1.96, 1.96, .12, 20).translate(0, y, 0), 0x4e5b55, rng));
    return merge(parts);
  },
  // Editor marker of an invisible light source: a small glowing orb with a ring (hidden in game).
  light_source: (_p, rng) => merge([
    paint(new IcosahedronGeometry(.22, 1).translate(0, .5, 0), 0xffe08a, rng, 0),
    paint(new CylinderGeometry(.04, .04, .5, 6).translate(0, .25, 0), 0x806a3a, rng, 0),
  ]),
  bridge_block: (p, rng) => {
    const w = num(p, 'width', 2), h = num(p, 'height', .3), d = num(p, 'depth', 2);
    const color = typeof p.color === 'string' ? new Color(p.color).getHex() : 0x77766b;
    const y = (p.topOrigin ? -1 : 1) * h / 2;
    // Narrow plank joints retain a continuous driving collider below the visible wood.
    if (p.color === '#756047') {
      const parts = [];
      for (let i = 0; i < 8; i++) parts.push(paint(new BoxGeometry(w, h, d / 8 - .012).translate(0, y, -d / 2 + (i + .5) * d / 8), color, rng, .12));
      return merge(parts);
    }
    return merge([paint(new BoxGeometry(w, h, d).translate(0, y, 0), color, rng, .05)]);
  },
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
  blocky_rock: blockyRock,
  slab,
  ivy,
};

/** Builds a deterministic low-poly mesh (metres, base at y = 0) for a procedural asset. */
export function buildProceduralGeometry(generator: ProceduralGenerator, params: Params, seed: number): BufferGeometry {
  return GENERATORS[generator](params, new Rng(typeof params.seed === 'number' ? params.seed : seed));
}
