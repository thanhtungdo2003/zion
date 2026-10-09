import {
  BIOME_NAMES,
  CHUNK_SIZE,
  SURFACE_NAMES,
  chunkKey,
  lodStep,
  type Biome,
  type ChunkData,
  type Surface,
} from '@zion/shared';
import { CollisionWorld } from '@zion/physics';
import { buildChunkCollision, type AssetRegistry } from '@zion/assets';

export interface ChunkListener {
  onChunkSet(chunk: ChunkData, previous: ChunkData | undefined): void;
  onChunkRemoved(chunk: ChunkData): void;
}

/**
 * Client-side mirror of the chunks the server streamed to us. LOD-0 chunks are also inserted
 * into a local CollisionWorld — built from exactly the same data and code as the server's — so
 * client-side prediction collides with the same walls, rocks and terrain.
 */
export class ChunkStore {
  readonly chunks = new Map<number, ChunkData>();
  readonly collision: CollisionWorld;
  private readonly listeners: ChunkListener[] = [];

  constructor(
    worldSize: number,
    seaLevel: number,
    private readonly registry: AssetRegistry,
  ) {
    this.collision = new CollisionWorld({ worldSize, seaLevel });
  }

  listen(l: ChunkListener): void {
    this.listeners.push(l);
  }

  set(chunk: ChunkData): void {
    const key = chunkKey(chunk.cx, chunk.cz);
    const prev = this.chunks.get(key);
    this.chunks.set(key, chunk);
    if (chunk.lod === 0) {
      const col = buildChunkCollision(chunk, this.registry);
      this.collision.addChunk(chunk.cx, chunk.cz, col.heightfield, col.colliders);
    } else if (prev?.lod === 0) {
      this.collision.removeChunk(chunk.cx, chunk.cz);
    }
    for (const l of this.listeners) l.onChunkSet(chunk, prev);
  }

  remove(cx: number, cz: number): void {
    const key = chunkKey(cx, cz);
    const prev = this.chunks.get(key);
    if (!prev) return;
    this.chunks.delete(key);
    this.collision.removeChunk(cx, cz);
    for (const l of this.listeners) l.onChunkRemoved(prev);
  }

  get(cx: number, cz: number): ChunkData | undefined {
    return this.chunks.get(chunkKey(cx, cz));
  }

  /** Nearest-vertex lookup of per-vertex chunk attributes at a world position. */
  sample(x: number, z: number): { biome: string; surface: string; temperature: number; humidity: number } | null {
    const c = this.get(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE));
    if (!c) return null;
    const step = lodStep(c.lod);
    const i = Math.min(c.verts - 1, Math.max(0, Math.round((x - c.cx * CHUNK_SIZE) / step)));
    const j = Math.min(c.verts - 1, Math.max(0, Math.round((z - c.cz * CHUNK_SIZE) / step)));
    const k = j * c.verts + i;
    return {
      biome: BIOME_NAMES[c.biome[k]! as Biome] ?? '?',
      surface: SURFACE_NAMES[c.surface[k]! as Surface] ?? '?',
      temperature: c.temperature[k]! / 255,
      humidity: c.humidity[k]! / 255,
    };
  }

  clear(): void {
    for (const c of [...this.chunks.values()]) this.remove(c.cx, c.cz);
  }
}
