import type { BufferGeometry, Material, MeshLambertMaterial, WebGLRenderer } from 'three';
import type { AssetVisual } from './asset-library';
import { ImpostorBaker, impostorMaterial, impostorQuad, type ImpostorAtlas } from './impostor';

/**
 * The depth impostors of every tree the world places: baked automatically the first time a model
 * is needed far off (one per frame within the frame's spare time, never by hand), kept for the
 * session, and shared by every instance of that model.
 */
export class ImpostorCache {
  private readonly baker: ImpostorBaker;
  private readonly atlases = new Map<number, ImpostorAtlas>();
  private readonly queue = new Map<number, AssetVisual>();
  private readonly failed = new Set<number>();
  private readonly materials = new Map<string, MeshLambertMaterial>();
  private readonly quad: BufferGeometry = impostorQuad();
  /** A model was baked: placed instances can switch to it. */
  onBaked: (() => void) | null = null;
  /** Time spent baking (ms), for the benchmark. */
  bakeMs = 0;

  constructor(renderer: WebGLRenderer, cell = 64) {
    this.baker = new ImpostorBaker(renderer, cell);
  }

  /** Whether a model's impostor is ready; if not, it is queued for baking. */
  ready(asset: number, v: AssetVisual): boolean {
    if (this.atlases.has(asset)) return true;
    if (!this.failed.has(asset)) this.queue.set(asset, v);
    return false;
  }

  /** Bakes queued models while there is time left in this frame (at least one when any wait). */
  pump(deadline: number): void {
    let baked = false;
    for (const [asset, v] of this.queue) {
      this.queue.delete(asset);
      const t0 = performance.now();
      try { this.atlases.set(asset, this.baker.bake(v)); baked = true; } catch (err) { this.failed.add(asset); console.warn('impostor bake failed', asset, err); }
      this.bakeMs += performance.now() - t0;
      if (performance.now() > deadline) break;
    }
    if (baked) this.onBaked?.();
  }

  /** Bakes every queued model now (the benchmark's batch bake). */
  bakeAll(): number { const n = this.queue.size; this.pump(Infinity); return n; }

  /** The draw parts of a model's impostor: the near ring (depth, parallax) or the flat far ring. */
  parts(asset: number, far: boolean, near: number, band: number): Array<{ geometry: BufferGeometry; material: Material }> | null {
    const atlas = this.atlases.get(asset);
    if (!atlas) return null;
    const key = `${asset}:${far ? 'f' : 'n'}`;
    let mat = this.materials.get(key);
    if (!mat) this.materials.set(key, mat = impostorMaterial(atlas, { near: far ? 0 : near, band: far ? 1 : band, depth: !far }));
    // (The hand-over distance follows the draw-distance setting.)
    else if (!far) (mat.userData.impFade as { value: number[] }).value = [near, band];
    return [{ geometry: this.quad, material: mat }];
  }

  get stats(): { models: number; textureMB: number; bakeMs: number } {
    let bytes = 0;
    for (const a of this.atlases.values()) bytes += a.bytes;
    return { models: this.atlases.size, textureMB: Math.round(bytes / 1048576 * 10) / 10, bakeMs: Math.round(this.bakeMs) };
  }

  dispose(): void {
    for (const a of this.atlases.values()) a.dispose();
    for (const m of this.materials.values()) m.dispose();
    this.atlases.clear(); this.materials.clear(); this.queue.clear();
    this.quad.dispose(); this.baker.dispose();
  }
}
