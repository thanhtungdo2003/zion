import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { deflateRaw, inflateRaw } from 'node:zlib';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { CHUNK_SIZE, PROPS_MAX_LOD, decodeChunkBody, encodeChunkBody, type ChunkData } from '@zion/shared';
import type { AssetRegistry, AssetDefinitionInput } from '@zion/assets';
import { CAMP_HALF_SIZE, CAMP_LAYOUT, campChunkProps, WorldGenerator, type CampPart, type WorldConfig } from '@zion/worldgen';
import type { Logger } from '../logger';
import type { WorkerRequest, WorkerResponse } from './chunk-worker';
import { LruCache } from './lru';

const deflateRawAsync = promisify(deflateRaw);
const inflateRawAsync = promisify(inflateRaw);

export interface ChunkRecord {
  cx: number;
  cz: number;
  lod: number;
  data: ChunkData;
  /** Deflated chunk body, ready to frame and send. */
  body: Uint8Array;
}

/** Lower number = more urgent. */
export enum ChunkPriority {
  Physics = 0,
  Lod0 = 1,
  Lod1 = 2,
  Lod2 = 3,
}

interface Job {
  id: number;
  cx: number;
  cz: number;
  lod: number;
  key: number;
  resolve: (r: ChunkRecord) => void;
  reject: (e: Error) => void;
}

const PRIORITY_LEVELS = 4;
const MAX_QUEUED = 20_000;

export class QueueFullError extends Error {
  constructor() {
    super('chunk generation queue is full');
    this.name = 'QueueFullError';
  }
}

function cacheKey(cx: number, cz: number, lod: number): number {
  return ((((cx & 0xffff) << 16) | (cz & 0xffff)) >>> 0) * 4 + lod;
}

interface WorkerSlot {
  worker: Worker;
  job: Job | null;
  ready: boolean;
}

/**
 * Owns world generation: an LRU cache of generated chunks, de-duplication of concurrent requests,
 * a priority queue (physics-critical chunks jump ahead of distant LOD2 terrain), and a pool of
 * worker threads. With WORLDGEN_WORKERS=0 jobs run inline, one per event-loop turn.
 */
export class WorldService {
  readonly generator: WorldGenerator;
  private readonly cache: LruCache<number, ChunkRecord>;
  private readonly inflight = new Map<number, Promise<ChunkRecord>>();
  private readonly queues: Job[][] = Array.from({ length: PRIORITY_LEVELS }, () => []);
  private queued = 0;
  private slots: WorkerSlot[] = [];
  private nextId = 1;
  private closed = false;
  private inlineScheduled = false;
  readonly stats = { generated: 0, cacheHits: 0, genMsTotal: 0, failures: 0, baked: 0 };
  /** Camp Studio layout replacing the generated camp props (null = default). */
  private campOverride: readonly CampPart[] | null = null;

  constructor(
    readonly config: WorldConfig,
    registry: AssetRegistry,
    private readonly workerCount: number,
    cacheSize: number,
    private readonly logger: Logger,
    /** Studio-uploaded assets this world uses (registered in its workers too). */
    readonly extraAssets: readonly AssetDefinitionInput[] = [],
  ) {
    const t0 = performance.now();
    for (const def of extraAssets) if (!registry.byNumericId(def.numericId)) registry.registerUploaded(def);
    this.generator = new WorldGenerator(config, registry);
    logger.info(
      { ms: Math.round(performance.now() - t0), seed: config.seed, size: this.generator.worldSize, ...this.generator.hydrology.stats },
      'world generator initialised',
    );
    this.cache = new LruCache(cacheSize);
  }

  async start(): Promise<void> {
    if (this.workerCount === 0) return;
    const ready: Array<Promise<void>> = [];
    for (let i = 0; i < this.workerCount; i++) ready.push(this.spawnWorker(i));
    await Promise.all(ready);
    this.logger.info({ workers: this.workerCount }, 'worldgen workers ready');
  }

