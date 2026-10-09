import { CHUNK_SIZE, chunkKey } from '@zion/shared';

export interface Positioned {
  readonly id: number;
  x(): number;
  z(): number;
}

/**
 * Chunk-sized uniform grid of entities for interest management: each client only receives
 * entities within a radius, and gameplay queries (melee targets, chat range) are local.
 */
export class InterestGrid<T extends Positioned> {
  private readonly cells = new Map<number, Set<T>>();
  private readonly where = new Map<number, number>();

  update(e: T): void {
    const key = chunkKey(Math.floor(e.x() / CHUNK_SIZE), Math.floor(e.z() / CHUNK_SIZE));
    const prev = this.where.get(e.id);
    if (prev === key) return;
    if (prev !== undefined) {
      const set = this.cells.get(prev);
      set?.delete(e);
      if (set && set.size === 0) this.cells.delete(prev);
    }
    let set = this.cells.get(key);
    if (!set) this.cells.set(key, (set = new Set()));
    set.add(e);
    this.where.set(e.id, key);
  }

  remove(e: T): void {
    const prev = this.where.get(e.id);
    if (prev === undefined) return;
    const set = this.cells.get(prev);
    set?.delete(e);
    if (set && set.size === 0) this.cells.delete(prev);
    this.where.delete(e.id);
  }

  /** Entities in chunks within Chebyshev `radius` of chunk (cx, cz). */
  query(cx: number, cz: number, radius: number, out: T[]): T[] {
    out.length = 0;
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const set = this.cells.get(chunkKey(cx + dx, cz + dz));
        if (set) for (const e of set) out.push(e);
      }
    }
    return out;
  }

  get size(): number {
    return this.where.size;
  }
}
