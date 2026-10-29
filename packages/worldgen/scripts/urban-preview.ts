/**
 * Urban generation preview and benchmark: generates settlements with several seeds and patterns
 * on generated terrain, writes a top-down PNG of each (terrain, water, roads by class, lots by
 * district, buildings by condition) and prints timings and counts.
 *
 *   pnpm --filter @zion/worldgen exec tsx scripts/urban-preview.ts [outDir] [seeds] [presets]
 *   e.g. tsx scripts/urban-preview.ts preview/urban 3 vn-town,planned-city,mixed-city
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { createDefaultRegistry } from '@zion/assets';
import { Heightfield, buildCatalog, defaultTerrainSettings, generateSettlement, generateTerrain, presetSettings, type SettlementPresetId, type SettlementResult, type Vec2 } from '../src/editor';
import { encodePngRgb } from '../src/png';

const out = process.argv[2] ?? 'preview/urban';
const seeds = Number(process.argv[3] ?? 3);
const presets = (process.argv[4] ?? 'vn-town,planned-city,mixed-city,abandoned-city').split(',') as SettlementPresetId[];
mkdirSync(out, { recursive: true });
const run = <T>(g: Generator<unknown, T>): T => { for (;;) { const r = g.next(); if (r.done) return r.value; } };
const catalog = buildCatalog(createDefaultRegistry());

const SIZE = 1024, PX = 1024, SEA = 20;
function terrain(seed: string): Heightfield {
  const s = { ...defaultTerrainSettings('hills', seed, SIZE), maxHeight: 45, seaLevel: SEA, seaEdge: false };
  const hf = new Heightfield(s.size, s.cell);
  run(generateTerrain(s, hf));
  return hf;
}
/** An irregular region round the map centre. */
function region(seed: number, r: number): Vec2[] {
  const pts: Vec2[] = [];
  for (let i = 0; i < 14; i++) {
    const a = i / 14 * Math.PI * 2, k = r * (.78 + .22 * Math.sin(seed * 3.1 + i * 1.7));
    pts.push([SIZE / 2 + Math.cos(a) * k, SIZE / 2 + Math.sin(a) * k]);
  }
  return pts;
}

