import { describe, expect, it } from 'vitest';
import { BATTLE_MAP, CHUNK_SIZE, LOD_COUNT, LOD_RINGS, type ChunkData } from '@zion/shared';
import { createDefaultRegistry } from '@zion/assets';
import { WorldGenerator, normalizeSeed } from '@zion/worldgen';
import { buildTerrainGeometry, buildWaterGeometry } from '../render/terrain';

/**
 * World streaming budget on the largest battlefield (the 4 km battle royale island, which
 * warfare plays too): what one client holds while a vehicle crosses it at speed, measured on
 * real generated chunks. Run with STREAMING_BENCH=1 (it builds the whole island's generator).
 * The numbers go to docs/world-streaming.md.
 */
const run = process.env.STREAMING_BENCH ? it : it.skip;
const MAX_RING = LOD_RINGS[LOD_COUNT - 1]!;
const lodFor = (d: number) => { for (let l = 0; l < LOD_COUNT; l++) if (d <= LOD_RINGS[l]!) return l; return -1; };

const dataBytes = (c: ChunkData) => c.heights.byteLength + c.water.byteLength + c.biome.byteLength + c.surface.byteLength + c.temperature.byteLength + c.humidity.byteLength + c.props.length * 40;
function meshBytes(c: ChunkData): number {
  let n = 0;
  for (const g of [buildTerrainGeometry(c, 20), buildWaterGeometry(c)]) {
    if (!g) continue;
    for (const a of Object.values(g.attributes)) n += a.array.byteLength;
    if (g.index) n += g.index.array.byteLength;
    g.dispose();
  }
  return n;
}

describe('world streaming budget (largest battlefield)', () => {
  run('measures what a client holds crossing the island at vehicle speed', () => {
    const gen = new WorldGenerator({ seed: normalizeSeed(BATTLE_MAP.seed), sizeChunks: BATTLE_MAP.sizeChunks, seaLevel: 20, mode: 'battle-royale' }, createDefaultRegistry());
    // 1. Real chunk sizes per LOD, sampled along the path.
    const size = BATTLE_MAP.sizeChunks, sample: Array<{ lod: number; data: number; mesh: number; props: number; ms: number }> = [];
    for (let i = 0; i < 24; i++) {
      const cx = Math.round(size * (.2 + .6 * i / 23)), cz = Math.round(size * (.25 + .5 * ((i * 7) % 24) / 23));
      for (let lod = 0; lod < LOD_COUNT; lod++) {
        const t0 = performance.now(), c = gen.generateChunk(cx, cz, lod), ms = performance.now() - t0;
        sample.push({ lod, data: dataBytes(c), mesh: meshBytes(c), props: c.props.length, ms });
      }
    }
    const avg = (lod: number, k: 'data' | 'mesh' | 'props' | 'ms') => { const s = sample.filter((x) => x.lod === lod); return s.reduce((a, x) => a + x[k], 0) / s.length; };
    // 2. A vehicle at 25 m/s across the island (corner to corner, 3 km): chunks held per LOD and
    // chunk deliveries, for a streamer that downgrades a chunk `down` chunks past its ring and
    // centres its rings `ahead` seconds along the travel (predictive preloading).
    const simulate = (down: number, ahead: number) => {
      const held = new Map<string, number>(), path = 3000, speed = 25, tick = 1 / 30;
      let peak = [0, 0, 0], peakBytes = 0, peakMesh = 0, arrivals = 0, lod0 = 0, maxPerSecond = 0, inSecond = 0, secondT = 0, late = 0;
      for (let t = 0; t * speed < path; t += tick) {
        const d = t * speed, x = size * CHUNK_SIZE * .18 + d * .7071, z = size * CHUNK_SIZE * .18 + d * .7071;
        const lead = Math.min(MAX_RING / 2, speed * ahead / CHUNK_SIZE) * .7071;
        const pcx = Math.floor(x / CHUNK_SIZE + lead), pcz = Math.floor(z / CHUNK_SIZE + lead);
        const ox = Math.floor(x / CHUNK_SIZE), oz = Math.floor(z / CHUNK_SIZE);
        for (const [k, lod] of held) {
          const [cx, cz] = k.split(',').map(Number) as [number, number], dist = Math.max(Math.abs(cx - pcx), Math.abs(cz - pcz));
          if (dist > MAX_RING + 2) held.delete(k);
          else if (lod < LOD_COUNT - 1 && dist > LOD_RINGS[lod]! + down) held.delete(k);
        }
        for (let dz = -MAX_RING; dz <= MAX_RING; dz++) for (let dx = -MAX_RING; dx <= MAX_RING; dx++) {
          const cx = pcx + dx, cz = pcz + dz, k = `${cx},${cz}`, want = lodFor(Math.max(Math.abs(dx), Math.abs(dz))), have = held.get(k);
          if (cx < 0 || cz < 0 || cx >= size || cz >= size || (have !== undefined && have <= want)) continue;
          held.set(k, want); arrivals++; inSecond++; if (want === 0) lod0++;
        }
        // The player's own chunk not yet at full detail (a gap under the wheels).
        if ((held.get(`${ox},${oz}`) ?? 9) > 0) late++;
        if (t - secondT >= 1) { maxPerSecond = Math.max(maxPerSecond, inSecond); inSecond = 0; secondT = t; }
        const counts = [0, 0, 0];
        for (const lod of held.values()) counts[lod]!++;
        const bytes = counts.reduce((a, n, lod) => a + n * avg(lod, 'data'), 0), mesh = counts.reduce((a, n, lod) => a + n * avg(lod, 'mesh'), 0);
        if (bytes > peakBytes) { peakBytes = bytes; peak = counts; }
        peakMesh = Math.max(peakMesh, mesh);
      }
      return { down, ahead, peak, peakBytes, peakMesh, arrivals, lod0, maxPerSecond, late };
    };
    const variants = [simulate(2, 0), simulate(5, 0), simulate(5, 1.5)];
    const { peak, peakBytes, peakMesh, arrivals, maxPerSecond: maxArrivalsPerSecond } = variants[0]!;
    const mb = (b: number) => +(b / 1048576).toFixed(1);
    const report = {
      perLod: [0, 1, 2].map((lod) => ({ lod, dataKB: +(avg(lod, 'data') / 1024).toFixed(1), meshKB: +(avg(lod, 'mesh') / 1024).toFixed(1), props: Math.round(avg(lod, 'props')), genMs: +avg(lod, 'ms').toFixed(1) })),
      peakChunks: { lod0: peak[0], lod1: peak[1], lod2: peak[2] },
      peakDataMB: mb(peakBytes), peakMeshMB: mb(peakMesh), arrivals, maxArrivalsPerSecond,
      variants: variants.map((v) => ({ down: v.down, ahead: v.ahead, arrivals: v.arrivals, lod0Generated: v.lod0, peakMeshMB: mb(v.peakMesh), lateTicks: v.late })),
      wholeMapLod2MB: mb(size * size * (avg(2, 'data') + avg(2, 'mesh'))), wholeMapLod0MB: mb(size * size * (avg(0, 'data') + avg(0, 'mesh'))),
    };
    console.log('STREAMING', JSON.stringify(report));
    // The held set stays bounded whatever the distance driven.
    expect(peak[0]! + peak[1]! + peak[2]!).toBeLessThanOrEqual((2 * (MAX_RING + 2) + 1) ** 2);
  }, 600_000);
});
