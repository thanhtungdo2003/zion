import { BufferAttribute, BufferGeometry, Color, DataTexture, DoubleSide, LinearFilter, Matrix4, MeshStandardMaterial, RepeatWrapping, RGBAFormat, Vector3, type Mesh } from 'three';
import type { BeardStyle } from '@zion/shared';
import { cachedFetch } from '@/lib/preload';
import { gltfLoader } from './gltf-loader';

/**
 * Facial hair on the survivor's own skin and skeleton: the three eyebrow shapes of
 * models/characters/eyebrows.glb fitted onto the brow ridge, and beards grown from the face as
 * layered shells (fur), each strand colour the hair colour. Both copy the skin weights of the face
 * under them, so they follow the face sliders, the jaw and the head.
 */

/** Skin of the head, what facial hair is fitted to: the body's vertex positions, normals and weights. */
export interface FaceSkin { position: BufferAttribute; normal: BufferAttribute; skinIndex: BufferAttribute; skinWeight: BufferAttribute; index: BufferAttribute }

const near = (a: number, b: number, w: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / w)), u = Math.min(1, Math.max(0, (b - x) / w));
  return Math.min(t, u);
};

/**
 * Where each beard grows, 0…1, on the face (the survivor's own space, metres: +Y up, +Z forward,
 * the mouth at y ≈ 1.534, the chin at 1.499, the jaw's angle at x ±0.047, the ears at ±0.058).
 */
export function beardDensity(style: BeardStyle, p: Vector3): number {
  const ax = Math.abs(p.x);
  if (p.y < 1.455 || p.y > 1.62 || p.z < -.03 || ax > .066) return 0;
  // The lips themselves never grow hair.
  const lips = ax < .026 && p.y > 1.523 && p.y < 1.541 && p.z > .055;
  const mustache = near(1.539, 1.553, .003, p.y) * near(-1, .03, .006, ax) * (p.z > .055 ? 1 : 0)
    + (ax > .016 && ax < .03 && p.y > 1.518 && p.y < 1.545 && p.z > .045 ? .9 : 0);
  const goatee = near(1.476, 1.527, .004, p.y) * near(-1, .024, .006, ax) * (p.z > .025 ? 1 : 0);
  // Full beard (râu quai nón): the jaw from ear to ear, the chin, under the jaw, the upper lip,
  // the sideburns; the cheeks above a line from the mouth's corners to the sideburns stay bare.
  const cheekLine = 1.553 + Math.max(0, ax - .03) * 1.15;
  const sideburn = ax > .05 && p.z > -.022 && p.z < .022 && p.y < 1.6;
  const jaw = p.y < cheekLine && (p.z > -.005 || (p.y < 1.5 && p.z > .0)) && p.y > 1.462;
  const full = sideburn ? near(1.46, 1.6, .012, p.y) : jaw ? Math.min(1, near(1.462, cheekLine, .006, p.y) * 1.2) : 0;
  let d = 0;
  if (style === 'mustache') d = Math.min(1, mustache);
  else if (style === 'goatee') d = Math.min(1, Math.max(goatee, mustache));
  else if (style === 'full' || style === 'stubble') d = Math.max(full, Math.min(1, mustache), goatee);
  return lips ? 0 : d;
}

/** Strand length (m) and how sparse (stubble) per style. */
const BEARD_LOOK: Record<Exclude<BeardStyle, 'none'>, { length: number; layers: number; thin: number }> = {
  stubble: { length: .0012, layers: 3, thin: .3 },
  mustache: { length: .0045, layers: 6, thin: .2 },
  goatee: { length: .0055, layers: 6, thin: .2 },
  full: { length: .0065, layers: 7, thin: .18 },
};

const beardCache = new WeakMap<FaceSkin, Map<BeardStyle, BufferGeometry | null>>();

