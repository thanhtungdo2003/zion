import { DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh, type BufferGeometry, type Material, type Scene } from 'three';
import { farFoliageMaterial, farMaterial, simplifyAsset } from './far-lod';
import { PROPS_MAX_LOD, propTransform, type ChunkData } from '@zion/shared';
import type { AssetLibrary, AssetVisual } from './asset-library';

interface Batch {
  matrices: Float32Array;
  count: number;
  /** Per instance: x, y, z, yaw, scale, group (occlusion test). */
  spheres: Float32Array;
  /** Per instance: current see-through fade 0…1 (eased towards its target). */
  fade: Float32Array;
  /** Any instance currently faded (so idle batches skip the attribute upload). */
  fading: boolean;
  hidden: Uint8Array;
}

/** Beyond these distances (m, × draw distance) models switch to their simplified far form. */
const TREE_LOD_DISTANCE = 70;
const MODEL_LOD_DISTANCE = 170;

/** A far model: the asset's own silhouette, simplified and flat-coloured (see far-lod.ts). */
interface Proxy { parts: Array<{ geometry: BufferGeometry; material: Material }> }
function makeProxy(v: AssetVisual): Proxy {
  // Foliage keeps more of its outline and a grainy, leafy shading; buildings stay flat-faceted.
  const leafy = v.def.category === 'tree' || v.def.category === 'vegetation';
  return { parts: [{ geometry: simplifyAsset(v, leafy ? 11 : 9), material: leafy ? farFoliageMaterial : farMaterial }] };
}

/** How fast occluders fade out / back in (per second). */
const FADE_SPEED = 6;
/** Floats of per-instance info. */
const INFO = 6;

/**
 * Renders every placed prop (trees, rocks, crates…) with one InstancedMesh per asset part, so the
 * draw-call count depends on the number of asset types, not on the number of objects. Instance
 * buffers are rebuilt (throttled) when the streamed chunk set changes or the camera moves far.
 */
export class PropRenderer {
  private readonly meshes = new Map<string, InstancedMesh>();
  private batches = new Map<number, Batch>();
  private spareBatches = new Map<number, Batch>();
  private rebuildJob: Generator<void> | null = null;
  private readonly pending = new Set<number>();
  private disposed = false;
  private readonly colliderBoxes = new WeakMap<AssetVisual, AssetVisual['def']['colliders']>();
  private dirty = true;
  private lastRebuild = 0;
  private lastX = Infinity;
  private lastZ = Infinity;
  instanceCount = 0;

  constructor(
    private readonly scene: Scene,
    private readonly library: AssetLibrary,
    private readonly chunks: () => Iterable<ChunkData>,
  ) {}

  private readonly proxies = new Map<number, Proxy>();
  private distanceScale = 1;
  /** Graphics setting: multiplies every asset's render distance. */
  setDistanceScale(scale: number): void { if (scale !== this.distanceScale) { this.distanceScale = scale; this.markDirty(); } }

  /** Every model in range is loaded and placed (used to hold the loading screen). */
  get settled(): boolean { return !this.rebuildJob && !this.dirty && this.pending.size === 0; }

  markDirty(): void {
    this.dirty = true;
  }

  update(camX: number, camZ: number, now: number, deadline = Infinity): void {
    if (this.disposed) return;
    const moved = (camX - this.lastX) ** 2 + (camZ - this.lastZ) ** 2 > 24 * 24;
    if (!this.rebuildJob) {
      if ((!this.dirty && !moved) || now - this.lastRebuild < 250) return;
      this.dirty = false;
      this.lastRebuild = now;
      this.lastX = camX;
      this.lastZ = camZ;
      // Snapshot membership: arrivals during a rebuild schedule the next pass.
      this.rebuildJob = this.rebuild(camX, camZ, [...this.chunks()]);
    }
    while (performance.now() < deadline) {
      if (this.rebuildJob.next().done) {
        this.rebuildJob = null;
        break;
      }
    }
  }

  private batch(asset: number): Batch {
    let b = this.spareBatches.get(asset);
    if (!b) this.spareBatches.set(asset, (b = { matrices: new Float32Array(16 * 256), count: 0, spheres: new Float32Array(INFO * 256), fade: new Float32Array(256), hidden: new Uint8Array(256), fading: false }));
    return b;
  }

