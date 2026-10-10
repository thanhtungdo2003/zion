import { CHUNK_SIZE, chunkKey, type VegetationCell, type VegetationMessage } from '@zion/shared';

interface DamagedCell {
  data: VegetationCell;
  eligibleAt: number;
}
interface DamagedChunk {
  revision: number;
  cells: Map<number, DamagedCell>;
}

export interface VegetationWorld {
  /** NaN for unavailable, submerged or unvegetated ground. */
  ground(x: number, z: number): number;
  visible(ox: number, oy: number, oz: number, x: number, y: number, z: number): boolean;
}

/** Server-owned transient ground damage, independent of streamed terrain and clients. */
export class VegetationDamage {
  private readonly chunks = new Map<number, DamagedChunk>();
  private revision = 0;

  constructor(private readonly world: VegetationWorld, private readonly random: () => number = Math.random) {}

  explode(x: number, y: number, z: number, radius: number, now: number): void {
    this.damage(x, z, radius, now, 0, (tx, ty, tz) => {
      if (Math.hypot(tx - x, ty + 0.3 - y, tz - z) > radius) return false;
      return this.world.visible(x, y + 0.3, z, tx, ty + 0.3, tz);
    });
  }

  burn(x: number, y: number, z: number, dx: number, dz: number, range: number, spread: number, seconds: number, now: number): void {
    this.damage(x, z, range, now, seconds * 1000, (tx, ty, tz) => {
      const rx = tx - x;
      const rz = tz - z;
      const d = Math.hypot(rx, rz);
      if (d > range || Math.abs(ty + 0.3 - y) > 2.5) return false;
      if (d > 0.05 && (rx * dx + rz * dz) / d < Math.cos(spread + Math.atan(0.45 / d))) return false;
      return this.world.visible(x, y, z, tx, ty + 0.3, tz);
    });
  }

  private damage(x: number, z: number, radius: number, now: number, burnMs: number, hit: (x: number, y: number, z: number) => boolean): void {
    for (let gz = Math.floor(z - radius); gz <= Math.floor(z + radius); gz++) {
      for (let gx = Math.floor(x - radius); gx <= Math.floor(x + radius); gx++) {
        const tx = gx + 0.5;
        const tz = gz + 0.5;
        const y = this.world.ground(tx, tz);
        if (!Number.isFinite(y) || !hit(tx, y, tz)) continue;
        const cx = Math.floor(gx / CHUNK_SIZE);
        const cz = Math.floor(gz / CHUNK_SIZE);
        const lx = gx - cx * CHUNK_SIZE;
        const lz = gz - cz * CHUNK_SIZE;
        const key = chunkKey(cx, cz);
        let chunk = this.chunks.get(key);
        if (!chunk) {
          chunk = { revision: 0, cells: new Map() };
          this.chunks.set(key, chunk);
        }
        const cellKey = lz * CHUNK_SIZE + lx;
        const previous = chunk.cells.get(cellKey);
        const fireUntil = Math.max(previous?.data[3] ?? 0, burnMs > 0 ? now + burnMs : 0);
        chunk.cells.set(cellKey, {
          data: [lx, lz, y, fireUntil],
          // Repeated damage postpones growth; nothing regrows while still burning.
          eligibleAt: Math.max(now + 15_000, fireUntil),
        });
        chunk.revision = ++this.revision;
      }
    }
  }

  /** Random selection per simulation second: default speed 3 averages 60 s after cooldown. */
  step(now: number, dtSeconds: number, randomTickSpeed: number): void {
    if (randomTickSpeed <= 0 || dtSeconds <= 0) return;
    const probability = -Math.expm1(-randomTickSpeed * dtSeconds / 180);
    for (const [key, chunk] of this.chunks) {
      for (const [cellKey, cell] of chunk.cells) {
        if (now < cell.eligibleAt || this.random() >= probability) continue;
        chunk.cells.delete(cellKey);
        chunk.revision = ++this.revision;
      }
      if (chunk.cells.size === 0) this.chunks.delete(key);
    }
  }

  /** Only changed nearby chunks are sent; known revisions belong to one connection. */
  sync(cx: number, cz: number, radius: number, known: Map<number, number>, reset: boolean): VegetationMessage | null {
    if (reset) known.clear();
    const chunks: VegetationMessage['chunks'] = [];
    for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) {
      const key = chunkKey(cx + dx, cz + dz);
      const chunk = this.chunks.get(key);
      if (chunk) {
        if (known.get(key) === chunk.revision) continue;
        chunks.push({ cx: cx + dx, cz: cz + dz, cells: [...chunk.cells.values()].map((cell) => cell.data) });
        known.set(key, chunk.revision);
      } else if (known.delete(key)) chunks.push({ cx: cx + dx, cz: cz + dz, cells: [] });
    }
    return reset || chunks.length ? { t: 'vegetation', reset, chunks } : null;
  }
}