/** The beard's shells: each grown triangle repeated outwards along the skin normal, layer by layer. */
export function beardGeometry(skin: FaceSkin, style: BeardStyle): BufferGeometry | null {
  if (style === 'none') return null;
  let cache = beardCache.get(skin);
  if (!cache) { cache = new Map(); beardCache.set(skin, cache); }
  if (cache.has(style)) return cache.get(style)!;
  const look = BEARD_LOOK[style];
  const p = new Vector3(), n = new Vector3();
  const density = new Float32Array(skin.position.count);
  for (let i = 0; i < skin.position.count; i++) density[i] = beardDensity(style, p.fromBufferAttribute(skin.position, i));
  const tris: number[] = [];
  for (let t = 0; t < skin.index.count; t += 3) {
    const a = skin.index.getX(t), b = skin.index.getX(t + 1), c = skin.index.getX(t + 2);
    if (density[a]! + density[b]! + density[c]! > .15) tris.push(a, b, c);
  }
  if (!tris.length) { cache.set(style, null); return null; }
  const used = [...new Set(tris)], at = new Map(used.map((v, k) => [v, k]));
  const L = look.layers, count = used.length * L;
  const pos = new Float32Array(count * 3), nrm = new Float32Array(count * 3), uv = new Float32Array(count * 2), layer = new Float32Array(count * 2);
  const si = new Uint16Array(count * 4), sw = new Float32Array(count * 4);
  for (let l = 0; l < L; l++) {
    const h = look.length * (l + 1) / L;
    used.forEach((v, k) => {
      const o = l * used.length + k;
      p.fromBufferAttribute(skin.position, v); n.fromBufferAttribute(skin.normal, v).normalize();
      // Strands lean down and a little forward, as beard hair grows.
      p.addScaledVector(n, h).y -= h * .35;
      pos.set([p.x, p.y, p.z], o * 3); nrm.set([n.x, n.y, n.z], o * 3);
      // (Stubble: short dots, finer than the streaks of grown hair.)
      const f = style === 'stubble' ? 4 : 1;
      // Around the head (arc length), so the strands run down the cheeks as on the chin.
      uv.set([Math.atan2(p.x, p.z + .02) * .085 * 14 * f, p.y * 5 * f * (style === 'stubble' ? 3 : 1)], o * 2);
      layer.set([(l + 1) / L, density[v]!], o * 2);
      for (let c = 0; c < 4; c++) { si[o * 4 + c] = skin.skinIndex.getComponent(v, c); sw[o * 4 + c] = skin.skinWeight.getComponent(v, c); }
    });
  }
  const index: number[] = [];
  for (let l = 0; l < L; l++) for (let t = 0; t < tris.length; t++) index.push(l * used.length + at.get(tris[t]!)!);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('normal', new BufferAttribute(nrm, 3));
  g.setAttribute('uv', new BufferAttribute(uv, 2));
  g.setAttribute('aShell', new BufferAttribute(layer, 2));
  g.setAttribute('skinIndex', new BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new BufferAttribute(sw, 4));
  g.setIndex(index);
  g.userData.thin = look.thin;
  cache.set(style, g);
  return g;
}

let strands: DataTexture | null = null;
/** Strand noise: each texel a hair or a gap, so stacked shells read as separate hairs. */
function strandTexture(): DataTexture {
  if (strands) return strands;
  const size = 128, data = new Uint8Array(size * size * 4);
  let s = 12345;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  // Hairs as short vertical streaks: each column's value drifts slowly downwards.
  for (let x = 0; x < size; x++) {
    let v = rnd();
    for (let y = 0; y < size; y++) { if (rnd() < .18) v = rnd(); const b = Math.floor(v * 255); data.set([b, b, b, 255], (y * size + x) * 4); }
  }
  strands = new DataTexture(data, size, size, RGBAFormat);
  strands.wrapS = strands.wrapT = RepeatWrapping;
  strands.magFilter = strands.minFilter = LinearFilter;
  strands.needsUpdate = true;
  return strands;
}

/** The beard's material: a hair where the strand noise beats the layer's height; darker deep down. */
export function beardMaterial(color: string, thin: number): MeshStandardMaterial {
  // Blended, drawn inner shell first (the index runs layer by layer): soft coverage at the skin,
  // separate hairs further out.
  const m = new MeshStandardMaterial({ color: new Color(color), roughness: .85, metalness: 0, side: DoubleSide, transparent: true, depthWrite: false });
  m.name = 'beard';
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uStrands = { value: strandTexture() };
    shader.uniforms.uThin = { value: thin };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aShell; varying vec2 vShell; varying vec2 vStrandUv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvShell = aShell; vStrandUv = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uStrands; uniform float uThin; varying vec2 vShell; varying vec2 vStrandUv;')
      .replace('#include <map_fragment>', `#include <map_fragment>
      float strand = texture2D(uStrands, vStrandUv).r;
      // Higher layers keep only the longest hairs; thin density (edges, stubble) keeps fewer.
      float cut = mix(.2, .85, vShell.x) + uThin + (1.0 - vShell.y) * .5;
      float a = smoothstep(cut - .06, cut + .06, strand);
      // The innermost shell also shades the skin under the hair.
      if (vShell.x < .2) a = max(a, vShell.y * (.55 - uThin * .5));
      if (a < .02) discard;
      diffuseColor.a *= a;
      diffuseColor.rgb *= mix(.55, 1.0, vShell.x);`);
  };
  m.customProgramCacheKey = () => 'zion-beard';
  return m;
}