  private workerEntry(): URL {
    const ts = new URL('./chunk-worker.ts', import.meta.url);
    if (import.meta.url.endsWith('.ts') && existsSync(fileURLToPath(ts))) return ts;
    return new URL('./chunk-worker.js', import.meta.url);
  }

  private spawnWorker(index: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const worker = new Worker(this.workerEntry(), {
        workerData: { config: this.config, extraAssets: this.extraAssets },
        name: `worldgen-${index}`,
        resourceLimits: { maxOldGenerationSizeMb: 512 },
      });
      const slot: WorkerSlot = { worker, job: null, ready: false };
      this.slots[index] = slot;
      worker.on('message', (msg: WorkerResponse) => {
        if ('ready' in msg) {
          slot.ready = true;
          resolve();
          this.pump();
          return;
        }
        const job = slot.job;
        slot.job = null;
        if (job && job.id === msg.id) {
          if (msg.ok) {
            this.stats.genMsTotal += msg.ms;
            this.complete(job, { cx: job.cx, cz: job.cz, lod: job.lod, data: msg.data, body: msg.body });
          } else {
            this.stats.failures++;
            job.reject(new Error(msg.error));
          }
        }
        this.pump();
      });
      worker.on('error', (err) => {
        this.logger.error({ err, worker: index }, 'worldgen worker crashed');
        if (!slot.ready) reject(err);
      });
      worker.on('exit', (code) => {
        const job = slot.job;
        slot.job = null;
        slot.ready = false;
        if (job) {
          this.stats.failures++;
          job.reject(new Error(`worker exited (${code}) during generation`));
        }
        if (!this.closed) {
          this.logger.warn({ worker: index, code }, 'restarting worldgen worker');
          setTimeout(() => void this.spawnWorker(index).catch(() => undefined), 1000).unref();
        }
      });
    });
  }

  private complete(job: Job, rec: ChunkRecord): void {
    this.stats.generated++;
    if (this.campOverride && this.touchesCamp(rec.cx, rec.cz) && rec.lod <= PROPS_MAX_LOD) {
      // Swap the generated camp props for the studio layout (re-encode this chunk only).
      void this.applyCamp(rec)
        .then((patched) => {
          this.cache.set(job.key, patched);
          job.resolve(patched);
        })
        .catch((err: unknown) => job.reject(err as Error));
      return;
    }
    this.cache.set(job.key, rec);
    this.writeBaked(rec);
    job.resolve(rec);
  }

  /** Chunks overlapping the camp square (with a margin for props on its edge). */
  campChunks(): Array<[number, number]> {
    const camp = this.generator.camp;
    if (!camp) return [];
    const m = CAMP_HALF_SIZE + 12;
    const out: Array<[number, number]> = [];
    for (let cz = Math.floor((camp.z - m) / CHUNK_SIZE); cz <= Math.floor((camp.z + m) / CHUNK_SIZE); cz++) {
      for (let cx = Math.floor((camp.x - m) / CHUNK_SIZE); cx <= Math.floor((camp.x + m) / CHUNK_SIZE); cx++) out.push([cx, cz]);
    }
    return out;
  }

  private touchesCamp(cx: number, cz: number): boolean {
    return this.campChunks().some(([x, z]) => x === cx && z === cz);
  }

  private async applyCamp(rec: ChunkRecord): Promise<ChunkRecord> {
    const camp = this.generator.camp!;
    const def = campChunkProps(camp, rec.cx, rec.cz, CAMP_LAYOUT);
    // Drop exactly the default camp parts (same quantised instances), keep everything else.
    const sig = (p: { asset: number; lx: number; lz: number; rot: number }) => `${p.asset}:${p.lx}:${p.lz}:${p.rot}`;
    const defaults = new Map<string, number>();
    for (const p of def) defaults.set(sig(p), (defaults.get(sig(p)) ?? 0) + 1);
    const kept = rec.data.props.filter((p) => {
      const n = defaults.get(sig(p)) ?? 0;
      if (n <= 0) return true;
      defaults.set(sig(p), n - 1);
      return false;
    });
    const data: ChunkData = { ...rec.data, props: [...kept, ...campChunkProps(camp, rec.cx, rec.cz, this.campOverride ?? CAMP_LAYOUT)] };
    const body = new Uint8Array(await deflateRawAsync(encodeChunkBody(data), { level: 6 }));
    return { ...rec, data, body };
  }

  /**
   * Installs (or clears) the Camp Studio layout and drops cached camp chunks so they regenerate.
   * Returns the affected chunk coordinates.
   */
  setCampLayout(parts: readonly CampPart[] | null): Array<[number, number]> {
    // Studio layouts carry exactly the groups set with the Group button.
    this.campOverride = parts;
    const chunks = this.campChunks();
    for (const [cx, cz] of chunks) for (let lod = 0; lod <= 3; lod++) this.cache.delete(cacheKey(cx, cz, lod));
    return chunks;
  }

  get campLayout(): readonly CampPart[] {
    return this.campOverride ?? CAMP_LAYOUT;
  }

  get campCustomised(): boolean {
    return this.campOverride !== null;
  }

  /** Returns a cached chunk without generating (refreshes recency). */
  peek(cx: number, cz: number, lod: number): ChunkRecord | undefined {
    return this.cache.get(cacheKey(cx, cz, lod));
  }

  getChunk(cx: number, cz: number, lod: number, priority: ChunkPriority): Promise<ChunkRecord> {
    if (!this.generator.inWorld(cx, cz)) return Promise.reject(new RangeError(`chunk ${cx},${cz} outside world`));
    const key = cacheKey(cx, cz, lod);
    const hit = this.cache.get(key);
    if (hit) {
      this.stats.cacheHits++;
      return Promise.resolve(hit);
    }
    const pending = this.inflight.get(key);
    if (pending) {
      if (priority < ChunkPriority.Lod0) this.promote(key, priority);
      return pending;
    }
    if (this.queued >= MAX_QUEUED) return Promise.reject(new QueueFullError());
    // A fixed map's chunk baked to disk earlier: read and inflate it (well under a millisecond)
    // instead of generating it again (a detailed chunk takes ~110 ms of a worker).
    if (this.bakeDir) {
      const baked = this.readBaked(cx, cz, lod, key).then((rec) => rec ?? this.enqueue(cx, cz, lod, key, priority)).finally(() => this.inflight.delete(key));
      this.inflight.set(key, baked);
      return baked;
    }
    return this.enqueue(cx, cz, lod, key, priority);
  }

  private enqueue(cx: number, cz: number, lod: number, key: number, priority: ChunkPriority): Promise<ChunkRecord> {
    const p = new Promise<ChunkRecord>((resolve, reject) => {
      const job: Job = { id: this.nextId++, cx, cz, lod, key, resolve, reject };
      this.queues[priority]!.push(job);
      this.queued++;
    }).finally(() => { if (!this.bakeDir) this.inflight.delete(key); });
    if (!this.bakeDir) this.inflight.set(key, p);
    this.pump();
    return p;
  }

  /* ------------------------------ baked chunks (fixed maps) ------------------------------ */

  /**
   * Fixed maps never change, so each chunk needs generating only once: with a bake directory,
   * generated chunks are written to disk (their deflated wire body), read back instead of being
   * generated again — across restarts too — and `bake()` fills the whole map in the background.
   * The directory is per world: the generator's configuration and version are its name.
   */
  private bakeDir: string | null = null;
  bakeTo(root: string): void {
    const id = createHash('sha1').update(JSON.stringify({ config: this.config, extra: this.extraAssets.map((a) => a.numericId) })).digest('hex').slice(0, 16);
    this.bakeDir = path.join(root, `${this.config.seed}-${id}`);
    void mkdir(this.bakeDir, { recursive: true }).catch((err: unknown) => { this.logger.error({ err }, 'chunk bake directory unavailable'); this.bakeDir = null; });
  }
  private bakedFile(cx: number, cz: number, lod: number): string { return path.join(this.bakeDir!, `${cx}_${cz}_${lod}.bin`); }
  private async readBaked(cx: number, cz: number, lod: number, key: number): Promise<ChunkRecord | null> {
    try {
      const body = new Uint8Array(await readFile(this.bakedFile(cx, cz, lod)));
      const data = decodeChunkBody(new Uint8Array(await inflateRawAsync(body)), cx, cz, lod);
      const rec: ChunkRecord = { cx, cz, lod, data, body };
      this.stats.baked++;
      this.cache.set(key, rec);
      return rec;
    } catch { return null; }
  }
  private writeBaked(rec: ChunkRecord): void {
    if (!this.bakeDir) return;
    void writeFile(this.bakedFile(rec.cx, rec.cz, rec.lod), rec.body).catch(() => undefined);
  }

  /**
   * Bakes the whole map, every LOD, in the background: one chunk at a time and only while no
   * one is waiting for generation, so it never competes with play. Done chunks are skipped.
   */
  async bake(): Promise<void> {
    if (!this.bakeDir) return;
    const size = this.config.sizeChunks;
    for (let lod = 2; lod >= 0 && !this.closed; lod--) for (let cz = 0; cz < size && !this.closed; cz++) for (let cx = 0; cx < size && !this.closed; cx++) {
      if (!this.generator.inWorld(cx, cz) || existsSync(this.bakedFile(cx, cz, lod))) continue;
      // Idle only: nothing queued, nothing being generated.
      while (!this.closed && (this.queued > 0 || this.slots.some((s) => s.job))) await new Promise((r) => setTimeout(r, 200));
      if (this.closed) return;
      try { await this.getChunk(cx, cz, lod, ChunkPriority.Lod2); } catch { /* queue full or outside: next */ }
    }
    this.logger.info({ dir: this.bakeDir }, 'world baked');
  }

  /** Moves a queued job to a more urgent priority class (e.g. a player walked into it). */
  private promote(key: number, priority: ChunkPriority): void {
    for (let level = priority + 1; level < PRIORITY_LEVELS; level++) {
      const q = this.queues[level]!;
      const i = q.findIndex((j) => j.key === key);
      if (i >= 0) {
        const [job] = q.splice(i, 1);
        this.queues[priority]!.push(job!);
        return;
      }
    }
  }

  private dequeue(): Job | null {
    for (const q of this.queues) {
      const job = q.shift();
      if (job) {
        this.queued--;
        return job;
      }
    }
    return null;
  }

  private pump(): void {
    if (this.closed) return;
    if (this.workerCount === 0) {
      if (!this.inlineScheduled && this.queued > 0) {
        this.inlineScheduled = true;
        setImmediate(() => void this.runInline());
      }
      return;
    }
    for (const slot of this.slots) {
      if (!slot || !slot.ready || slot.job) continue;
      const job = this.dequeue();
      if (!job) return;
      slot.job = job;
      slot.worker.postMessage({ id: job.id, cx: job.cx, cz: job.cz, lod: job.lod } satisfies WorkerRequest);
    }
  }

  private async runInline(): Promise<void> {
    this.inlineScheduled = false;
    const job = this.dequeue();
    if (!job) return;
    try {
      const t0 = performance.now();
      const data = this.generator.generateChunk(job.cx, job.cz, job.lod);
      const body = new Uint8Array(await deflateRawAsync(encodeChunkBody(data), { level: 6 }));
      this.stats.genMsTotal += performance.now() - t0;
      this.complete(job, { cx: job.cx, cz: job.cz, lod: job.lod, data, body });
    } catch (err) {
      this.stats.failures++;
      job.reject(err as Error);
    }
    this.pump();
  }

  get queueLength(): number {
    return this.queued;
  }

  get cacheSize(): number {
    return this.cache.size;
  }

  get readyWorkers(): number {
    return this.workerCount === 0 ? 0 : this.slots.filter((s) => s?.ready).length;
  }

  get healthy(): boolean {
    return this.workerCount === 0 || this.readyWorkers > 0;
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const q of this.queues) {
      for (const job of q.splice(0)) job.reject(new Error('world service closed'));
    }
    this.queued = 0;
    await Promise.all(this.slots.map((s) => s?.worker.terminate()));
  }
}