function render(hf: Heightfield, res: SettlementResult, polygon: Vec2[], file: string): void {
  const img = new Uint8Array(PX * PX * 3), k = SIZE / PX;
  const set = (x: number, z: number, c: readonly number[], a = 1) => {
    const i = Math.round(x / k), j = Math.round(z / k);
    if (i < 0 || j < 0 || i >= PX || j >= PX) return;
    const o = (j * PX + i) * 3;
    for (let q = 0; q < 3; q++) img[o + q] = img[o + q]! * (1 - a) + c[q]! * a;
  };
  for (let j = 0; j < PX; j++) for (let i = 0; i < PX; i++) {
    const x = i * k, z = j * k, h = hf.heightAt(x, z), sh = Math.max(.6, Math.min(1.25, 1 - (hf.heightAt(x + 2, z) - h) * .35 - (hf.heightAt(x, z + 2) - h) * .35));
    const c = h < SEA ? [40, 80, 110] : [95 + h, 118 + h * .6, 80];
    const o = (j * PX + i) * 3;
    img[o] = c[0]! * sh; img[o + 1] = c[1]! * sh; img[o + 2] = c[2]! * sh;
  }
  const line = (a: Vec2, b: Vec2, w: number, c: readonly number[], alpha = 1) => {
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.ceil(l / (k * .5));
    for (let s = 0; s <= n; s++) {
      const x = a[0] + (b[0] - a[0]) * s / n, z = a[1] + (b[1] - a[1]) * s / n;
      for (let u = -w / 2; u <= w / 2; u += k * .7) for (let v = -w / 2; v <= w / 2; v += k * .7) if (u * u + v * v <= w * w / 4) set(x + u, z + v, c, alpha);
    }
  };
  const fill = (poly: Vec2[], c: readonly number[], alpha: number) => {
    const xs = poly.map((p) => p[0]), zs = poly.map((p) => p[1]);
    for (let z = Math.min(...zs); z <= Math.max(...zs); z += k) for (let x = Math.min(...xs); x <= Math.max(...xs); x += k) {
      let inside = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, zi] = poly[i]!, [xj, zj] = poly[j]!;
        if (zi > z !== zj > z && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
      }
      if (inside) set(x, z, c, alpha);
    }
  };
  for (let i = 0; i < polygon.length; i++) line(polygon[i]!, polygon[(i + 1) % polygon.length]!, 1.5, [255, 255, 255], .6);
  const LOT: Record<string, number[]> = { residential: [235, 200, 120], commercial: [240, 110, 90], industrial: [160, 120, 200], military: [90, 120, 60], green: [80, 170, 80], empty: [160, 160, 140] };
  for (const l of res.lots) {
    fill(l.polygon, l.use && /school|clinic|market|temple|office/.test(l.use) ? [60, 180, 230] : LOT[l.cls]!, .45);
    for (let i = 0; i < l.polygon.length; i++) line(l.polygon[i]!, l.polygon[(i + 1) % l.polygon.length]!, .6, [60, 60, 60], .5);
  }
  const ROAD: Record<string, number[]> = { main: [250, 250, 250], secondary: [215, 215, 205], alley: [170, 160, 140], connector: [250, 220, 120] };
  for (const r of res.roads) for (let i = 1; i < r.points.length; i++) line(r.points[i - 1]!, r.points[i]!, r.width, ROAD[r.kind]!);
  for (const b of res.buildings) {
    const c = Math.cos(b.obb.yaw), s = Math.sin(b.obb.yaw);
    const corners = ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).map(([u, v]): Vec2 => [b.obb.x + u * b.obb.hx * c + v * b.obb.hz * s, b.obb.z - u * b.obb.hx * s + v * b.obb.hz * c]);
    fill(corners, b.condition === 'ruined' ? [70, 40, 30] : b.condition === 'abandoned' ? [130, 100, 80] : [45, 45, 55], .9);
  }
  for (const p of res.props) set(p.x, p.z, p.kind === 'tree' || p.kind === 'bush' ? [30, 110, 40] : p.kind === 'debris' ? [120, 60, 40] : [220, 220, 60], .9);
  writeFileSync(file, encodePngRgb(PX, PX, img, (d) => new Uint8Array(deflateSync(d))));
}

const rows: string[] = [];
for (let s = 0; s < seeds; s++) {
  const seed = `urban-${s + 1}`, hf = terrain(seed);
  for (const preset of presets) {
    const polygon = region(s + 1, preset === 'vn-town' ? 330 : 420);
    const settings = presetSettings(preset);
    const ext = [{ points: [[0, SIZE * .45], [SIZE * .2, SIZE * .48]] as Vec2[], width: 9 }];
    const t0 = performance.now();
    const res = run(generateSettlement({ polygon, seed, settings, terrain: hf, water: { lakes: [], rivers: [] }, seaLevel: SEA, externalRoads: ext, obstacles: [], catalog }));
    const ms = performance.now() - t0;
    const file = join(out, `${preset}-${seed}.png`);
    render(hf, res, polygon, file);
    const st = res.stats, errors = res.issues.filter((i) => i.severity === 'error').length;
    const { grading: _g, ...stored } = res, json = JSON.stringify(stored).length;
    rows.push(`${preset.padEnd(15)} ${seed.padEnd(8)} ${ms.toFixed(0).padStart(6)} ms  roads ${st.roadMain}/${st.roadSecondary}/${st.roadAlley} lots ${st.lots} bld ${st.buildings} props ${st.props} districts ${st.districts ?? 0} ruined ${st.c_ruined ?? 0} aband ${st.c_abandoned ?? 0} public ${['school', 'clinic', 'market', 'temple', 'office'].map((u) => st[`u_${u}`] ?? 0).join('/')} errors ${errors} json ${(json / 1024).toFixed(0)} KB`);
    console.log(rows[rows.length - 1]);
  }
}
writeFileSync(join(out, 'report.txt'), rows.join('\n') + '\n');