  private *rebuild(camX: number, camZ: number, chunks: ChunkData[]): Generator<void> {
    for (const b of this.spareBatches.values()) {
      b.count = 0;
      b.fade.fill(0);
      b.hidden.fill(0);
      b.fading = false;
    }
    const visuals = new Map<number, AssetVisual>();
    let scanned = 0;
    for (const chunk of chunks) {
      if (chunk.lod > PROPS_MAX_LOD) continue;
      for (const p of chunk.props) {
        if (p.asset === 2202) continue;
        const location = propTransform(chunk, p);
        if (!this.library.inRange(p.asset, (location.x - camX) ** 2 + (location.z - camZ) ** 2)) continue;
        if (++scanned % 128 === 0) yield;
        let v = visuals.get(p.asset);
        if (!v) {
          v = this.library.get(p.asset);
          if (!v) {
            if (!this.pending.has(p.asset)) {
              this.pending.add(p.asset);
              void this.library.load(p.asset)?.then(() => {
                this.pending.delete(p.asset);
                if (!this.disposed) this.markDirty();
              });
            }
            continue;
          }
          visuals.set(p.asset, v);
        }
        const t = propTransform(chunk, p);
        // Max draw distance (high preset): full detail much further out, models drawn as far as streamed.
        const high = this.distanceScale >= 1;
        const max = v.def.render.maxDistance * this.distanceScale * (high ? 1.8 : 1), d2 = (t.x - camX) ** 2 + (t.z - camZ) ** 2;
        if (d2 > max * max) continue;
        // Distant models keep their place and shape, drawn simplified and flat (negative key).
        const lod = (v.def.category === 'tree' ? TREE_LOD_DISTANCE : MODEL_LOD_DISTANCE) * (high ? 2.4 : Math.max(.6, this.distanceScale));
        const b = this.batch(v.def.bounds.radius > 1.2 && d2 > lod * lod ? -p.asset : p.asset);
        if ((b.count + 1) * 16 > b.matrices.length) {
          const grown = new Float32Array(b.matrices.length * 2);
          grown.set(b.matrices);
          b.matrices = grown;
          const sp = new Float32Array(b.spheres.length * 2);
          sp.set(b.spheres);
          b.spheres = sp;
          b.fade = new Float32Array(b.fade.length * 2);
          b.hidden = new Uint8Array(b.fade.length);
        }
        const so = b.count * INFO;
        b.spheres[so] = t.x;
        b.spheres[so + 1] = t.y;
        b.spheres[so + 2] = t.z;
        b.spheres[so + 3] = t.rotY;
        b.spheres[so + 4] = t.scale;
        b.spheres[so + 5] = p.group ?? 0;
        const c = Math.cos(t.rotY) * t.scale;
        const s = Math.sin(t.rotY) * t.scale;
        const m = b.matrices;
        const o = b.count * 16;
        m[o] = c;
        m[o + 1] = 0;
        m[o + 2] = -s;
        m[o + 3] = 0;
        m[o + 4] = 0;
        m[o + 5] = t.scale;
        m[o + 6] = 0;
        m[o + 7] = 0;
        m[o + 8] = s;
        m[o + 9] = 0;
        m[o + 10] = c;
        m[o + 11] = 0;
        m[o + 12] = t.x;
        m[o + 13] = t.y;
        m[o + 14] = t.z;
        m[o + 15] = 1;
        b.count++;
      }
      yield;
    }

    // Keep the previous scene/occlusion data intact until the new buffers are complete.
    const old = this.batches;
    this.batches = this.spareBatches;
    this.spareBatches = old;
    let total = 0;
    const used = new Set<string>();
    for (const [asset, b] of this.batches) {
      if (b.count === 0) { this.batches.delete(asset); continue; }
      const v = this.library.get(Math.abs(asset));
      if (!v) continue;
      const far = asset < 0;
      let parts: Proxy['parts'] = v.parts;
      if (far) { let proxy = this.proxies.get(-asset); if (!proxy) this.proxies.set(-asset, proxy = makeProxy(v)); parts = proxy.parts; }
      parts.forEach((part, i) => {
        const key = `${asset}:${i}`;
        used.add(key);
        let mesh = this.meshes.get(key);
        if (!mesh || mesh.instanceMatrix.count < b.count) {
          if (mesh) {
            this.scene.remove(mesh);
            mesh.dispose();
            mesh.geometry.dispose();
          }
          let cap = 64;
          while (cap < b.count) cap *= 2;
          // Instance attributes belong to this batch, never to the shared asset template.
          const geometry = part.geometry.clone();
          mesh = new InstancedMesh(geometry, part.material, cap);
          // Per-instance see-through amount (read by the occlusion-fade shader patch).
          geometry.setAttribute('aFade', new InstancedBufferAttribute(new Float32Array(cap), 1).setUsage(DynamicDrawUsage));
          mesh.instanceMatrix.setUsage(DynamicDrawUsage);
          mesh.frustumCulled = false;
          mesh.castShadow = !far && v.def.render.castShadow;
          mesh.receiveShadow = true;
          this.meshes.set(key, mesh);
          this.scene.add(mesh);
        }
        (mesh.instanceMatrix.array as Float32Array).set(b.matrices.subarray(0, b.count * 16));
        mesh.count = b.count;
        mesh.instanceMatrix.needsUpdate = true;
        const fade = mesh.geometry.getAttribute('aFade') as InstancedBufferAttribute;
        (fade.array as Float32Array).fill(0);
        fade.needsUpdate = true;
        total += b.count;
      });
    }
    for (const [key, mesh] of this.meshes) {
      if (!used.has(key)) {
        this.scene.remove(mesh);
        mesh.dispose();
        mesh.geometry.dispose();
        this.meshes.delete(key);
      }
    }
    this.instanceCount = total;
    for (const asset of this.spareBatches.keys()) {
      if (!this.batches.has(asset)) this.spareBatches.delete(asset);
    }
  }

