/**
 * Renders the World Studio's seeded terrain for several seeds side by side (hillshade, height
 * tint, rivers and lakes) and prints the numbers that tell a real landform from a noise field:
 * land share, relief, closed pits, how much of the land drains to the sea, rivers and lakes.
 *
 *   pnpm --filter @zion/worldgen exec tsx scripts/terrain-compare.ts --tag after --seeds a,b,c --size 4096
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { performance } from 'node:perf_hooks';
import { encodePngRgb } from '../src/png';
import { Heightfield, defaultTerrainSettings, emptyWater, generateTerrain, waterLevelAt, type WaterData } from '../src/editor';

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : def;
}
const tag = arg('tag', 'after'), seeds = arg('seeds', 'zion,hac-son,7741,delta,sunrise,ky-son').split(','), size = Number(arg('size', '4096'));
const preset = arg('preset', 'tectonic') as Parameters<typeof defaultTerrainSettings>[0];
const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../preview/terrain');
await mkdir(out, { recursive: true });

const W = 512, crop = arg('crop', '').split(',').map(Number); // crop: x0,z0,extent (m)
for (const seed of seeds) {
  const s = defaultTerrainSettings(preset, seed, size), hf = new Heightfield(s.size, s.cell), result = { water: emptyWater() as WaterData };
  const t0 = performance.now();
  for (const _ of (generateTerrain as (...a: unknown[]) => Generator<number>)(s, hf, result)) { /* run */ }
  const ms = performance.now() - t0, water = result.water, sea = s.seaLevel;
  // Stats on the full grid.
  let land = 0, pits = 0, max = -Infinity;
  const n = hf.cols;
  for (let j = 1; j < n - 1; j++) for (let i = 1; i < n - 1; i++) {
    const h = hf.heights[j * n + i]!;
    if (h <= sea) continue;
    land++; max = Math.max(max, h);
    let low = true;
    for (let dj = -1; dj <= 1 && low; dj++) for (let di = -1; di <= 1; di++) if ((di || dj) && hf.heights[(j + dj) * n + i + di]! <= h) { low = false; break; }
    if (low && waterLevelAt(hf, water, sea, i * hf.cell, j * hf.cell) === null) pits++;
  }
  const rgb = new Uint8Array(W * W * 3), [cx0, cz0, ext] = crop.length === 3 ? crop as [number, number, number] : [0, 0, s.size], mpp = ext / W;
  for (let py = 0; py < W; py++) for (let px = 0; px < W; px++) {
    const x = cx0 + (px + .5) * mpp, z = cz0 + (py + .5) * mpp, h = hf.heightAt(x, z);
    const dx = hf.heightAt(x + mpp, z) - hf.heightAt(x - mpp, z), dz = hf.heightAt(x, z + mpp) - hf.heightAt(x, z - mpp);
    // Light from the north-west.
    const nx = -dx / (2 * mpp), nz = -dz / (2 * mpp), shade = Math.max(.25, Math.min(1.3, .75 + (-nx * .6 - nz * .6) * 1.4 / Math.hypot(nx, nz, 1)));
    const w = waterLevelAt(hf, water, sea, x, z), k = (py * W + px) * 3;
    let c: [number, number, number];
    if (h < sea) { const d = Math.min(1, (sea - h) / 60); c = [40 - d * 20, 90 - d * 40, 140 - d * 40]; }
    else if (w !== null && w > h) c = [60, 120, 190];
    else {
      const t = Math.min(1, (h - sea) / Math.max(60, s.maxHeight));
      c = h - sea < 2.5 ? [200, 190, 150] : t < .35 ? [96 + t * 100, 140 - t * 40, 80] : t < .7 ? [140, 120 + (t - .35) * 40, 90] : [150 + (t - .7) * 300, 150 + (t - .7) * 300, 150 + (t - .7) * 300];
    }
    rgb[k] = Math.min(255, c[0] * shade); rgb[k + 1] = Math.min(255, c[1] * shade); rgb[k + 2] = Math.min(255, c[2] * shade);
  }
  await writeFile(path.join(out, `${tag}-${preset}-${seed}${crop.length === 3 ? '-crop' : ''}.png`), encodePngRgb(W, W, rgb, (d) => deflateSync(d)));
  console.log(`${tag} ${preset} ${seed}: ${ms.toFixed(0)} ms, land ${(land / (n - 2) ** 2 * 100).toFixed(1)} %, top ${(max - sea).toFixed(0)} m, dry pits ${pits}, rivers ${water.rivers.length}, lakes ${water.lakes.length}`);
}
