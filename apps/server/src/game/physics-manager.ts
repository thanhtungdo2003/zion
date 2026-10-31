import { chunkKey, chunkKeyX, chunkKeyZ, type ChunkData, type PropInstance } from '@zion/shared';
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

  /**
   * Fixed maps (battle royale, infection, waves, warfare): the whole map is loaded once and stays
   * loaded. Nothing is evicted as players and bots move, so nothing is ever built twice (a fast
   * aircraft no longer drags chunk loading and collider building through every tick).
   */
  keepAll = false;
  private preload: Generator<readonly [number, number]> | null = null;
  private preloading = 0;
  /** Whole-map preload finished. */
  get complete(): boolean { return this.keepAll && this.preload === null && this.preloading === 0 && this.started; }
  private started = false;

  /**
   * Fixed maps: loads the whole map in the background, at most `inflight` chunks at a time, so the
   * tick keeps its pace while it fills (call every tick).
   */
  pumpPreload(sizeChunks: number, inflight = 4): void {
    if (!this.keepAll) return;
    if (!this.started) {
      this.started = true;
      const self = this;
      this.preload = (function* () { for (let cz = 0; cz < sizeChunks; cz++) for (let cx = 0; cx < sizeChunks; cx++) if (self.inWorld(cx, cz)) yield [cx, cz] as const; })();
    }
    while (this.preload && this.preloading < inflight) {
      const next = this.preload.next();
      if (next.done) { this.preload = null; break; }
      const [cx, cz] = next.value;
      if (this.loaded.has(chunkKey(cx, cz))) continue;
      this.preloading++;
      this.load(cx, cz).catch((err: unknown) => this.logger.error({ err, cx, cz }, 'physics preload failed')).finally(() => { this.preloading--; });
    }
  }

  /** A chunk's data went into the collision world (the game sets up what its props carry: doors). */
  onChunk: ((data: ChunkData) => void) | null = null;

  /** Props left out of the collision world (felled trees); reload a chunk after it changes. */
  propFilter: ((cx: number, cz: number, prop: PropInstance) => boolean) | null = null;

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

  /**
   * Loads one chunk into the collision world (idempotent, de-duplicated). `priority`: players need
   * theirs first (Physics); bots' ground waits behind the players' own terrain (Lod1), or a few
   * dozen roaming bots kept the map's generator busy and players' terrain never came.
   */
  load(cx: number, cz: number, priority: ChunkPriority = ChunkPriority.Physics): Promise<void> {
    const key = chunkKey(cx, cz);
    if (this.loaded.has(key) || !this.inWorld(cx, cz)) return Promise.resolve();
    const pending = this.loading.get(key);
    if (pending) {
      // Queued for a bot and now a player needs it: moved to the front.
      if (priority === ChunkPriority.Physics) this.world.getChunk(cx, cz, 0, priority).catch(() => undefined);
      return pending;
    }
    const p = this.world
      .getChunk(cx, cz, 0, priority)
      .then((rec) => {
        const filter = this.propFilter;
        const col = buildChunkCollision(filter ? { ...rec.data, props: rec.data.props.filter((p) => filter(cx, cz, p)) } : rec.data, this.registry);
        if (col.unknownAssets > 0) this.logger.warn({ cx, cz, unknown: col.unknownAssets }, 'chunk has unknown assets');
        this.collision.addChunk(cx, cz, col.heightfield, col.colliders);
        this.loaded.add(key);
        this.onChunk?.(rec.data);
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
  update(centers: ReadonlyArray<readonly [number, number]>, background: ReadonlyArray<readonly [number, number]> = []): void {
    // Bots and fixed places: the ground right round them, behind the players' needs.
    for (const [cx, cz] of background) {
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        this.load(cx + dx, cz + dz, ChunkPriority.Lod1).catch((err: unknown) => this.logger.error({ err, cx: cx + dx, cz: cz + dz }, 'physics chunk load failed'));
      }
    }
    for (const [cx, cz] of centers) {
      for (let dz = -PREFETCH_RADIUS; dz <= PREFETCH_RADIUS; dz++) {
        for (let dx = -PREFETCH_RADIUS; dx <= PREFETCH_RADIUS; dx++) {
          this.load(cx + dx, cz + dz).catch((err: unknown) => this.logger.error({ err, cx: cx + dx, cz: cz + dz }, 'physics chunk load failed'));
        }
      }
    }
    if (this.keepAll) return;
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
