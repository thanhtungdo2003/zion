import { setImmediate } from 'node:timers/promises';
import { BIOME_MAP_COLORS, type WorldAtlas } from '@zion/shared';
import { allStructures, makeColumnSample, type WorldGenerator } from '@zion/worldgen';

/** Cache one coarse map per world; yield between rows so cartography never stalls simulation. */
export function atlasProvider(generator: WorldGenerator, worldId: string): () => Promise<WorldAtlas> {
  let pending: Promise<WorldAtlas> | undefined;
  return () => pending ??= generateAtlas(generator, worldId).catch((err: unknown) => { pending = undefined; throw err; });
}

async function generateAtlas(generator: WorldGenerator, worldId: string): Promise<WorldAtlas> {
  const pixels = 256, size = generator.worldSize, step = size / pixels;
  const rgb = Buffer.alloc(pixels * pixels * 3), column = makeColumnSample();
  for (let j = 0; j < pixels; j++) {
    let previous = 0;
    for (let i = 0; i < pixels; i++) {
      const sample = generator.sampleColumn((i + 0.5) * step, (j + 0.5) * step, column);
      const color = BIOME_MAP_COLORS[generator.classifyBiome(sample, 0)];
      const shade = i ? Math.max(0.7, Math.min(1.2, 1 + (previous - sample.height) * 0.035)) : 1;
      const k = (j * pixels + i) * 3;
      rgb[k] = Math.min(255, ((color >> 16) & 255) * shade);
      rgb[k + 1] = Math.min(255, ((color >> 8) & 255) * shade);
      rgb[k + 2] = Math.min(255, (color & 255) * shade);
      previous = sample.height;
    }
    await setImmediate();
  }
  return { worldId, size, pixels, rgb: rgb.toString('base64'), structures: [...allStructures(generator)].map(({ x, z, radius, kind }) => ({ x, z, radius, kind })) };
}
