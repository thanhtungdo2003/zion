/**
 * Map Studio: renders an authored battle royale map to a PNG for review — terrain shading,
 * surfaces, roads, district footprints, the power grid, vegetation density and area names.
 *
 *   pnpm --filter @zion/worldgen map:studio -- --mpp 4 --out tmp/island.png [--x 1800 --z 2500 --span 900]
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { BATTLE_MAP, Surface } from '@zion/shared';
import { createDefaultRegistry } from '@zion/assets';
import { WorldGenerator, encodePngRgb, makeColumnSample, normalizeSeed } from '../src/index';
import { authoredWorld } from '../src/maps/authored';

const arg = (name: string, def: string) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : def; };
const gen = new WorldGenerator({ seed: normalizeSeed(BATTLE_MAP.seed), sizeChunks: BATTLE_MAP.sizeChunks, seaLevel: 20, mode: 'battle-royale' }, createDefaultRegistry());
const world = authoredWorld(gen);
const span = Number(arg('span', String(gen.worldSize))), mpp = Number(arg('mpp', '4'));
const x0 = Number(arg('x', String(span / 2))) - span / 2, z0 = Number(arg('z', String(span / 2))) - span / 2;
const out = arg('out', 'tmp/map-studio.png');
const W = Math.floor(span / mpp);
const t0 = performance.now();
const heights = new Float32Array(W * W), rgb = new Uint8Array(W * W * 3), s = makeColumnSample();
const SURFACE: Partial<Record<Surface, [number, number, number]>> = {
  [Surface.Grass]: [96, 132, 70], [Surface.DryGrass]: [150, 150, 88], [Surface.ForestFloor]: [58, 92, 50], [Surface.Sand]: [214, 200, 150],
  [Surface.Dirt]: [128, 104, 74], [Surface.Gravel]: [140, 136, 126], [Surface.Rock]: [118, 112, 106], [Surface.Seabed]: [60, 90, 110],
  [Surface.Asphalt]: [72, 74, 76], [Surface.MossyAsphalt]: [80, 90, 76], [Surface.BrokenAsphalt]: [96, 94, 90], [Surface.DirtRoad]: [150, 120, 84],
  [Surface.WheelTrack]: [140, 112, 80], [Surface.RoadVerge]: [110, 130, 80], [Surface.GravelRoad]: [146, 140, 128],
};
for (let py = 0; py < W; py++) for (let px = 0; px < W; px++) {
  const x = x0 + (px + .5) * mpp, z = z0 + (py + .5) * mpp;
  gen.sampleColumn(x, z, s); heights[py * W + px] = s.height;
}
for (let py = 0; py < W; py++) for (let px = 0; px < W; px++) {
  const i = py * W + px, h = heights[i]!, x = x0 + (px + .5) * mpp, z = z0 + (py + .5) * mpp;
  const hx = heights[py * W + Math.min(W - 1, px + 1)]! - h, hz = heights[Math.min(W - 1, py + 1) * W + px]! - h;
  const slope = Math.hypot(hx, hz) / mpp;
  let c: [number, number, number];
  if (h < gen.seaLevel) { const depth = Math.min(1, (gen.seaLevel - h) / 30); c = [Math.round(40 - depth * 25), Math.round(110 - depth * 50), Math.round(150 - depth * 40)]; }
  else {
    gen.sampleColumn(x, z, s);
    const surface = gen.roads?.surface(s, x, z) ?? world.surface(h, slope, x, z, world.near(x, z, 0)[0]);
    c = [...(SURFACE[surface] ?? [100, 100, 100])] as [number, number, number];
    // Woods darken the ground; altitude lightens it.
    const woods = world.forestDensity(x, z), rel = Math.min(1, (h - gen.seaLevel) / 200);
    if (!world.near(x, z, 4).length && (s.roadDistance - (s.roadHalfWidth ?? 2.4)) > 4) c = c.map(v => v * (1 - woods * .35)) as typeof c;
    c = c.map(v => v + (255 - v) * rel * .25) as typeof c;
  }
  const shade = Math.max(.55, Math.min(1.25, 1 + (-hx + -hz) * .09));
  rgb[i * 3] = Math.min(255, c[0] * shade); rgb[i * 3 + 1] = Math.min(255, c[1] * shade); rgb[i * 3 + 2] = Math.min(255, c[2] * shade);
}
const t1 = performance.now();

// Vector overlay (SVG composited by sharp): districts, grid, contour of the coast, names.
const to = (x: number, z: number) => [((x - x0) / mpp).toFixed(1), ((z - z0) / mpp).toFixed(1)];
const svg: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${W}">`];
for (const site of world.structures()) {
  const c = Math.cos(site.yaw), sn = Math.sin(site.yaw);
  for (const p of site.parts) {
    const [x, y] = to(site.x + p.x * c + p.z * sn, site.z - p.x * sn + p.z * c);
    const def = gen.registry.byNumericId(p.asset), r = Math.max(.8, (def?.bounds.radius ?? 1) * p.scale / mpp * .75);
    const big = (def?.bounds.radius ?? 0) > 2.5;
    svg.push(`<rect x="${(Number(x) - r).toFixed(1)}" y="${(Number(y) - r).toFixed(1)}" width="${(r * 2).toFixed(1)}" height="${(r * 2).toFixed(1)}" fill="${big ? '#e8c890' : '#f6e6c0'}" stroke="${big ? '#5a4630' : 'none'}" stroke-width=".6" opacity="${big ? .95 : .7}" transform="rotate(${(-(site.yaw + p.yaw) * 180 / Math.PI).toFixed(1)} ${x} ${y})"/>`);
  }
  const [x, y] = to(site.x, site.z);
  if (site.halfX && site.halfZ) svg.push(`<rect x="${(Number(x) - site.halfX / mpp).toFixed(1)}" y="${(Number(y) - site.halfZ / mpp).toFixed(1)}" width="${(site.halfX * 2 / mpp).toFixed(1)}" height="${(site.halfZ * 2 / mpp).toFixed(1)}" fill="none" stroke="#ffb000" stroke-width="1" stroke-dasharray="3 3" opacity=".6" transform="rotate(${(-site.yaw * 180 / Math.PI).toFixed(1)} ${x} ${y})"/>`);
  else svg.push(`<circle cx="${x}" cy="${y}" r="${(site.radius / mpp).toFixed(1)}" fill="none" stroke="#ffb000" stroke-width="1" stroke-dasharray="3 3" opacity=".6"/>`);
}
for (const cable of world.cables()) {
  svg.push(`<polyline points="${cable.points.map(([x, , z]) => to(x, z).join(',')).join(' ')}" fill="none" stroke="${cable.kind === 'tower' ? '#ffe04a' : '#ffb070'}" stroke-width=".7" opacity=".9"/>`);
}
for (const p of world.pylons()) { const [x, y] = to(p.x, p.z); svg.push(`<circle cx="${x}" cy="${y}" r="${p.kind === 'tower' ? 2.4 : 1.5}" fill="#ffe04a" stroke="#000" stroke-width=".5"/>`); }
for (const area of world.areas()) {
  const [x, y] = to(area.x, area.z);
  svg.push(`<text x="${x}" y="${y}" font-family="Arial" font-size="${Math.max(11, 40 / mpp * 4 / 4)}" font-weight="700" fill="#fff" stroke="#000" stroke-width="3" paint-order="stroke" text-anchor="middle">${area.name}</text>`);
}
svg.push('</svg>');

const require = createRequire(path.resolve('apps/web/package.json'));
const sharp = require('sharp');
const base = encodePngRgb(W, W, rgb, (d) => deflateSync(d, { level: 6 }));
await mkdir(path.dirname(out), { recursive: true });
await writeFile(out, await sharp(Buffer.from(base)).composite([{ input: Buffer.from(svg.join('')) }]).png().toBuffer());

// Stats for review: chunk props in a sample of chunks.
let props = 0, chunks = 0;
const t2 = performance.now();
for (let cz = 20; cz < 112; cz += 12) for (let cx = 20; cx < 112; cx += 12) { props += gen.generateChunk(cx, cz, 0).props.length; chunks++; }
const t3 = performance.now();
console.log(`${out}: ${W}×${W} px @ ${mpp} m/px · raster ${(t1 - t0).toFixed(0)} ms · ${world.structures().length} sites · ${world.pylons().length} pylons · ${gen.roads?.segments.length} road segments`);
console.log(`chunk sample: ${chunks} chunks · ${(props / chunks).toFixed(0)} props avg · ${((t3 - t2) / chunks).toFixed(1)} ms/chunk`);
