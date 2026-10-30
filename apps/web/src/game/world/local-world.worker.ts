/// <reference lib="webworker" />
import { createDefaultRegistry, type AssetDefinitionInput } from '@zion/assets';
import { WorldGenerator, type WorldConfig } from '@zion/worldgen';

/**
 * A fixed map's world generator on the player's machine: the same deterministic generator the
 * server runs, built once from the map's definition, turning chunk requests into chunk data.
 */
type Request = { init: { config: WorldConfig; extraAssets: AssetDefinitionInput[] } } | { id: number; cx: number; cz: number; lod: number };

let gen: WorldGenerator | null = null;
self.onmessage = (e: MessageEvent<Request>) => {
  const m = e.data;
  if ('init' in m) {
    try {
      const registry = createDefaultRegistry();
      for (const def of m.init.extraAssets) if (!registry.byNumericId(def.numericId)) registry.registerUploaded(def);
      gen = new WorldGenerator(m.init.config, registry);
      self.postMessage({ ready: true });
    } catch (err) { self.postMessage({ ready: false, error: (err as Error).message }); }
    return;
  }
  if (!gen) return;
  try {
    const data = gen.generateChunk(m.cx, m.cz, m.lod);
    self.postMessage({ id: m.id, data }, [data.heights.buffer, data.water.buffer, data.biome.buffer, data.surface.buffer, data.temperature.buffer, data.humidity.buffer] as ArrayBuffer[]);
  } catch (err) { self.postMessage({ id: m.id, error: (err as Error).message }); }
};
