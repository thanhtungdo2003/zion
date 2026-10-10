import { setImmediate } from 'node:timers/promises';
import { BIOME_MAP_COLORS, type AtlasFootprint, type AtlasTile, type WorldAtlas } from '@zion/shared';
import { allStructures, CAMP_LAYOUT, makeColumnSample, type CampPart, type WorldGenerator } from '@zion/worldgen';
import { LruCache } from './lru';

/** Cache one coarse map per world; yield between rows so cartography never stalls simulation. */
export function atlasProvider(generator: WorldGenerator, worldId: string, layout?: () => readonly CampPart[]): () => Promise<WorldAtlas> {
  let pending: Promise<WorldAtlas> | undefined;
  let previous: readonly CampPart[] | undefined, result: Promise<WorldAtlas> | undefined;
  return () => {
    pending ??= generateAtlas(generator, worldId).catch((err: unknown) => { pending = undefined; result = undefined; throw err; });
    const parts = layout?.() ?? CAMP_LAYOUT;
    if (!result || previous !== parts) {
      previous = parts;
      result = pending.then((atlas) => ({ ...atlas, campParts: campFootprints(generator, parts) }));
    }
    return result;
  };
}

/** Same scale → yaw → translate convention as the game collision geometry. */
export function campFootprints(generator: WorldGenerator, parts: readonly CampPart[]): AtlasFootprint[] {
  const camp = generator.camp;
  if (!camp) return [];
  return parts.flatMap((part) => {
    const asset = generator.registry.byNumericId(part.asset);
    if (!asset) return [];
    const c = Math.cos(part.yaw), s = Math.sin(part.yaw);
    return asset.colliders.flatMap((box) => box.type !== 'box' ? [] : [{
      x: camp.x + part.x + (box.center[0] * c + box.center[2] * s) * part.scale,
      z: camp.z + part.z + (-box.center[0] * s + box.center[2] * c) * part.scale,
      halfX: box.halfExtents[0] * part.scale,
      halfZ: box.halfExtents[2] * part.scale,
      yaw: part.yaw + box.yaw,
    }]);
  });
}

/** 1 metre samples, bounded cache and a serial queue to keep simulation responsive. */
export function atlasTileProvider(generator: WorldGenerator, worldId: string): (x: number, z: number) => Promise<AtlasTile> {
  const cache = new LruCache<string, Promise<AtlasTile>>(96);
  let tail: Promise<unknown> = Promise.resolve();
  return (x, z) => {
    const count = Math.ceil(generator.worldSize / 256);
    if (!Number.isInteger(x) || !Number.isInteger(z) || x < 0 || z < 0 || x >= count || z >= count) return Promise.reject(new RangeError('Map tile outside world'));
    const key = `${x}:${z}`, existing = cache.get(key);
    if (existing) return existing;
    const pending = tail.then(async () => ({ worldId, x: x * 256, z: z * 256, size: 256, pixels: 256, rgb: await terrainRgb(generator, x * 256, z * 256, 256, 256) }))
      .catch((error: unknown) => { cache.delete(key); throw error; });
    tail = pending.catch(() => undefined);
    cache.set(key, pending);
    return pending;
  };
}

async function generateAtlas(generator: WorldGenerator, worldId: string): Promise<WorldAtlas> {
  const pixels = 256, size = generator.worldSize;
  const rgb = await terrainRgb(generator, 0, 0, size, pixels);
  return { worldId, size, pixels, rgb, structures: [...allStructures(generator)].map(({ x, z, radius, kind }) => ({ x, z, radius, kind })) };
}

async function terrainRgb(generator: WorldGenerator, x: number, z: number, size: number, pixels: number): Promise<string> {
  const step = size / pixels;
  const rgb = Buffer.alloc(pixels * pixels * 3), column = makeColumnSample();
  for (let j = 0; j < pixels; j++) {
    let previous = 0;
    for (let i = 0; i < pixels; i++) {
      const sample = generator.sampleColumn(x + (i + 0.5) * step, z + (j + 0.5) * step, column);
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
  return rgb.toString('base64');
}
