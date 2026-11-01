/**
 * Builds automatic maps for a few seeds and checks them the way the game will load them: the
 * places and their names, the rivers and lakes, and the published map run through the game's
 * own generator (water where the Studio draws it, the names and coordinates of the places).
 *
 *   pnpm --filter @zion/worldgen exec tsx scripts/auto-map-check.ts --seeds zion,delta --size 4096
 */
import { performance } from 'node:perf_hooks';
import { createDefaultRegistry } from '@zion/assets';
import { WaterKind, WorldGenerator, authoredWorld, makeColumnSample, normalizeSeed } from '../src/index';
import { toBattleMap } from '../src/editor';
import { buildNewMap } from '../src/editor/templates';

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : def;
}
const registry = createDefaultRegistry(), size = Number(arg('size', '4096'));
for (const seed of arg('seeds', 'zion,delta').split(',')) {
  const t0 = performance.now(), gen = buildNewMap({ template: 'auto', name: `Thử ${seed}`, kind: 'battle-royale', size, seed, preset: 'tectonic' }, registry);
  let r = gen.next();
  while (!r.done) r = gen.next();
  const { doc, terrain } = r.value, ms = performance.now() - t0;
  console.log(`\n${seed}: ${(ms / 1000).toFixed(1)} s — ${doc.meta.description}`);
  for (const reg of doc.regions) { const c = reg.polygon.reduce((a, p) => [a[0] + p[0] / reg.polygon.length, a[1] + p[1] / reg.polygon.length], [0, 0]); console.log(`  ${reg.name.padEnd(36)} ${reg.preset.padEnd(18)} (${c[0].toFixed(0)}, ${c[1].toFixed(0)}) cao ${(terrain.heightAt(c[0], c[1]) - doc.terrain.seaLevel).toFixed(0)} m, ${reg.result?.buildings.length ?? 0} nhà`); }
  console.log('  sông:', doc.water.rivers.filter((q) => q.name.startsWith('Sông')).map((q) => q.name).join(', '));
  console.log('  hồ:', doc.water.lakes.map((q) => `${q.name} (${q.level.toFixed(1)} m)`).join(', '));
  const br = doc.gameplay[0]!;
  console.log('  POI:', br.pois.map((p) => p.name).join(' · '), '| xe:', br.vehicles);
  // As the game loads it.
  const map = toBattleMap(doc, terrain);
  const world = new WorldGenerator({ seed: normalizeSeed(`br-${seed}`), sizeChunks: size / 32, seaLevel: doc.terrain.seaLevel, mode: 'battle-royale', battleIsland: map }, registry);
  const col = makeColumnSample();
  let n = 0, wet = 0, built = 0, road = 0, raster = 0;
  const aw = authoredWorld(world);
  for (const rv of doc.water.rivers) for (let q = 1; q < rv.points.length - 1; q += 5) {
    const p = rv.points[q]!; world.sampleColumn(p.x, p.z, col); n++;
    if (col.water > col.height && (col.waterKind === WaterKind.River || col.waterKind === WaterKind.Lake)) { wet++; continue; }
    // Why dry: a settlement's levelled ground or a road's bed over it (both dry by design), or the water grid.
    if (Math.abs(aw.levelled(p.x, p.z) - aw.terrain(p.x, p.z)) > .05) built++;
    else if (col.roadDistance < (col.roadHalfWidth ?? 2.4) + 4) road++;
    else { raster++; if (process.argv.includes('--why')) console.log('   ', p.x, p.z, 'ground', terrain.heightAt(p.x, p.z).toFixed(2), 'level', rv.levels?.[q]?.toFixed(2), 'game', col.height.toFixed(2), col.water); }
  }
  console.log(`  khô: ${built} dưới nền khu dân cư, ${road} dưới đường, ${raster} khác`);
  const zonesOk = map.zones.every((z, i) => z.name === br.pois[i]!.name && Math.abs(z.x - br.pois[i]!.x) < 1 && Math.abs(z.z - br.pois[i]!.z) < 1);
  console.log(`  trong game: nước ở ${(wet / Math.max(1, n) * 100).toFixed(0)} % điểm dọc sông (${n}), tên/toạ độ POI khớp: ${zonesOk}, xe tối thiểu: ${map.vehicles}`);
}
