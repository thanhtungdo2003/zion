/**
 * Renders a top-down preview of a world (biomes + hillshade + water) and prints generation stats.
 *
 *   pnpm world:preview -- --seed zion-alpha --size 128 --mpp 8
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { performance } from 'node:perf_hooks';
import { BIOME_MAP_COLORS, BIOME_NAMES, Biome, type ChunkData } from '@zion/shared';
import { createDefaultRegistry } from '@zion/assets';
import { WorldGenerator, encodePngRgb, makeColumnSample, normalizeSeed } from '../src/index';

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : def;
}

const seedArg = arg('seed', 'zion-alpha');
const seed = normalizeSeed(seedArg);
const sizeChunks = Number(arg('size', '128'));
const mpp = Number(arg('mpp', '8'));

const t0 = performance.now();
const gen = new WorldGenerator({ seed, sizeChunks }, createDefaultRegistry());
const tInit = performance.now() - t0;

const W = Math.floor(gen.worldSize / mpp);
const rgb = new Uint8Array(W * W * 3);
const heights = new Float32Array(W * W);
const counts = new Map<Biome, number>();
const s = makeColumnSample();
const t1 = performance.now();
const biomes = new Uint8Array(W * W);
for (let py = 0; py < W; py++) {
  for (let px = 0; px < W; px++) {
    const x = (px + 0.5) * mpp;
    const z = (py + 0.5) * mpp;
    gen.sampleColumn(x, z, s);
    heights[py * W + px] = s.height;
    const slope = gen.slopeAt(x, z, s.height, 2);
    const b = gen.classifyBiome(s, slope);
    biomes[py * W + px] = b;
    counts.set(b, (counts.get(b) ?? 0) + 1);
  }
}
for (let py = 0; py < W; py++) {
  for (let px = 0; px < W; px++) {
    const k = py * W + px;
    const b = biomes[k]! as Biome;
    let c = BIOME_MAP_COLORS[b];
    let r = (c >> 16) & 255;
    let g = (c >> 8) & 255;
    let bl = c & 255;
    const h = heights[k]!;
    if (b === Biome.Ocean) {
      const depth = Math.min(1, (gen.seaLevel - h) / 60);
      r *= 1 - depth * 0.5;
      g *= 1 - depth * 0.4;
      bl *= 1 - depth * 0.2;
    } else {
      // Hillshade from the NW.
      const hl = heights[k - 1] ?? h;
      const hu = heights[k - W] ?? h;
      const shade = Math.max(0.55, Math.min(1.35, 1 + ((hl - h) + (hu - h)) * 0.06));
      r *= shade;
      g *= shade;
      bl *= shade;
    }
    c = 0;
    rgb[k * 3] = Math.max(0, Math.min(255, r));
    rgb[k * 3 + 1] = Math.max(0, Math.min(255, g));
    rgb[k * 3 + 2] = Math.max(0, Math.min(255, bl));
  }
}
const tMap = performance.now() - t1;

// Chunk generation benchmark + determinism check.
const t2 = performance.now();
let props = 0;
const mid = Math.floor(sizeChunks / 2);
let sample: ChunkData | null = null;
for (let i = 0; i < 16; i++) {
  sample = gen.generateChunk(mid + (i % 4), mid + Math.floor(i / 4), 0);
  props += sample.props.length;
}
const tChunk = (performance.now() - t2) / 16;
const spawns = gen.findSpawnPoints(16);

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, '../preview');
await mkdir(outDir, { recursive: true });
const file = path.join(outDir, `world-${seed}.png`);
await writeFile(file, encodePngRgb(W, W, rgb, (d) => deflateSync(d)));

const total = W * W;
console.log(`seed "${seedArg}" → ${seed}, ${gen.worldSize} m, sea ${gen.seaLevel} m`);
console.log(`init (hydrology) ${tInit.toFixed(0)} ms, map ${tMap.toFixed(0)} ms, LOD0 chunk avg ${tChunk.toFixed(2)} ms, ${(props / 16).toFixed(1)} props/chunk`);
console.log('hydrology', gen.hydrology.stats);
console.log(`spawn candidates: ${spawns.length}`);
for (const [b, n] of [...counts.entries()].sort((a, c) => c[1] - a[1])) {
  console.log(`  ${BIOME_NAMES[b].padEnd(14)} ${((n / total) * 100).toFixed(1)}%`);
}
console.log(`preview → ${file}`);
