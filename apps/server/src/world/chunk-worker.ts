/**
 * Worker thread: owns a WorldGenerator (hydrology computed once per worker — deterministic, so
 * every worker holds an identical world) and turns chunk requests into decoded data + the
 * deflated wire body. Keeps CPU-heavy generation off the simulation thread.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { deflateRawSync } from 'node:zlib';
import { encodeChunkBody, type ChunkData } from '@zion/shared';
import { createDefaultRegistry, type AssetDefinitionInput } from '@zion/assets';
import { WorldGenerator, type WorldConfig } from '@zion/worldgen';

export interface WorkerRequest {
  id: number;
  cx: number;
  cz: number;
  lod: number;
}

export type WorkerResponse =
  | { id: number; ok: true; data: ChunkData; body: Uint8Array; ms: number }
  | { id: number; ok: false; error: string }
  | { id: -1; ok: true; ready: true };

if (!parentPort) throw new Error('chunk-worker must run as a worker thread');
const port = parentPort;
const data = workerData as { config: WorldConfig; extraAssets?: AssetDefinitionInput[] };
const registry = createDefaultRegistry();
for (const def of data.extraAssets ?? []) registry.registerUploaded(def);
const gen = new WorldGenerator(data.config, registry);
port.postMessage({ id: -1, ok: true, ready: true } satisfies WorkerResponse);

port.on('message', (req: WorkerRequest) => {
  const t0 = performance.now();
  try {
    const data = gen.generateChunk(req.cx, req.cz, req.lod);
    // Copy out of zlib's (possibly pooled) buffer so the ArrayBuffer can be transferred.
    const body = new Uint8Array(deflateRawSync(encodeChunkBody(data), { level: 6 }));
    const msg: WorkerResponse = { id: req.id, ok: true, data, body, ms: performance.now() - t0 };
    port.postMessage(msg, [
      body.buffer,
      data.heights.buffer,
      data.water.buffer,
      data.biome.buffer,
      data.surface.buffer,
      data.temperature.buffer,
      data.humidity.buffer,
    ] as ArrayBuffer[]);
  } catch (err) {
    port.postMessage({ id: req.id, ok: false, error: (err as Error).message } satisfies WorkerResponse);
  }
});
