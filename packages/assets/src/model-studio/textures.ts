import type { ModelMaterial, TextureRecipe } from './doc';
import { cells2, fbm2, hash01, noise2 } from './noise';

/**
 * Procedural PBR texture sets: from a material's recipe, a tileable height field per surface
 * pattern (bricks and mortar, boards and gaps, strata, weave…), then every map from it the way a
 * texture artist bakes them — base colour, a tangent-space normal map from the height slope,
 * ambient occlusion from cavities, roughness and metalness varying with the pattern and the
 * weathering layers (dirt in hollows, moss on top, cracks, worn edges). The same recipe gives
 * the same pixels in the browser preview and in the exported GLB.
 */
export interface TextureSet {
  size: number;
  /** RGBA, sRGB colour; alpha = opacity. */
  albedo: Uint8Array;
  /** RGBA, tangent-space normal (OpenGL / glTF convention: +Y up). */
  normal: Uint8Array;
  /** RGBA: R ambient occlusion, G roughness, B metalness (glTF metallicRoughness + occlusion). */
  orm: Uint8Array;
}

interface Sample {
  /** 0..1 surface height. */
  h: number;
  /** 0 base colour … 1 accent colour. */
  c: number;
  /** Brightness multiplier. */
  shade: number;
  /** Added roughness. */
  rough: number;
  /** Metalness where the pattern decides it (−1: the material's). */
  metal: number;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a: number, b: number, v: number) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const fract = (v: number) => v - Math.floor(v);

