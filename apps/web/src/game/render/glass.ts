import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  DynamicDrawUsage,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
  type Material,
  type Scene,
} from 'three';
import type { AssetVisual } from './asset-library';

/**
 * Window glass that breaks: the panes of every building model (its see-through glass, split into
 * the separate pieces it is made of) can be shattered by a shot through them, a blast nearby or a
 * melee blow. A broken pane is taken out of the drawing in the vertex shader (the buildings stay
 * one instanced draw per model) and bursts into falling shards that bounce and settle on the floor
 * below. Panes are named by their world position (cm), the same on every client: the client that
 * saw the break tells the server, which passes it on to everyone (and to players joining later).
 */

/** How many broken panes (nearest the camera) the shader hides at once. */
export const GLASS_MAX = 96;
const brokenUniform = { value: Array.from({ length: GLASS_MAX }, () => new Vector3(1e9, 1e9, 1e9)) };
const countUniform = { value: 0 };

interface Pane {
  /** Centre (model space) and the radius round it holding all its triangles. */
  cx: number; cy: number; cz: number; r: number;
  area: number;
  /** Its triangles, 9 floats each (model space). */
  tris: Float32Array;
}
interface AssetGlass { panes: Pane[]; radius: number }
const glassByAsset = new Map<number, AssetGlass>();
const patched = new WeakSet<Material>();

// (Not "window" or "pane": window frames and wall panels are named so too.)
const GLASS_NAME = /glass|kính|windshield|windscreen/i;
/** Glass: named so, or a clear see-through surface (not cut-out leaves or fences). */
export function isGlassMaterial(m: Material): boolean {
  if (GLASS_NAME.test(m.name ?? '')) return true;
  return m.transparent && m.opacity < .85 && !(m as { alphaMap?: unknown }).alphaMap;
}

/** Buildings and other standing structures have windows that break (not trees, not vehicles). */
const breakable = (v: AssetVisual) => v.def.category === 'structure' || v.def.category === 'block' || (v.def.tags.includes('model-studio') && v.def.category !== 'vegetation');

/**
 * Finds a model's glass panes (connected pieces of its glass surfaces), marks each vertex with
 * its pane's centre (the shader hides a pane by it) and patches the glass materials. Once per model.
 */
