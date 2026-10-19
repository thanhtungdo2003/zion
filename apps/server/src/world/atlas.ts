import { setImmediate } from 'node:timers/promises';
import { type AtlasFootprint, type AtlasTile, type WorldAtlas } from '@zion/shared';
import { allStructures, authoredWorld, CAMP_LAYOUT, makeColumnSample, type AuthoredWorld, type CampPart, type WorldGenerator } from '@zion/worldgen';
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

/**
 * Afternoon sun low in the west-south-west (elevation ~24°): the map's single light. Terrain is one
 * grey; only its relief shows, lit and shaded by this sun, with the long shadows ridges cast.
 */
const SUN_ELEVATION = 0.42;
/** Unit vector towards the sun: west (−X) and a little south (+Z), low in the sky. */
const SUN = (() => { const c = Math.cos(SUN_ELEVATION), a = .26; return { x: -Math.cos(a) * c, y: Math.sin(SUN_ELEVATION), z: Math.sin(a) * c }; })();
const GROUND = [170, 173, 165] as const, WATER = [126, 138, 150] as const;

async function terrainRgb(generator: WorldGenerator, x: number, z: number, size: number, pixels: number): Promise<string> {
  const step = size / pixels, margin = Math.min(48, pixels / 4) | 0, n = pixels + margin * 2;
  const heights = new Float32Array(n * n), wet = new Uint8Array(n * n), column = makeColumnSample();
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const sample = generator.sampleColumn(x + (i - margin + .5) * step, z + (j - margin + .5) * step, column);
      const water = Number.isFinite(sample.water) ? Math.max(sample.water, generator.seaLevel) : generator.seaLevel;
      heights[j * n + i] = Math.max(sample.height, water);
      wet[j * n + i] = sample.height < water - .05 ? 1 : 0;
    }
    await setImmediate();
  }
  // Relief exaggerated a little so small wrinkles in the ground read on the map.
  const relief = 1.1 / Math.sqrt(step), tanSun = Math.tan(SUN_ELEVATION), hl = Math.hypot(SUN.x, SUN.z), sx = SUN.x / hl, sz = SUN.z / hl;
  const rgb = Buffer.alloc(pixels * pixels * 3);
  for (let j = 0; j < pixels; j++) {
    for (let i = 0; i < pixels; i++) {
      const gi = i + margin, gj = j + margin, k = gj * n + gi, h = heights[k]!;
      const dx = (heights[k + 1]! - heights[k - 1]!) * .5 * relief, dz = (heights[k + n]! - heights[k - n]!) * .5 * relief;
      const len = Math.hypot(dx, 1, dz), lit = Math.max(0, (-dx * SUN.x + SUN.y - dz * SUN.z) / len);
      // Cast shadow: walk towards the sun; anything rising above the sun's line shades this spot.
      let shade = 1;
      for (let s = 1; s <= margin; s++) {
        const si = Math.round(gi + sx * s), sj = Math.round(gj + sz * s);
        if (si < 0 || sj < 0 || si >= n || sj >= n) break;
        if (heights[sj * n + si]! > h + s * step * tanSun + .3) { shade = .84; break; }
      }
      const f = Math.max(.6, Math.min(1.15, (.62 + .38 * lit / SUN.y) * shade));
      const base = wet[k] ? WATER : GROUND, o = (j * pixels + i) * 3;
      rgb[o] = Math.min(255, base[0] * f); rgb[o + 1] = Math.min(255, base[1] * f); rgb[o + 2] = Math.min(255, base[2] * f);
    }
    if (j % 32 === 31) await setImmediate();
  }
  return rgb.toString('base64');
}