function hex(c: string): [number, number, number] {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

type Sampler = (u: number, v: number, s: Sample) => void;

/** The pattern's height, colour mix and roughness at (u, v) ∈ [0, 1)² of one tile. */
function sampler(t: TextureRecipe): Sampler {
  const seed = t.seed, va = t.variation;
  switch (t.pattern) {
    case 'plain': return (u, v, s) => { s.h = .5 + fbm2(seed, u * 4, v * 4, 4, 2) * .05; s.shade = 1 + fbm2(seed + 9, u * 3, v * 3, 3, 3) * va * .12; };
    case 'noise': return (u, v, s) => { const n = fbm2(seed, u * 8, v * 8, 8, 4); s.h = .5 + n * .5; s.shade = 1 + n * va * .3; };
    case 'stone': return (u, v, s) => {
      const c = cells2(seed, u * 6, v * 6, 6, .85), edge = c.f2 - c.f1;
      const mortar = 1 - smooth(.04, .12, edge);
      const dome = smooth(0, .45, edge) * (.8 + .2 * noise2(seed + 3, u * 24, v * 24, 24));
      s.h = dome * (1 - mortar * .8); s.c = mortar; s.shade = 1 + (c.id - .5) * va * .5 + fbm2(seed + 5, u * 16, v * 16, 16, 3) * .12;
      s.rough = mortar * .06;
    };
    case 'rock': return (u, v, s) => {
      const warp = fbm2(seed + 1, u * 3, v * 3, 3, 3) * .35;
      const strata = .5 + .5 * Math.sin((v + warp) * Math.PI * 2 * 5);
      const n = fbm2(seed, u * 6, v * 6, 6, 5, .55);
      const crack = 1 - smooth(0, .06, cells2(seed + 7, u * 4 + warp, v * 4, 4).f2 - cells2(seed + 7, u * 4 + warp, v * 4, 4).f1);
      s.h = clamp01(.5 + n * .45 + strata * .15 - crack * .35); s.c = clamp01(strata * .6 + crack * .6 + (n < -.2 ? .3 : 0));
      s.shade = 1 + n * va * .35; s.rough = crack * .05;
    };
    case 'brick': return (u, v, s) => {
      const rows = 16, cols = 5, row = Math.floor(v * rows), x = u * cols + (row % 2) * .5, col = Math.floor(x);
      const fx = fract(x), fy = fract(v * rows);
      const mortar = 1 - Math.min(smooth(0, .045, fx) * smooth(0, .045, 1 - fx), smooth(0, .13, fy) * smooth(0, .13, 1 - fy));
      const id = hash01(seed, ((col % cols) + cols) % cols, row);
      s.h = (1 - mortar) * (.85 + .15 * noise2(seed + 2, u * 40, v * 40, 40)); s.c = mortar;
      s.shade = 1 + (id - .5) * va * .55 + fbm2(seed + 4, u * 20, v * 20, 20, 3) * .1; s.rough = mortar * .08;
    };
    case 'plaster': return (u, v, s) => {
      const strokes = fbm2(seed, u * 3, v * 9, 3, 3) * .5 + fbm2(seed + 1, u * 16, v * 16, 16, 4) * .5;
      s.h = .5 + strokes * .35; s.shade = 1 + fbm2(seed + 2, u * 2, v * 2, 2, 3) * va * .2;
    };
    case 'concrete': return (u, v, s) => {
      const n = fbm2(seed, u * 10, v * 10, 10, 5);
      const pore = cells2(seed + 1, u * 40, v * 40, 40, 1).f1 < .12 ? 1 : 0;
      const shutter = 1 - smooth(0, .015, Math.abs(fract(v * 4) - .5) - .485 + .015);
      s.h = clamp01(.55 + n * .3 - pore * .4 - shutter * .2); s.shade = 1 + n * va * .3 + fbm2(seed + 2, u * 2, v * 2, 2, 3) * va * .2 - pore * .25;
      s.rough = pore * .05;
    };
    case 'wood': return (u, v, s) => {
      const w = fbm2(seed, u * 2, v * 8, 2, 3) * 1.2;
      const ring = fract(v * 14 + w);
      const grain = smooth(.65, 1, ring);
      s.h = .5 + (.5 - grain) * .3 + noise2(seed + 3, u * 64, v * 4, 64) * .05; s.c = grain * .8; s.shade = 1 + fbm2(seed + 4, u * 3, v * 3, 3, 3) * va * .25;
    };
    case 'planks': return (u, v, s) => {
      const boards = 8, b = Math.floor(v * boards), fy = fract(v * boards);
      const endAt = hash01(seed, b, 1), fx = fract(u - endAt);
      const gap = 1 - Math.min(smooth(0, .06, fy) * smooth(0, .06, 1 - fy), smooth(0, .008, fx) * smooth(0, .008, 1 - fx));
      const w = fbm2(seed + b, u * 2, fy * 2, 2, 3);
      const grain = smooth(.6, 1, fract(fy * 3 + w * 1.5 + u * .3));
      const id = hash01(seed, b, 2);
      s.h = (1 - gap) * (.75 + (.5 - grain) * .2); s.c = clamp01(grain * .6 + gap);
      s.shade = 1 + (id - .5) * va * .5; s.rough = gap * .1;
    };
    case 'metal': return (u, v, s) => {
      const brushed = fbm2(seed, u * 2, v * 96, 2, 3) * .5 + noise2(seed + 1, u * 128, v * 4, 128) * .3;
      s.h = .5 + brushed * .1; s.shade = 1 + brushed * va * .25 + fbm2(seed + 2, u * 3, v * 3, 3, 3) * va * .15; s.rough = brushed * .08;
    };
    case 'rust': return (u, v, s) => {
      const n = fbm2(seed, u * 5, v * 5, 5, 5);
      const bare = 1 - smooth(-.25, -.05, n);
      const flake = fbm2(seed + 1, u * 24, v * 24, 24, 3);
      s.h = clamp01(.5 + (1 - bare) * (.2 + flake * .3)); s.c = bare; s.metal = bare;
      s.rough = bare * -.35 + (1 - bare) * .05; s.shade = 1 + flake * va * .35;
    };
    case 'corrugated': return (u, v, s) => {
      const waves = 18, wave = .5 + .5 * Math.sin(u * Math.PI * 2 * waves);
      const streak = smooth(.1, .5, fbm2(seed, u * 6, v * 1.5, 6, 3));
      s.h = wave; s.c = streak * .7; s.metal = 1 - streak * .8; s.rough = streak * .3; s.shade = .85 + wave * .2;
    };
    case 'roof_tiles': return (u, v, s) => {
      const rows = 10, cols = 7, row = Math.floor(v * rows), x = u * cols + (row % 2) * .5, fx = fract(x), fy = fract(v * rows);
      const barrel = Math.sin(fx * Math.PI), lap = smooth(0, .85, fy);
      const joint = 1 - smooth(0, .05, fx) * smooth(0, .05, 1 - fx);
      const id = hash01(seed, Math.floor(x) % cols, row);
      s.h = clamp01(barrel * .5 + lap * .45 - joint * .3); s.c = clamp01((1 - lap) * .8 + joint * .5);
      s.shade = 1 + (id - .5) * va * .5; s.rough = joint * .05;
    };
    case 'shingles': return (u, v, s) => {
      const rows = 12, cols = 6, row = Math.floor(v * rows), x = u * cols + (row % 2) * .5, fx = fract(x), fy = fract(v * rows);
      const cut = 1 - smooth(0, .03, fx) * smooth(0, .03, 1 - fx);
      const id = hash01(seed, Math.floor(x) % cols, row);
      const grit = noise2(seed + 1, u * 96, v * 96, 96);
      s.h = clamp01(fy * .7 + grit * .1 - cut * .4); s.c = clamp01((1 - fy) * .5 + cut); s.shade = 1 + (id - .5) * va * .4 + grit * .08;
    };
    case 'fabric': return (u, v, s) => {
      const n = 48, a = Math.sin(u * Math.PI * 2 * n), b = Math.sin(v * Math.PI * 2 * n);
      const over = (Math.floor(u * n * 2) + Math.floor(v * n * 2)) % 2 ? a : b;
      s.h = .5 + over * .25; s.shade = 1 + fbm2(seed, u * 4, v * 4, 4, 3) * va * .2;
    };
    case 'tiles': return (u, v, s) => {
      const n = 4, fx = fract(u * n), fy = fract(v * n);
      const grout = 1 - smooth(0, .03, fx) * smooth(0, .03, 1 - fx) * smooth(0, .03, fy) * smooth(0, .03, 1 - fy);
      const id = hash01(seed, Math.floor(u * n), Math.floor(v * n));
      s.h = 1 - grout * .8; s.c = grout; s.shade = 1 + (id - .5) * va * .3; s.rough = grout * .55;
    };
    case 'glass': return (u, v, s) => { const d = fbm2(seed, u * 4, v * 4, 4, 4); s.h = .5; s.shade = 1 + d * va * .3; s.rough = Math.max(0, d) * va * .4; };
    case 'ground': return (u, v, s) => {
      const n = fbm2(seed, u * 8, v * 8, 8, 5), peb = cells2(seed + 1, u * 24, v * 24, 24);
      const stone = peb.f1 < .22 && peb.id > .7 ? 1 : 0;
      s.h = clamp01(.45 + n * .3 + stone * (.3 - peb.f1)); s.c = stone; s.shade = 1 + n * va * .4;
    };
    case 'grass': return (u, v, s) => {
      const blades = noise2(seed, u * 96, v * 24, 96) * .6 + noise2(seed + 1, u * 48, v * 140, 48) * .4;
      const dry = smooth(.1, .5, fbm2(seed + 2, u * 3, v * 3, 3, 4));
      s.h = .5 + blades * .45; s.c = dry; s.shade = 1 + blades * va * .3;
    };
    case 'gravel': return (u, v, s) => {
      const c = cells2(seed, u * 14, v * 14, 14, 1), edge = c.f2 - c.f1;
      const dome = smooth(0, .5, edge);
      s.h = dome; s.c = c.id > .6 ? 1 : 0; s.shade = .75 + c.id * .5 * va + .1; s.rough = (1 - dome) * .05;
    };
    case 'bark': return (u, v, s) => {
      const w = fbm2(seed, u * 4, v * 2, 4, 3) * .4;
      const ridge = 1 - Math.abs(noise2(seed + 1, (u + w) * 10, v * 2.5, 10));
      s.h = clamp01(Math.pow(ridge, 2.2) + fbm2(seed + 2, u * 30, v * 10, 30, 3) * .1); s.c = 1 - smooth(.3, .7, ridge); s.shade = 1 + w * va * .4;
    };
    case 'leaves': return (u, v, s) => {
      const c = cells2(seed, u * 10, v * 10, 10, 1), dome = smooth(0, .45, c.f2 - c.f1);
      s.h = dome; s.c = c.id; s.shade = .7 + dome * .45 + (c.id - .5) * va * .3;
    };
  }
}

/** Box blur with wrap-around (a tileable texture's neighbour is on the other edge). */
function blur(src: Float32Array, n: number, r: number): Float32Array {
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length), w = 2 * r + 1;
  for (let y = 0; y < n; y++) {
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += src[y * n + ((k + n) % n)]!;
    for (let x = 0; x < n; x++) { tmp[y * n + x] = acc / w; acc += src[y * n + ((x + r + 1) % n)]! - src[y * n + ((x - r + n) % n)]!; }
  }
  for (let x = 0; x < n; x++) {
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += tmp[((k + n) % n) * n + x]!;
    for (let y = 0; y < n; y++) { out[y * n + x] = acc / w; acc += tmp[((y + r + 1) % n) * n + x]! - tmp[((y - r + n) % n) * n + x]!; }
  }
  return out;
}

