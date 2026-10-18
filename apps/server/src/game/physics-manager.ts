import { chunkKey, chunkKeyX, chunkKeyZ } from '@zion/shared';
import { buildChunkCollision, type AssetRegistry } from '@zion/assets';
import type { CollisionWorld } from '@zion/physics';
import type { Logger } from '../logger';
import { ChunkPriority, type WorldService } from '../world/world-service';

/** Chunks within this radius of a player must be loaded before the player may move. */
export const PHYSICS_REQUIRED_RADIUS = 1;
const PREFETCH_RADIUS = 2;
const UNLOAD_RADIUS = 3;

/**
 * Keeps the authoritative collision world populated with LOD-0 terrain and prop colliders around
 * every player — and nowhere else. The server never simulates the whole map.
 */
export class PhysicsChunkManager {
  private readonly loading = new Map<number, Promise<void>>();
  private readonly loaded = new Set<number>();

  constructor(
    private readonly world: WorldService,
    private readonly collision: CollisionWorld,
    private readonly registry: AssetRegistry,
    private readonly logger: Logger,
  ) {}

  /** Props left out of the collision world (felled trees); reload a chunk after it changes. */
  propFilter: ((cx: number, cz: number, prop: import('@zion/shared').PropInstance) => boolean) | null = null;

  get loadedCount(): number {
    return this.loaded.size;
  }

  /** Shared loaded map, de-duplicated even when players' streaming regions overlap. */
  loadedChunks(): Array<readonly [number, number]> {
    return [...this.loaded].map(key => [chunkKeyX(key), chunkKeyZ(key)] as const);
  }

  private inWorld(cx: number, cz: number): boolean {
    return this.world.generator.inWorld(cx, cz);
  }

  /** Loads one chunk into the collision world (idempotent, de-duplicated). */
  load(cx: number, cz: number): Promise<void> {
    const key = chunkKey(cx, cz);
    if (this.loaded.has(key) || !this.inWorld(cx, cz)) return Promise.resolve();
    const pending = this.loading.get(key);
    if (pending) return pending;
    const p = this.world
      .getChunk(cx, cz, 0, ChunkPriority.Physics)
      .then((rec) => {
        const filter = this.propFilter;
        const col = buildChunkCollision(filter ? { ...rec.data, props: rec.data.props.filter((p) => filter(cx, cz, p)) } : rec.data, this.registry);
        if (col.unknownAssets > 0) this.logger.warn({ cx, cz, unknown: col.unknownAssets }, 'chunk has unknown assets');
        this.collision.addChunk(cx, cz, col.heightfield, col.colliders);
        this.loaded.add(key);
      })
      .finally(() => this.loading.delete(key));
    this.loading.set(key, p);
    return p;
  }

  /** Drops and reloads a chunk's colliders (its props changed). */
  reload(cx: number, cz: number): void {
    const key = chunkKey(cx, cz);
    if (!this.loaded.has(key)) return;
    // Rebuilt in place from the cached chunk when possible (no window without colliders).
    const rec = this.world.peek(cx, cz, 0);
    if (rec) {
      const filter = this.propFilter;
      const col = buildChunkCollision(filter ? { ...rec.data, props: rec.data.props.filter((p) => filter(cx, cz, p)) } : rec.data, this.registry);
      this.collision.removeChunk(cx, cz);
      this.collision.addChunk(cx, cz, col.heightfield, col.colliders);
      return;
    }
    this.collision.removeChunk(cx, cz);
    this.loaded.delete(key);
    this.load(cx, cz).catch((err: unknown) => this.logger.error({ err, cx, cz }, 'physics chunk reload failed'));
  }

  /** Resolves once every chunk within `radius` of (cx, cz) is in the collision world. */
  async ensureArea(cx: number, cz: number, radius: number): Promise<void> {
    const jobs: Array<Promise<void>> = [];
    for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) jobs.push(this.load(cx + dx, cz + dz));
    await Promise.all(jobs);
  }

  /**
   * Requests chunks around the given player chunk positions and evicts chunks no player is near.
   * Called periodically from the tick loop.
   */
  update(centers: ReadonlyArray<readonly [number, number]>): void {
    for (const [cx, cz] of centers) {
      for (let dz = -PREFETCH_RADIUS; dz <= PREFETCH_RADIUS; dz++) {
        for (let dx = -PREFETCH_RADIUS; dx <= PREFETCH_RADIUS; dx++) {
          this.load(cx + dx, cz + dz).catch((err: unknown) => this.logger.error({ err, cx: cx + dx, cz: cz + dz }, 'physics chunk load failed'));
        }
      }
    }
    for (const key of [...this.loaded]) {
      const x = chunkKeyX(key);
      const z = chunkKeyZ(key);
      let needed = false;
      for (const [cx, cz] of centers) {
        if (Math.abs(cx - x) <= UNLOAD_RADIUS && Math.abs(cz - z) <= UNLOAD_RADIUS) {
          needed = true;
          break;
        }
      }
      if (!needed) {
        this.collision.removeChunk(x, z);
        this.loaded.delete(key);
      }
    }
  }
}