/* ------------------------------------------------------------------------------------------- */

const browCache = new WeakMap<FaceSkin, Promise<BufferGeometry[]>>();
/** How much the hair-thin brow strands are thickened (m). */
const BROW_THICKEN = .0008;

/**
 * The three eyebrow shapes, fitted once per body: scaled onto the brow ridge (inner ends at the
 * brow's inner bones, ±0.013; outer ends near ±0.055), each vertex lifted out of the skin it would
 * sink into, and skinned like the skin under it.
 */
export function eyebrowGeometries(skin: FaceSkin): Promise<BufferGeometry[]> {
  if (typeof document === 'undefined') return Promise.resolve([]);
  let p = browCache.get(skin);
  if (!p) {
    p = cachedFetch('/models/characters/eyebrows.glb').then((r) => r.arrayBuffer()).then((buf) => gltfLoader().parseAsync(buf, '')).then((g) => {
      g.scene.updateMatrixWorld(true);
      const meshes: Mesh[] = [];
      g.scene.traverse((o) => { if ((o as Mesh).isMesh) meshes.push(o as Mesh); });
      return meshes.map((m) => fitBrow(m.geometry.clone().applyMatrix4(m.matrixWorld), skin));
    }).catch((err: unknown) => { console.warn('eyebrows unavailable', err); return []; });
    browCache.set(skin, p);
  }
  return p;
}

function fitBrow(g: BufferGeometry, skin: FaceSkin): BufferGeometry {
  g.computeBoundingBox();
  const b = g.boundingBox!, k = .112 / (b.max.x - b.min.x);
  g.applyMatrix4(new Matrix4().makeTranslation(-(b.min.x + b.max.x) / 2, -b.max.y, -b.max.z));
  g.applyMatrix4(new Matrix4().makeScale(k, k, k));
  g.applyMatrix4(new Matrix4().makeTranslation(0, 1.617, .074));
  // The skin of the brow ridge to sit on.
  const ridge: number[] = [], v = new Vector3(), s = new Vector3(), n = new Vector3();
  for (let i = 0; i < skin.position.count; i++) { v.fromBufferAttribute(skin.position, i); if (v.y > 1.57 && v.y < 1.66 && v.z > 0 && Math.abs(v.x) < .07) ridge.push(i); }
  const pos = g.getAttribute('position') as BufferAttribute;
  const si = new Uint16Array(pos.count * 4), sw = new Float32Array(pos.count * 4);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    let best = ridge[0]!, bd = Infinity;
    for (const j of ridge) { const d = s.fromBufferAttribute(skin.position, j).distanceToSquared(v); if (d < bd) { bd = d; best = j; } }
    s.fromBufferAttribute(skin.position, best); n.fromBufferAttribute(skin.normal, best).normalize();
    const above = v.clone().sub(s).dot(n);
    if (above < .0012) v.addScaledVector(n, .0012 - above);
    pos.setXYZ(i, v.x, v.y, v.z);
    for (let c = 0; c < 4; c++) { si[i * 4 + c] = skin.skinIndex.getComponent(best, c); sw[i * 4 + c] = skin.skinWeight.getComponent(best, c); }
  }
  g.setAttribute('skinIndex', new BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new BufferAttribute(sw, 4));
  for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'skinIndex', 'skinWeight'].includes(name)) g.deleteAttribute(name);
  g.computeVertexNormals();
  // The strands are hair-thin tubes: thickened so they read at a few metres.
  const nrm = g.getAttribute('normal') as BufferAttribute;
  // (The sparse shape has fewer, finer strands: thickened more.)
  const thicken = pos.count < 5000 ? BROW_THICKEN * 1.8 : BROW_THICKEN;
  for (let i = 0; i < pos.count; i++) pos.setXYZ(i, pos.getX(i) + nrm.getX(i) * thicken, pos.getY(i) + nrm.getY(i) * thicken, pos.getZ(i) + nrm.getZ(i) * thicken);
  return g;
}

export function browMaterial(color: string): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ color: new Color(color), roughness: .9, metalness: 0 });
  m.name = 'eyebrows';
  return m;
}
