import { LOD_COUNT, LOD_RINGS, chunkKey, chunkKeyX, chunkKeyZ, type ChunkData } from '@zion/shared';
import type { AssetDefinitionInput } from '@zion/assets';
import type { WorldConfig } from '@zion/worldgen';

/**
 * A fixed map (battle royale, infection, waves, warfare) on the player's machine. The server
 * sends the map's definition once (the whole map); from then on its chunks are generated here, in
 * a worker, by the same deterministic generator the server uses, and streamed into the chunk
 * store round the player: nearest first, finer near and coarser far, dropped when far out of
 * range. The server streams nothing more for the map.
 */
const MAX_RING = LOD_RINGS[LOD_COUNT - 1]!;
const UNLOAD_MARGIN = 2;
/** Chunks generated at once (one worker; a few in flight keep it busy). */
const IN_FLIGHT = 3;
const SPIRAL: ReadonlyArray<readonly [number, number, number]> = (() => {
  const out: Array<[number, number, number]> = [];
  for (let dz = -MAX_RING; dz <= MAX_RING; dz++) for (let dx = -MAX_RING; dx <= MAX_RING; dx++) out.push([dx, dz, Math.max(Math.abs(dx), Math.abs(dz))]);
  return out.sort((a, b) => a[2] - b[2] || a[0] * a[0] + a[1] * a[1] - (b[0] * b[0] + b[1] * b[1]));
})();
const lodFor = (d: number) => { for (let l = 0; l < LOD_COUNT; l++) if (d <= LOD_RINGS[l]!) return l; return -1; };

export interface LocalWorldSink {
  set(chunk: ChunkData): void;
  remove(cx: number, cz: number): void;
}

export class LocalWorld {
  private readonly worker: Worker;
  private ready = false;
  private failed: string | null = null;
  /** chunkKey → LOD held in the store. */
  private readonly held = new Map<number, number>();
  private readonly pending = new Map<number, { key: number; lod: number }>();
  private nextId = 1;
  private cx = Number.NaN;
  private cz = Number.NaN;
  private dirty = true;
  /** Generated so far (for the loading screen and the F3 panel). */
  generated = 0;
  genMs = 0;

  constructor(config: WorldConfig, extraAssets: AssetDefinitionInput[], private readonly size: number, private readonly sink: LocalWorldSink) {
    this.worker = new Worker(new URL('./local-world.worker.ts', import.meta.url), { type: 'module', name: 'zion-local-world' });
    this.worker.onmessage = (e: MessageEvent<{ ready?: boolean; error?: string; id?: number; data?: ChunkData }>) => {
      const m = e.data;
      if (m.ready !== undefined) { this.ready = m.ready; this.failed = m.ready ? null : m.error ?? 'generator failed'; this.dirty = true; return; }
      const job = m.id !== undefined ? this.pending.get(m.id) : undefined;
      if (!job) return;
      this.pending.delete(m.id!);
      this.dirty = true;
      if (!m.data) return;
      // Still wanted at that detail (the player may have moved on).
      const want = this.wanted(chunkKeyX(job.key), chunkKeyZ(job.key));
      if (want < 0 || want > job.lod) return;
      this.held.set(job.key, job.lod);
      this.generated++;
      this.sink.set(m.data);
    };
    this.worker.onerror = (e) => { this.failed = e.message || 'generator crashed'; };
    this.worker.postMessage({ init: { config, extraAssets } });
  }

  /** The generator is built and running (false while it starts, or when it failed). */
  get running(): boolean { return this.ready; }
  get error(): string | null { return this.failed; }

  private wanted(x: number, z: number): number {
    return lodFor(Math.max(Math.abs(x - this.cx), Math.abs(z - this.cz)));
  }

  /** The player's chunk: drops what fell out of range and asks for what is missing, nearest first. */
  update(cx: number, cz: number): void {
    if (cx !== this.cx || cz !== this.cz) {
      this.cx = cx; this.cz = cz; this.dirty = true;
      for (const [key, lod] of this.held) {
        const x = chunkKeyX(key), z = chunkKeyZ(key), d = Math.max(Math.abs(x - cx), Math.abs(z - cz));
        if (d > MAX_RING + UNLOAD_MARGIN) { this.held.delete(key); this.sink.remove(x, z); }
        // Too detailed for its distance now: replaced by the coarser one when it comes.
        else if (lod < LOD_COUNT - 1 && d > LOD_RINGS[lod]! + UNLOAD_MARGIN) this.held.set(key, LOD_COUNT);
      }
    }
    if (!this.ready || !this.dirty || this.pending.size >= IN_FLIGHT) return;
    let outstanding = false;
    for (const [dx, dz, d] of SPIRAL) {
      const x = cx + dx, z = cz + dz;
      if (x < 0 || z < 0 || x >= this.size || z >= this.size) continue;
      const want = lodFor(d), key = chunkKey(x, z), have = this.held.get(key);
      if (have !== undefined && have <= want) continue;
      outstanding = true;
      if ([...this.pending.values()].some((p) => p.key === key && p.lod <= want)) continue;
      const id = this.nextId++;
      this.pending.set(id, { key, lod: want });
      this.worker.postMessage({ id, cx: x, cz: z, lod: want });
      if (this.pending.size >= IN_FLIGHT) return;
    }
    if (!outstanding) this.dirty = false;
  }

  dispose(): void { this.worker.terminate(); this.held.clear(); this.pending.clear(); }
}