  /**
   * See-through occluders. A prop fades only when it really hides the player: a ray from the
   * camera to the player's head, chest or feet must hit the prop's collision box (or, for trees,
   * its canopy) before reaching them — standing in front of a wall never fades it. Every piece of
   * the same group (a whole wall or building) fades together.
   */
  updateOcclusion(px: number, py: number, pz: number, cx: number, cy: number, cz: number, dt: number): void {
    const step = Math.min(1, dt * FADE_SPEED);
    const groups = new Set<number>();
    // Pass 1: who blocks the view of the player?
    for (const [asset, b] of this.batches) {
      b.hidden.fill(0, 0, b.count);
      const v = this.library.get(asset);
      // A whole map model (Infection's Warehouse) never fades out around the player.
      if (!v || v.def.tags.includes('infection-map')) continue;
      for (let i = 0; i < b.count; i++) {
        const o = i * INFO;
        const ox = b.spheres[o]!;
        const oz = b.spheres[o + 2]!;
        if ((ox - px) ** 2 + (oz - pz) ** 2 > 900) continue;
        if (!this.blocks(v, b.spheres, o, px, py, pz, cx, cy, cz)) continue;
        const g = b.spheres[o + 5]!;
        if (g) groups.add(g);
        else b.hidden[i] = 1;
      }
    }
    // Pass 2: ease every instance towards its target and upload what changed.
    for (const [asset, b] of this.batches) {
      let changed = false;
      let any = false;
      for (let i = 0; i < b.count; i++) {
        const g = b.spheres[i * INFO + 5]!;
        const target = (g && groups.has(g)) || (!g && b.hidden[i]) ? 1 : 0;
        const f = b.fade[i]!;
        if (f !== target) {
          b.fade[i] = target > f ? Math.min(1, f + step) : Math.max(0, f - step);
          changed = true;
        }
        if (b.fade[i]! > 0) any = true;
      }
      if (!changed && !b.fading) continue;
      b.fading = any;
      const v = this.library.get(asset);
      if (!v) continue;
      v.parts.forEach((_part, k) => {
        const mesh = this.meshes.get(`${asset}:${k}`);
        const attr = mesh?.geometry.getAttribute('aFade') as InstancedBufferAttribute | undefined;
        if (!attr) return;
        (attr.array as Float32Array).set(b.fade.subarray(0, Math.min(b.count, attr.count)));
        attr.needsUpdate = true;
      });
    }
  }

