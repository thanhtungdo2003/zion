import { setImmediate } from 'node:timers/promises';
import { BIOME_MAP_COLORS, Surface, type AtlasFootprint, type AtlasTile, type WorldAtlas } from '@zion/shared';
import { allStructures, authoredWorld, CAMP_LAYOUT, makeColumnSample, type AuthoredWorld, type CampPart, type ColumnSample, type WorldGenerator } from '@zion/worldgen';
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
  const authored = generator.config.mode === 'battle-royale' ? authoredWorld(generator) : null;
  // Survival (v7+): the roadside grid's cables, strung by the client.
  const grid = authored ? [] : generator.roads?.cables() ?? [];
  return { worldId, size, pixels, rgb, ...(authored ? battleOverlay(generator, authored) : {}), ...(grid.length ? { cables: grid.map(c => ({ kind: c.kind, points: c.points.map(([x, y, z]) => [+x.toFixed(2), +y.toFixed(2), +z.toFixed(2)] as [number, number, number]) })) } : {}), roads: generator.roads?.segments.map(s => ({ ax: s.a.x, az: s.a.z, bx: s.b.x, bz: s.b.z, width: s.halfWidth * 2, bridge: !!s.bridge, paved: !!s.paved, widthA: (s.widthA ?? s.halfWidth) * 2, widthB: (s.widthB ?? s.halfWidth) * 2 })), structures: [...allStructures(generator)].map(({ x, z, radius, kind, halfX, halfZ, yaw }) => ({ x, z, radius, kind, ...(halfX ? { halfX, halfZ, yaw } : {}) })) };
}

/** Named areas, power lines and building footprints of an authored map. */
function battleOverlay(generator: WorldGenerator, world: AuthoredWorld): Pick<WorldAtlas, 'areas' | 'power' | 'buildings' | 'cables'> {
  const buildings: AtlasFootprint[] = [];
  for (const site of world.structures()) {
    const c = Math.cos(site.yaw), s = Math.sin(site.yaw);
    for (const part of site.parts) {
      const asset = generator.registry.byNumericId(part.asset);
      if (!asset || asset.bounds.radius < 2.2 || asset.category !== 'structure' || part.y > 1) continue;
      const half = asset.bounds.radius * part.scale * .7;
      buildings.push({ x: +(site.x + part.x * c + part.z * s).toFixed(1), z: +(site.z - part.x * s + part.z * c).toFixed(1), halfX: +half.toFixed(1), halfZ: +half.toFixed(1), yaw: +(site.yaw + part.yaw).toFixed(3) });
    }
  }
  return {
    areas: world.areas(),
    power: world.map.power.map(line => ({ kind: line.kind, points: line.points.map(([x, z]) => [x, z] as [number, number]) })),
    buildings,
    cables: world.cables().map(c => ({ kind: c.kind, points: c.points.map(([x, y, z]) => [+x.toFixed(2), +y.toFixed(2), +z.toFixed(2)] as [number, number, number]) })),
  };
}

const SURFACE_COLORS: Partial<Record<Surface, number>> = {
  [Surface.Grass]: 0x60844a, [Surface.DryGrass]: 0x8f9058, [Surface.ForestFloor]: 0x3b5c33, [Surface.Sand]: 0xd6c896, [Surface.Dirt]: 0x80684a,
  [Surface.Gravel]: 0x8c887e, [Surface.Rock]: 0x76706a, [Surface.Seabed]: 0x3c5a6e, [Surface.Asphalt]: 0x484a4c, [Surface.MossyAsphalt]: 0x505a4c,
  [Surface.BrokenAsphalt]: 0x605e5a, [Surface.DirtRoad]: 0x96784f, [Surface.WheelTrack]: 0x8c7050, [Surface.RoadVerge]: 0x6e8250, [Surface.GravelRoad]: 0x928c80,
};
/** Map colours for an authored island: surfaces, darker woods, paler heights and shaded water. */
function authoredColor(generator: WorldGenerator, world: AuthoredWorld, sample: ColumnSample, x: number, z: number, slope: number): number {
  if (sample.height < generator.seaLevel) {
    const depth = Math.min(1, (generator.seaLevel - sample.height) / 30);
    return (Math.round(40 - depth * 25) << 16) | (Math.round(110 - depth * 50) << 8) | Math.round(150 - depth * 40);
  }
  const surface = generator.roads?.surface(sample, x, z) ?? world.surface(sample.height, slope, x, z, world.near(x, z, 0)[0]);
  const color = SURFACE_COLORS[surface] ?? 0x646464;
  const woods = world.near(x, z, 4).length ? 0 : world.forestDensity(x, z) * .35, lift = Math.min(1, (sample.height - generator.seaLevel) / 200) * .25;
  const channel = (v: number) => Math.round(Math.min(255, v * (1 - woods) + (255 - v * (1 - woods)) * lift));
  return (channel((color >> 16) & 255) << 16) | (channel((color >> 8) & 255) << 8) | channel(color & 255);
}

async function terrainRgb(generator: WorldGenerator, x: number, z: number, size: number, pixels: number): Promise<string> {
  const step = size / pixels;
  const rgb = Buffer.alloc(pixels * pixels * 3), column = makeColumnSample();
  const authored = generator.config.mode === 'battle-royale' ? authoredWorld(generator) : null;
  for (let j = 0; j < pixels; j++) {
    let previous = 0;
    for (let i = 0; i < pixels; i++) {
      const px = x + (i + 0.5) * step, pz = z + (j + 0.5) * step;
      const sample = generator.sampleColumn(px, pz, column);
      const color = authored ? authoredColor(generator, authored, sample, px, pz, i ? Math.abs(previous - sample.height) / step : 0) : BIOME_MAP_COLORS[generator.classifyBiome(sample, 0)];
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