const cache = new Map<string, TextureSet>();

/** Every map of a material at `size`² (cached per recipe). */
export function materialTextures(m: Pick<ModelMaterial, 'color' | 'roughness' | 'metalness' | 'normalStrength' | 'aoStrength' | 'opacity' | 'texture'>, size = 512): TextureSet {
  const key = JSON.stringify([m.color, m.roughness, m.metalness, m.normalStrength, m.aoStrength, m.opacity, m.texture, size]);
  const hit = cache.get(key);
  if (hit) return hit;
  const n = size, t = m.texture, base = hex(m.color), accent = hex(t.accent ?? m.color);
  const sample = sampler(t), s: Sample = { h: .5, c: 0, shade: 1, rough: 0, metal: -1 };
  const H = new Float32Array(n * n), C = new Float32Array(n * n), SH = new Float32Array(n * n), R = new Float32Array(n * n), M = new Float32Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    s.h = .5; s.c = 0; s.shade = 1; s.rough = 0; s.metal = -1;
    sample((x + .5) / n, (y + .5) / n, s);
    const k = y * n + x;
    H[k] = s.h; C[k] = s.c; SH[k] = s.shade; R[k] = s.rough; M[k] = s.metal;
  }
  // Cavities: lower than the surface around them.
  const around = blur(H, n, Math.max(1, Math.round(n / 48)));
  const seed = t.seed;
  const albedo = new Uint8Array(n * n * 4), normal = new Uint8Array(n * n * 4), orm = new Uint8Array(n * n * 4);
  const moss = hex('#4d6b2a'), dirt = hex('#3b3127'), alpha = Math.round(clamp01(m.opacity) * 255);
  const k = m.normalStrength * n / 64;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x, u = (x + .5) / n, v = (y + .5) / n;
    const cav = clamp01((around[i]! - H[i]!) * 6);
    // Weathering layers.
    const grime = t.dirt > 0 ? smooth(.2, .8, fbm2(seed + 31, u * 4, v * 4, 4, 4) * .5 + .5 + cav * .8 - (1 - t.dirt) * .9) * t.dirt : 0;
    const green = t.moss > 0 ? smooth(.45, .75, fbm2(seed + 37, u * 5, v * 5, 5, 5) * .5 + .5 + cav * .4 - (1 - t.moss) * .6) * t.moss : 0;
    let crack = 0;
    if (t.cracks > 0) {
      const c = cells2(seed + 41, u * 3 + fbm2(seed + 43, u * 6, v * 6, 6, 3) * .3, v * 3, 3);
      crack = (1 - smooth(0, .025 + t.cracks * .02, c.f2 - c.f1)) * smooth(1 - t.cracks, 1.2 - t.cracks, hash01(seed + 47, Math.floor(c.id * 997)) + .2);
    }
    const worn = t.wear > 0 ? smooth(.55, .9, fbm2(seed + 53, u * 7, v * 7, 7, 4) * .5 + .5 + (1 - cav) * .2 - (1 - t.wear) * .5) * t.wear : 0;
    const h = clamp01(H[i]! - crack * .5 + green * .08);
    H[i] = h;
    const mix = C[i]!, sh = SH[i]! * (1 - cav * .35 * m.aoStrength) * (1 - crack * .55);
    for (let c = 0; c < 3; c++) {
      let col = (base[c]! * (1 - mix) + accent[c]! * mix) * sh;
      col = col * (1 - worn * .25) + 170 * worn * .25;
      col = col * (1 - grime * .6) + dirt[c]! * grime * .6;
      col = col * (1 - green * .85) + moss[c]! * (.8 + .4 * hash01(seed, x, y)) * green * .85;
      albedo[i * 4 + c] = Math.max(0, Math.min(255, Math.round(col)));
    }
    albedo[i * 4 + 3] = alpha;
    // Patterns that mix metal and oxide (rust, galvanised streaks) decide it per pixel; a painted
    // (metalness 0) material stays dielectric.
    const metal = M[i]! >= 0 && m.metalness > 0 ? M[i]! : m.metalness;
    const rough = clamp01(m.roughness + R[i]! + grime * .15 + green * .2 + crack * .1 + worn * (metal > .5 ? -.1 : .08));
    orm[i * 4] = Math.round(clamp01(1 - cav * 1.5 * m.aoStrength - crack * .4) * 255);
    orm[i * 4 + 1] = Math.round(rough * 255);
    orm[i * 4 + 2] = Math.round(clamp01(metal * (1 - grime) * (1 - green)) * 255);
    orm[i * 4 + 3] = 255;
  }
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x;
    const dx = (H[y * n + ((x + 1) % n)]! - H[y * n + ((x - 1 + n) % n)]!) * .5 * k;
    const dy = (H[((y + 1) % n) * n + x]! - H[((y - 1 + n) % n) * n + x]!) * .5 * k;
    const len = Math.hypot(dx, dy, 1);
    normal[i * 4] = Math.round((-dx / len * .5 + .5) * 255);
    normal[i * 4 + 1] = Math.round((dy / len * .5 + .5) * 255);
    normal[i * 4 + 2] = Math.round((1 / len * .5 + .5) * 255);
    normal[i * 4 + 3] = 255;
  }
  const set = { size: n, albedo, normal, orm };
  if (cache.size > 96) cache.delete(cache.keys().next().value!);
  cache.set(key, set);
  return set;
}
