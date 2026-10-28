import { createDefaultRegistry } from '@zion/assets';
import { Heightfield, SettlementError, buildCatalog, generateSettlement, generateTerrain, type Catalog, type TerrainSettings } from '@zion/worldgen/editor';
import { buildNewMap } from '@zion/worldgen/editor/templates';
import type { WorkerJob, WorkerReply } from './worker-protocol';
import { registerStudioModels } from '@/lib/studio-models';

/**
 * Heavy world-editor work off the main thread: new maps (the live island is sampled from the
 * game generator), terrain regeneration and settlement generation. Every job reports progress
 * and stops at the next step once cancelled.
 */
interface WorkerScope { postMessage(message: unknown, transfer: Transferable[]): void; onmessage: ((event: MessageEvent) => void) | null }
const scope = self as unknown as WorkerScope;
const registry = createDefaultRegistry();
// Houses and props published from the Model Studio join the settlement catalogue by lot class.
const studioModels = registerStudioModels(registry);
let catalog: Catalog | null = null;
const cancelled = new Set<number>();
const post = (m: WorkerReply, transfer: Transferable[] = []) => scope.postMessage(m, transfer);
// Lets queued messages (a cancel) in between steps.
const breathe = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

class Cancelled extends Error {}

async function drive<T, P>(id: number, gen: Generator<P, T>, report: (p: P) => void): Promise<T> {
  let last = 0;
  for (;;) {
    const r = gen.next();
    if (r.done) return r.value;
    const now = performance.now();
    if (now - last > 40) { report(r.value); last = now; await breathe(); }
    if (cancelled.has(id)) throw new Cancelled();
  }
}

async function handle(event: MessageEvent<{ id: number; job?: WorkerJob; cancel?: boolean }>): Promise<void> {
  const { id, job, cancel } = event.data;
  if (cancel) { cancelled.add(id); return; }
  if (!job) return;
  try {
    if (job.kind === 'new-map') {
      const { doc, terrain } = await drive(id, buildNewMap(job.req, registry), (p) => post({ id, progress: { label: job.req.template === 'hac-son' ? 'Lấy mẫu địa hình Đảo Hắc Sơn từ bộ sinh map' : 'Sinh địa hình', value: p } }));
      post({ id, done: { kind: 'map', doc, heights: terrain.heights.buffer as ArrayBuffer, surface: terrain.surface.buffer as ArrayBuffer } }, [terrain.heights.buffer as ArrayBuffer, terrain.surface.buffer as ArrayBuffer]);
    } else if (job.kind === 'terrain') {
      const s: TerrainSettings = job.settings, hf = new Heightfield(s.size, s.cell);
      await drive(id, generateTerrain(s, hf), (p) => post({ id, progress: { label: 'Sinh địa hình từ seed', value: p } }));
      post({ id, done: { kind: 'terrain', heights: hf.heights.buffer as ArrayBuffer, surface: hf.surface.buffer as ArrayBuffer } }, [hf.heights.buffer as ArrayBuffer, hf.surface.buffer as ArrayBuffer]);
    } else {
      await studioModels;
      catalog ??= buildCatalog(registry);
      const t = job.input.terrain, terrain = new Heightfield(t.size, t.cell, new Float32Array(t.heights), new Uint8Array(t.surface));
      const result = await drive(id, generateSettlement({ ...job.input, terrain, catalog }), (p) => post({ id, progress: { label: `${p.stage}/10 · ${p.label}`, value: (p.stage - 1 + p.progress) / 10 } }));
      post({ id, done: { kind: 'settlement', result } });
    }
  } catch (err) {
    if (err instanceof Cancelled) post({ id, error: 'cancelled' });
    else post({ id, error: err instanceof Error ? err.message : String(err), issues: err instanceof SettlementError ? err.issues : undefined });
  } finally {
    cancelled.delete(id);
  }
}
scope.onmessage = (event) => { void handle(event as MessageEvent<{ id: number; job?: WorkerJob; cancel?: boolean }>); };