export function prepareGlass(numericId: number, v: AssetVisual): void {
  if (!breakable(v) || glassByAsset.has(numericId)) return;
  const panes: Pane[] = [];
  for (const part of v.parts) {
    if (!isGlassMaterial(part.material)) continue;
    const g = part.geometry, pos = g.getAttribute('position');
    if (!pos || g.getAttribute('aPane')) continue;
    const n = pos.count, index = g.index;
    // Union-find over vertices: those of a triangle, and those at the same spot (split normals).
    const parent = new Int32Array(n);
    for (let i = 0; i < n; i++) parent[i] = i;
    const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]!]!; i = parent[i]!; } return i; };
    const unite = (a: number, b: number) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
    const triCount = index ? index.count / 3 : n / 3;
    const vi = (t: number, k: number) => (index ? index.getX(t * 3 + k) : t * 3 + k);
    for (let t = 0; t < triCount; t++) { unite(vi(t, 0), vi(t, 1)); unite(vi(t, 1), vi(t, 2)); }
    const spot = new Map<string, number>();
    for (let i = 0; i < n; i++) {
      const k = `${Math.round(pos.getX(i) * 1000)},${Math.round(pos.getY(i) * 1000)},${Math.round(pos.getZ(i) * 1000)}`;
      const o = spot.get(k);
      if (o === undefined) spot.set(k, i); else unite(i, o);
    }
    // Each piece: its triangles, area-weighted centre.
    const pieces = new Map<number, { tris: number[]; area: number; x: number; y: number; z: number }>();
    const a = new Vector3(), b = new Vector3(), c = new Vector3(), e1 = new Vector3(), e2 = new Vector3();
    for (let t = 0; t < triCount; t++) {
      const i0 = vi(t, 0), i1 = vi(t, 1), i2 = vi(t, 2), root = find(i0);
      a.fromBufferAttribute(pos, i0); b.fromBufferAttribute(pos, i1); c.fromBufferAttribute(pos, i2);
      const area = e1.subVectors(b, a).cross(e2.subVectors(c, a)).length() / 2 + 1e-6;
      let p = pieces.get(root);
      if (!p) pieces.set(root, p = { tris: [], area: 0, x: 0, y: 0, z: 0 });
      p.tris.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
      p.area += area; p.x += (a.x + b.x + c.x) / 3 * area; p.y += (a.y + b.y + c.y) / 3 * area; p.z += (a.z + b.z + c.z) / 3 * area;
    }
    const centreOf = new Map<number, Pane>();
    for (const [root, p] of pieces) {
      const cx = p.x / p.area, cy = p.y / p.area, cz = p.z / p.area;
      let r = 0;
      for (let i = 0; i < p.tris.length; i += 3) r = Math.max(r, Math.hypot(p.tris[i]! - cx, p.tris[i + 1]! - cy, p.tris[i + 2]! - cz));
      const pane: Pane = { cx, cy, cz, r, area: p.area, tris: Float32Array.from(p.tris) };
      panes.push(pane);
      centreOf.set(root, pane);
    }
    const centres = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const p = centreOf.get(find(i)); if (p) { centres[i * 3] = p.cx; centres[i * 3 + 1] = p.cy; centres[i * 3 + 2] = p.cz; } }
    g.setAttribute('aPane', new BufferAttribute(centres, 3));
    patchGlassMaterial(part.material);
  }
  if (!panes.length) return;
  let radius = 0;
  for (const p of panes) radius = Math.max(radius, Math.hypot(p.cx, p.cy, p.cz) + p.r);
  glassByAsset.set(numericId, { panes, radius });
}