  /** Does instance `o` stand between the camera and any of the player's head / chest / feet? */
  private blocks(v: AssetVisual, info: Float32Array, o: number, px: number, py: number, pz: number, cx: number, cy: number, cz: number): boolean {
    const x = info[o]!;
    const y = info[o + 1]!;
    const z = info[o + 2]!;
    const yaw = info[o + 3]!;
    const sc = info[o + 4]!;
    let boxes = this.colliderBoxes.get(v);
    if (!boxes) { boxes = v.def.colliders.filter((c) => c.type === 'box'); this.colliderBoxes.set(v, boxes); }
    // Standing inside it (a tent, under a roof): fade if it rises above the player's head and the
    // player is within the area its collision boxes enclose (thin walls never enclose anyone).
    if (boxes.length && y + v.def.bounds.height * sc > py + 1.6) {
      const c0 = Math.cos(-yaw);
      const s0 = Math.sin(-yaw);
      const rx = px - x;
      const rz = pz - z;
      const lx = (rx * c0 + rz * s0) / sc;
      const lz = (-rx * s0 + rz * c0) / sc;
      let x0 = Infinity;
      let x1 = -Infinity;
      let z0 = Infinity;
      let z1 = -Infinity;
      for (const bx of boxes) {
        if (bx.type !== 'box') continue;
        x0 = Math.min(x0, bx.center[0] - bx.halfExtents[0]);
        x1 = Math.max(x1, bx.center[0] + bx.halfExtents[0]);
        z0 = Math.min(z0, bx.center[2] - bx.halfExtents[2]);
        z1 = Math.max(z1, bx.center[2] + bx.halfExtents[2]);
      }
      if (x1 - x0 > 1.2 && z1 - z0 > 1.2 && lx > x0 && lx < x1 && lz > z0 && lz < z1 && py + 0.5 > y - 0.5) return true;
    }
    for (const h of [1.7, 1.05, 0.35]) {
      const tx = px;
      const ty = py + h;
      const tz = pz;
      const dx = tx - cx;
      const dy = ty - cy;
      const dz = tz - cz;
      const len = Math.hypot(dx, dy, dz);
      // Hit must happen clearly before the player (not behind them).
      const limit = len - 0.35;
      if (boxes.length) {
        // Ray into the prop's local frame: undo translation, yaw and scale.
        const c = Math.cos(-yaw);
        const s = Math.sin(-yaw);
        const rx = cx - x;
        const ry = cy - y;
        const rz = cz - z;
        const lox = (rx * c + rz * s) / sc;
        const loy = ry / sc;
        const loz = (-rx * s + rz * c) / sc;
        const ldx = (dx * c + dz * s) / sc / len;
        const ldy = dy / sc / len;
        const ldz = (-dx * s + dz * c) / sc / len;
        for (const bx of boxes) {
          if (bx.type !== 'box') continue;
          // Box yaw (rare) is folded in by rotating the local ray once more.
          const bc = Math.cos(-bx.yaw);
          const bs = Math.sin(-bx.yaw);
          const ox2 = lox - bx.center[0];
          const oz2 = loz - bx.center[2];
          const qx = ox2 * bc + oz2 * bs;
          const qz = -ox2 * bs + oz2 * bc;
          const qdx = ldx * bc + ldz * bs;
          const qdz = -ldx * bs + ldz * bc;
          const t = rayBox(qx, loy - bx.center[1], qz, qdx, ldy, qdz, bx.halfExtents[0], bx.halfExtents[1], bx.halfExtents[2]);
          // Origin and direction were both divided by the scale, so t is still a world distance.
          if (t !== null && t < limit) return true;
        }
      } else {
        // No box (trees, lamps): a stack of spheres up the trunk and through the canopy.
        const r = Math.max(0.4, v.def.bounds.radius * sc * 0.8);
        for (const k of [0.25, 0.5, 0.75, 0.95]) {
          const ox = x - cx;
          const oy = y + v.def.bounds.height * sc * k - cy;
          const oz = z - cz;
          const along = (ox * dx + oy * dy + oz * dz) / len;
          if (along <= 0 || along > limit) continue;
          const d2 = ox * ox + oy * oy + oz * oz - along * along;
          if (d2 < r * r) return true;
        }
      }
    }
    return false;
  }

  dispose(): void {
    this.disposed = true;
    for (const mesh of this.meshes.values()) {
      this.scene.remove(mesh);
      mesh.dispose();
      mesh.geometry.dispose();
    }
    this.meshes.clear();
    this.batches.clear();
    this.spareBatches.clear();
    this.rebuildJob = null;
    this.pending.clear();
  }
}

/** Slab test: distance along a (unit-ish) ray to an axis-aligned box centred at the origin, or null. */
function rayBox(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, hx: number, hy: number, hz: number): number | null {
  let tmin = -Infinity;
  let tmax = Infinity;
  for (const [o, d, h] of [[ox, dx, hx], [oy, dy, hy], [oz, dz, hz]] as const) {
    if (Math.abs(d) < 1e-9) {
      if (o < -h || o > h) return null;
      continue;
    }
    let t1 = (-h - o) / d;
    let t2 = (h - o) / d;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  return tmax < 0 ? null : Math.max(0, tmin);
}
