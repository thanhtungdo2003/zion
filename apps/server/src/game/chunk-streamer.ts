import {
  LOD_COUNT,
  LOD_RINGS,
  chunkKey,
  chunkKeyX,
  chunkKeyZ,
  encodeChunkMessage,
  encodeChunkUnload,
} from '@zion/shared';
import type { Metrics } from '../metrics';
import { ChunkPriority, QueueFullError, type WorldService } from '../world/world-service';
import { STREAM_PAUSE_BYTES, type ClientSession } from './session';

const MAX_RING = LOD_RINGS[LOD_COUNT - 1]!;
const UNLOAD_MARGIN = 2;
const MAX_CHUNKS_PER_TICK = 6;
const MAX_BYTES_PER_TICK = 128 * 1024;
const MAX_INFLIGHT_GENERATION = 24;

/** Offsets within MAX_RING sorted nearest-first (Chebyshev, then Euclidean for a round front). */
const SPIRAL: ReadonlyArray<readonly [number, number, number]> = (() => {
  const out: Array<[number, number, number]> = [];
  for (let dz = -MAX_RING; dz <= MAX_RING; dz++) {
    for (let dx = -MAX_RING; dx <= MAX_RING; dx++) out.push([dx, dz, Math.max(Math.abs(dx), Math.abs(dz))]);
  }
  return out.sort((a, b) => a[2] - b[2] || a[0] * a[0] + a[1] * a[1] - (b[0] * b[0] + b[1] * b[1]));
})();

export function lodForDistance(d: number): number {
  for (let lod = 0; lod < LOD_COUNT; lod++) if (d <= LOD_RINGS[lod]!) return lod;
  return -1;
}

/**
 * Server-driven chunk streaming for one client. The client cannot request arbitrary chunks (no
 * amplification vector); the server decides what each client needs from its authoritative
 * position, sends nearest-first under a per-tick byte budget, pauses under socket backpressure,
 * upgrades/downgrades LOD with hysteresis and tells the client what to unload.
 */
export class ChunkStreamer {
  /** chunkKey → LOD the client currently holds. */
  private readonly sent = new Map<number, number>();
  private readonly generating = new Set<number>();
  private centerX = Number.NaN;
  private centerZ = Number.NaN;
  private dirty = true;
  private seq = 0;

  constructor(
    private readonly session: ClientSession,
    private readonly world: WorldService,
    private readonly sizeChunks: number,
    private readonly metrics: Metrics,
    /**
     * A fixed map: a chunk keeps the detail it was sent with until it is far out of range (no
     * resending it coarser at every step away, and rebuilding it on the client each time).
     */
    private readonly bounded = false,
  ) {}

  get loadedCount(): number {
    return this.sent.size;
  }

  /** Has the client received LOD-0 terrain for every chunk within `radius` of (cx, cz)? */
  hasLod0Around(cx: number, cz: number, radius: number): boolean {
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const x = cx + dx;
        const z = cz + dz;
        if (x < 0 || z < 0 || x >= this.sizeChunks || z >= this.sizeChunks) continue;
        if (this.sent.get(chunkKey(x, z)) !== 0) return false;
      }
    }
    return true;
  }

  /** Forgets that these chunks were sent, so they stream again (their content changed). */
  invalidate(chunks: ReadonlyArray<readonly [number, number]>): void {
    for (const [cx, cz] of chunks) this.sent.delete(chunkKey(cx, cz));
    this.dirty = true;
  }

  setCenter(cx: number, cz: number): void {
    if (cx === this.centerX && cz === this.centerZ) return;
    this.centerX = cx;
    this.centerZ = cz;
    this.dirty = true;
    this.pruneFar();
  }

  private pruneFar(): void {
    const unload: Array<[number, number]> = [];
    for (const [key, lod] of this.sent) {
      const cx = chunkKeyX(key);
      const cz = chunkKeyZ(key);
      const d = Math.max(Math.abs(cx - this.centerX), Math.abs(cz - this.centerZ));
      if (d > MAX_RING + (this.bounded ? UNLOAD_MARGIN * 3 : UNLOAD_MARGIN)) {
        unload.push([cx, cz]);
        this.sent.delete(key);
      } else if (!this.bounded && lod < LOD_COUNT - 1 && d > LOD_RINGS[lod]! + UNLOAD_MARGIN) {
        // Too detailed for its distance: forget it so the next pass sends the coarser version.
        this.sent.delete(key);
      }
    }
    for (let i = 0; i < unload.length; i += 2000) {
      this.session.sendBinary(encodeChunkUnload(++this.seq, unload.slice(i, i + 2000)), false);
    }
  }

  update(): void {
    if (!this.dirty || !this.session.open) return;
    if (this.session.buffered > STREAM_PAUSE_BYTES) return;
    let sentChunks = 0;
    let sentBytes = 0;
    let outstanding = false;
    for (const [dx, dz, d] of SPIRAL) {
      const cx = this.centerX + dx;
      const cz = this.centerZ + dz;
      if (cx < 0 || cz < 0 || cx >= this.sizeChunks || cz >= this.sizeChunks) continue;
      const want = lodForDistance(d);
      const key = chunkKey(cx, cz);
      const have = this.sent.get(key);
      if (have !== undefined && have <= want) continue;
      outstanding = true;
      const rec = this.world.peek(cx, cz, want);
      if (rec) {
        const frame = encodeChunkMessage({ cx, cz, lod: want, seq: ++this.seq }, rec.body);
        if (!this.session.sendBinary(frame, false)) return;
        this.metrics.chunksSent++;
        this.sent.set(key, want);
        sentChunks++;
        sentBytes += frame.byteLength;
        if (
          sentChunks >= MAX_CHUNKS_PER_TICK ||
          sentBytes >= MAX_BYTES_PER_TICK ||
          this.session.buffered > STREAM_PAUSE_BYTES
        ) {
          return;
        }
        continue;
      }
      const genKey = key * 4 + want;
      if (this.generating.has(genKey) || this.generating.size >= MAX_INFLIGHT_GENERATION) continue;
      this.generating.add(genKey);
      const priority = want === 0 ? ChunkPriority.Lod0 : want === 1 ? ChunkPriority.Lod1 : ChunkPriority.Lod2;
      this.world
        .getChunk(cx, cz, want, priority)
        .catch((err: unknown) => {
          if (!(err instanceof QueueFullError)) throw err;
        })
        .finally(() => {
          this.generating.delete(genKey);
          this.dirty = true;
        })
        .catch(() => undefined);
    }
    if (!outstanding) this.dirty = false;
  }
}