function patchGlassMaterial(mat: Material): void {
  if (patched.has(mat)) return;
  patched.add(mat);
  const prevCompile = mat.onBeforeCompile.bind(mat);
  const prevKey = mat.customProgramCacheKey.bind(mat);
  mat.onBeforeCompile = (shader, renderer) => {
    prevCompile(shader, renderer);
    shader.uniforms.uGlassBroken = brokenUniform;
    shader.uniforms.uGlassCount = countUniform;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec3 aPane;
uniform vec3 uGlassBroken[${GLASS_MAX}];
uniform int uGlassCount;`)
      .replace('#include <project_vertex>', `#include <project_vertex>
{
  #ifdef USE_INSTANCING
    vec3 glassAt = (modelMatrix * instanceMatrix * vec4(aPane, 1.0)).xyz;
  #else
    vec3 glassAt = (modelMatrix * vec4(aPane, 1.0)).xyz;
  #endif
  for (int i = 0; i < ${GLASS_MAX}; i++) {
    if (i >= uGlassCount) break;
    vec3 gd = glassAt - uGlassBroken[i];
    // A broken pane: every vertex to one point outside the view (nothing drawn).
    if (dot(gd, gd) < 0.0025) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); break; }
  }
}`);
  };
  mat.customProgramCacheKey = () => `${prevKey()}|glass`;
  mat.needsUpdate = true;
}

/** Placed models (from the prop renderer): asset id, instance matrices (16 floats each), count. */
export type PlacedModels = (visit: (asset: number, matrices: Float32Array, count: number) => void) => void;

export interface GlassHit { key: string; x: number; y: number; z: number; tris: Float32Array; area: number }

/** A pane's name: its world centre in whole centimetres. */
const keyOf = (x: number, y: number, z: number) => `${Math.round(x * 100)},${Math.round(y * 100)},${Math.round(z * 100)}`;

/** Möller–Trumbore, both faces: ray parameter or −1. */
function rayTri(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, t: Float32Array, o: number): number {
  const ax = t[o]!, ay = t[o + 1]!, az = t[o + 2]!;
  const e1x = t[o + 3]! - ax, e1y = t[o + 4]! - ay, e1z = t[o + 5]! - az, e2x = t[o + 6]! - ax, e2y = t[o + 7]! - ay, e2z = t[o + 8]! - az;
  const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x, det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-12) return -1;
  const inv = 1 / det, sx = ox - ax, sy = oy - ay, sz = oz - az, u = (sx * px + sy * py + sz * pz) * inv;
  if (u < 0 || u > 1) return -1;
  const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x, w = (dx * qx + dy * qy + dz * qz) * inv;
  if (w < 0 || u + w > 1) return -1;
  const d = (e2x * qx + e2y * qy + e2z * qz) * inv;
  return d >= 0 ? d : -1;
}

interface Shard { x: number; y: number; z: number; vx: number; vy: number; vz: number; ax: number; ay: number; az: number; spin: number; angle: number; size: number; floor: number; life: number; resting: boolean }

const SHARD_MAX = 1400;

/** Shattering and shards; the set of broken panes and the shader's list of them. */
export class GlassBreaker {
  private readonly broken = new Map<string, Vector3>();
  private readonly shards: Shard[] = [];
  private readonly mesh: InstancedMesh;
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly axis = new Vector3();
  private readonly scale = new Vector3();
  private readonly at = new Vector3();
  private uniformsAt = { x: Infinity, z: Infinity, n: -1 };

  constructor(
    private readonly scene: Scene,
    private readonly placed: PlacedModels,
    /** Height of the floor below a point (the ground, or a storey floor). */
    private readonly floorBelow: (x: number, y: number, z: number) => number,
    private readonly sound: (x: number, y: number, z: number, volume: number) => void,
  ) {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array([-.5, 0, -.3, .5, 0, -.4, .1, 0, .6]), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]), 3));
    const mat = new MeshStandardMaterial({ color: 0xcfe6ee, metalness: .2, roughness: .05, transparent: true, opacity: .6, side: DoubleSide, depthWrite: false });
    this.mesh = new InstancedMesh(g, mat, SHARD_MAX);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.name = 'glass-shards';
    scene.add(this.mesh);
  }

  isBroken(key: string): boolean { return this.broken.has(key); }

  /** Every unbroken pane a ray passes through within maxT (nearest first). */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number): GlassHit[] {
    const out: Array<GlassHit & { t: number }> = [];
    const len = Math.hypot(dx, dy, dz) || 1;
    dx /= len; dy /= len; dz /= len;
    this.placed((asset, mats, count) => {
      const glass = glassByAsset.get(asset);
      if (!glass) return;
      for (let i = 0; i < count; i++) {
        const o = i * 16, s = Math.hypot(mats[o]!, mats[o + 2]!) || 1, tx = mats[o + 12]!, ty = mats[o + 13]!, tz = mats[o + 14]!;
        // The ray's closest approach to the model: too far, skip it.
        const wx = tx - ox, wy = ty - oy, wz = tz - oz, along = Math.max(0, Math.min(maxT, wx * dx + wy * dy + wz * dz));
        if (Math.hypot(wx - dx * along, wy - dy * along, wz - dz * along) > glass.radius * s + .5) continue;
        const c = mats[o]! / s, sn = mats[o + 8]! / s;
        // Into model space (yaw and uniform scale only).
        const rx = ox - tx, ry = oy - ty, rz = oz - tz;
        const lox = (c * rx - sn * rz) / s, loy = ry / s, loz = (sn * rx + c * rz) / s;
        const ldx = c * dx - sn * dz, ldy = dy, ldz = sn * dx + c * dz;
        for (const p of glass.panes) {
          const px = p.cx - lox, py = p.cy - loy, pz = p.cz - loz, pa = px * ldx + py * ldy + pz * ldz;
          if (pa < -p.r || pa * s > maxT + p.r * s || px * px + py * py + pz * pz - pa * pa > p.r * p.r) continue;
          let best = Infinity;
          for (let k = 0; k < p.tris.length; k += 9) { const t = rayTri(lox, loy, loz, ldx, ldy, ldz, p.tris, k); if (t >= 0 && t < best) best = t; }
          if (best === Infinity || best * s > maxT) continue;
          const hit = this.world(mats, o, p);
          if (this.broken.has(hit.key)) continue;
          out.push({ ...hit, t: best * s });
        }
      }
    });
    return out.sort((a, b) => a.t - b.t);
  }

  /** Every unbroken pane with its centre within r of a point. */
  near(x: number, y: number, z: number, r: number): GlassHit[] {
    const out: GlassHit[] = [];
    this.placed((asset, mats, count) => {
      const glass = glassByAsset.get(asset);
      if (!glass) return;
      for (let i = 0; i < count; i++) {
        const o = i * 16, s = Math.hypot(mats[o]!, mats[o + 2]!) || 1;
        if (Math.hypot(mats[o + 12]! - x, mats[o + 13]! - y, mats[o + 14]! - z) > r + glass.radius * s) continue;
        for (const p of glass.panes) {
          const hit = this.world(mats, o, p);
          if (Math.hypot(hit.x - x, hit.y - y, hit.z - z) <= r + p.r * s * .5 && !this.broken.has(hit.key)) out.push(hit);
        }
      }
    });
    return out;
  }

  /** A pane placed in the world: its centre, name and world-space triangles. */
  private world(mats: Float32Array, o: number, p: Pane): GlassHit {
    const tr = (lx: number, ly: number, lz: number, out: number[]) => out.push(mats[o]! * lx + mats[o + 8]! * lz + mats[o + 12]!, mats[o + 5]! * ly + mats[o + 13]!, mats[o + 2]! * lx + mats[o + 10]! * lz + mats[o + 14]!);
    const c: number[] = [];
    tr(p.cx, p.cy, p.cz, c);
    const tris: number[] = [];
    for (let k = 0; k < p.tris.length; k += 3) tr(p.tris[k]!, p.tris[k + 1]!, p.tris[k + 2]!, tris);
    const s2 = mats[o]! ** 2 + mats[o + 2]! ** 2;
    return { key: keyOf(c[0]!, c[1]!, c[2]!), x: c[0]!, y: c[1]!, z: c[2]!, tris: Float32Array.from(tris), area: p.area * s2 };
  }

  /**
   * Shatters a pane: hidden from now on, shards burst along `push` (a shot's direction, out
   * from a blast) and fall. `quiet`: no sound or shards (panes broken before this player came).
   */
  shatter(hit: GlassHit, push: { x: number; y: number; z: number; speed: number } | null, quiet = false): boolean {
    if (this.broken.has(hit.key)) return false;
    this.broken.set(hit.key, new Vector3(hit.x, hit.y, hit.z));
    this.uniformsAt.n = -1;
    if (quiet) return true;
    this.sound(hit.x, hit.y, hit.z, Math.min(1, .45 + hit.area * .25));
    const n = Math.max(8, Math.min(40, Math.round(hit.area * 16)));
    const tris = hit.tris, triCount = tris.length / 9;
    for (let k = 0; k < n; k++) {
      // A random point on the pane.
      const t = Math.floor(Math.random() * triCount) * 9;
      let u = Math.random(), w = Math.random();
      if (u + w > 1) { u = 1 - u; w = 1 - w; }
      const a = 1 - u - w;
      const x = tris[t]! * a + tris[t + 3]! * u + tris[t + 6]! * w, y = tris[t + 1]! * a + tris[t + 4]! * u + tris[t + 7]! * w, z = tris[t + 2]! * a + tris[t + 5]! * u + tris[t + 8]! * w;
      const sp = push ? push.speed * (.35 + Math.random() * .8) : .6;
      const shard: Shard = {
        x, y, z,
        vx: (push?.x ?? 0) * sp + (Math.random() - .5) * 1.6, vy: (push?.y ?? 0) * sp + Math.random() * 1.2, vz: (push?.z ?? 0) * sp + (Math.random() - .5) * 1.6,
        ax: Math.random() - .5, ay: Math.random() - .5, az: Math.random() - .5, spin: 4 + Math.random() * 14, angle: Math.random() * 6.28,
        size: .05 + Math.random() * .12, floor: this.floorBelow(x, y, z) + .01, life: 9 + Math.random() * 6, resting: false,
      };
      if (this.shards.length >= SHARD_MAX) this.shards.shift();
      this.shards.push(shard);
    }
    return true;
  }

  /** Panes broken elsewhere (the server's list): shattered here too, found among the placed models when near. */
  apply(keys: readonly number[], quiet: boolean): void {
    for (let i = 0; i + 2 < keys.length; i += 3) {
      const x = keys[i]! / 100, y = keys[i + 1]! / 100, z = keys[i + 2]! / 100, key = keyOf(x, y, z);
      if (this.broken.has(key)) continue;
      const pane = quiet ? null : this.near(x, y, z, .05).find((h) => h.key === key);
      this.shatter(pane ?? { key, x, y, z, tris: new Float32Array(), area: 0 }, null, quiet || !pane);
    }
  }

  /** Repaired (the server's world puts its windows back after a while). */
  repair(keys: readonly number[]): void {
    for (let i = 0; i + 2 < keys.length; i += 3) this.broken.delete(keyOf(keys[i]! / 100, keys[i + 1]! / 100, keys[i + 2]! / 100));
    this.uniformsAt.n = -1;
  }

  clear(): void { this.broken.clear(); this.shards.length = 0; this.uniformsAt.n = -1; }

  update(dt: number, camX: number, camZ: number): void {
    // The shader hides the broken panes nearest the camera.
    if (this.uniformsAt.n !== this.broken.size || Math.hypot(camX - this.uniformsAt.x, camZ - this.uniformsAt.z) > 15) {
      const list = [...this.broken.values()];
      if (list.length > GLASS_MAX) list.sort((a, b) => (a.x - camX) ** 2 + (a.z - camZ) ** 2 - (b.x - camX) ** 2 - (b.z - camZ) ** 2);
      const n = Math.min(GLASS_MAX, list.length);
      for (let i = 0; i < n; i++) brokenUniform.value[i]!.copy(list[i]!);
      countUniform.value = n;
      this.uniformsAt = { x: camX, z: camZ, n: this.broken.size };
    }
    // Shards: thrown, spinning, bouncing on the floor below and lying there a while.
    const step = Math.min(dt, .05);
    let k = 0;
    for (let i = 0; i < this.shards.length; i++) {
      const s = this.shards[i]!;
      s.life -= step;
      if (s.life <= 0) continue;
      if (!s.resting) {
        s.vy -= 9.8 * step;
        s.x += s.vx * step; s.y += s.vy * step; s.z += s.vz * step;
        s.angle += s.spin * step;
        if (s.y <= s.floor) {
          s.y = s.floor;
          if (Math.abs(s.vy) < 1.2) { s.resting = true; s.ax = 0; s.ay = 1; s.az = 0; }
          else { s.vy = -s.vy * .25; s.vx *= .45; s.vz *= .45; s.spin *= .5; }
        }
      }
      const fade = Math.min(1, s.life);
      this.q.setFromAxisAngle(this.axis.set(s.ax, s.ay, s.az).normalize(), s.angle);
      this.m.compose(this.at.set(s.x, s.y, s.z), this.q, this.scale.setScalar(s.size * fade));
      this.mesh.setMatrixAt(k, this.m);
      this.shards[k++] = s;
    }
    this.shards.length = k;
    this.mesh.count = k;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as Material).dispose();
  }
}
