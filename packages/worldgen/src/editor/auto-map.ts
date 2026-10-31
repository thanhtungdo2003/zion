import type { AssetRegistry } from '@zion/assets';
import { Surface, smoothstep } from '@zion/shared';
import { Simplex2 } from '../noise';
import { createMapDoc, newRegion, type Region, type WorldMapDoc } from './document';
import { FLORA_SPECIES, MAX_FLORA, type FloraItem } from './flora';
import { autoLootPoints, autoSpawnPoints } from './gameplay';
import { SpatialGrid, pointInPolygon, polygonCentroid, type Obb, type Vec2 } from './geometry';
import { Heightfield, seedNumber, stream } from './heightfield';
import { buildCatalog } from './settlement/catalog';
import { generateSettlement, type SettlementResult } from './settlement/generate';
import type { SettlementPresetId } from './settlement/presets';
import { defaultTerrainSettings, generateTerrain } from './terrain-gen';
import type { NewMapRequest } from './templates';
import { carveLake, carveRiver, lakeSpillLevel, type Lake, type River } from './water';

/** What the automatic map holds. Counts are upper bounds: sites need suitable ground. */
export interface AutoParams {
  cities: number;
  towns: number;
  villages: number;
  industrial: number;
  military: number;
  ports: number;
  lakes: number;
  rivers: number;
  /** 0..1: share of open land under forest. */
  forest: number;
  /** Join the settlements with roads. */
  roads: boolean;
}
export const DEFAULT_AUTO: AutoParams = { cities: 1, towns: 2, villages: 4, industrial: 1, military: 1, ports: 1, lakes: 2, rivers: 2, forest: .45, roads: true };

const SITE: Array<{ key: keyof AutoParams; preset: SettlementPresetId; radius: number; label: string }> = [
  { key: 'cities', preset: 'mixed-city', radius: 330, label: 'Thành phố' },
  { key: 'ports', preset: 'port', radius: 210, label: 'Cảng' },
  { key: 'towns', preset: 'vn-town', radius: 230, label: 'Thị trấn' },
  { key: 'industrial', preset: 'industrial-zone', radius: 190, label: 'Khu công nghiệp' },
  { key: 'military', preset: 'military-base', radius: 170, label: 'Căn cứ' },
  { key: 'villages', preset: 'small-village', radius: 120, label: 'Làng' },
];
const NAMES = ['Bắc', 'Nam', 'Đông', 'Tây', 'Hồng', 'Thạch', 'Vân', 'Phong', 'Lâm', 'Hải', 'Sơn', 'Minh', 'An', 'Bình', 'Kim', 'Ngọc'];

/**
 * A whole map from a few parameters, in the order a planner would: relief, rivers down the
 * valleys, lakes in the basins, settlements on the best ground (ports on the coast), roads
 * between them, forests on the open land, then the match setup. Yields progress 0..1.
 */
export function* autoMap(req: NewMapRequest, registry: AssetRegistry): Generator<number, { doc: WorldMapDoc; terrain: Heightfield }> {
  const p = { ...DEFAULT_AUTO, ...req.auto };
  const settings = { ...defaultTerrainSettings(req.preset, req.seed, req.size) };
  if (req.maxHeight !== undefined) settings.maxHeight = req.maxHeight;
  if (req.roughness !== undefined) settings.roughness = req.roughness;
  if (req.detail !== undefined) settings.detail = req.detail;
  settings.seaEdge = req.seaEdge ?? true;
  if (req.climate) settings.climate = req.climate;
  if (req.erosion !== undefined) settings.erosion = req.erosion;
  const hf = new Heightfield(settings.size, settings.cell), size = hf.size, sea = settings.seaLevel;
  for (const f of generateTerrain(settings, hf)) yield f * .2;
  const doc = createMapDoc({ name: req.name, kind: req.kind, description: req.description ?? 'Bản đồ sinh tự động.', template: 'auto', terrain: settings });
  const land = (x: number, z: number) => hf.heightAt(x, z) > sea + 1.5;

  /* Rivers: from high ground, downhill to the sea (cutting through small dips). */
  const rRng = stream(req.seed, 'auto-rivers');
  for (let k = 0; k < p.rivers; k++) {
    let best: Vec2 | null = null, bh = -Infinity;
    for (let t = 0; t < 60; t++) { const x = size * (.15 + rRng.next() * .7), z = size * (.15 + rRng.next() * .7), h = hf.heightAt(x, z); if (h > bh && h > sea + 30) { bh = h; best = [x, z]; } }
    if (!best) continue;
    const pts: Vec2[] = [best], step = Math.max(20, size / 160);
    let [x, z] = best, stuck = 0;
    for (let i = 0; i < 600; i++) {
      let nx = x, nz = z, nh = Infinity;
      for (let a = 0; a < 16; a++) {
        const ang = a / 16 * Math.PI * 2, cx = x + Math.cos(ang) * step, cz = z + Math.sin(ang) * step;
        // Keep flowing roughly forward, no doubling back.
        if (pts.length > 2) { const [px, pz] = pts[pts.length - 2]!; if (Math.hypot(cx - px, cz - pz) < step * 1.2) continue; }
        const h = hf.heightAt(cx, cz);
        if (h < nh) { nh = h; nx = cx; nz = cz; }
      }
      if (nh >= hf.heightAt(x, z) && ++stuck > 25) break;
      x = nx; z = nz; pts.push([x, z]);
      if (nh < sea - 1 || x < 4 || z < 4 || x > size - 4 || z > size - 4) break;
    }
    if (pts.length < 8) continue;
    const thin = pts.filter((_, i) => i % 2 === 0 || i === pts.length - 1);
    const river: River = { id: `river-${k}`, name: `Sông ${NAMES[k % NAMES.length]}`, depth: 2.5, points: thin.map(([px, pz], i) => ({ x: px, z: pz, width: Math.round(8 + 26 * i / thin.length) })) };
    river.levels = carveRiver(hf, river).levels;
    doc.water.rivers.push(river);
    yield .2 + .05 * (k + 1) / Math.max(1, p.rivers);
  }

  /* Lakes in gentle basins away from the rivers. */
  const lRng = stream(req.seed, 'auto-lakes');
  for (let k = 0, tries = 0; k < p.lakes && tries < 300; tries++) {
    const x = size * (.1 + lRng.next() * .8), z = size * (.1 + lRng.next() * .8), h = hf.heightAt(x, z);
    if (h < sea + 6 || h > sea + settings.maxHeight * .5 || hf.slopeAt(x, z) > .08) continue;
    const r = 50 + lRng.next() * 90, poly: Vec2[] = [];
    for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2, rr = r * (.75 + lRng.next() * .45); poly.push([x + Math.cos(a) * rr, z + Math.sin(a) * rr]); }
    if (poly.some(([px, pz]) => !land(px, pz)) || doc.water.lakes.some((l) => Math.hypot(l.polygon[0]![0] - x, l.polygon[0]![1] - z) < 400)) continue;
    const lake: Lake = { id: `lake-${k}`, name: `Hồ ${NAMES[(k + 5) % NAMES.length]}`, polygon: poly, level: 0, depth: 4 };
    lake.level = Math.round((lakeSpillLevel(hf, lake) - .4) * 10) / 10;
    if (lake.level <= sea + 1) continue;
    carveLake(hf, lake); doc.water.lakes.push(lake); k++;
  }
  yield .3;

  /* Settlement sites: flat dry ground, apart from each other; ports on the shore. */
  const sRng = stream(req.seed, 'auto-sites');
  const wetNear = (x: number, z: number, r: number) => { for (let a = 0; a < 8; a++) if (!land(x + Math.cos(a * .785) * r, z + Math.sin(a * .785) * r)) return true; return false; };
  const cand: Array<{ x: number; z: number; flat: number; shore: boolean }> = [];
  const gs = Math.max(48, size / 80);
  for (let z = gs; z < size - gs; z += gs) for (let x = gs; x < size - gs; x += gs) {
    if (!land(x, z)) continue;
    let slope = 0;
    for (const [ox, oz] of [[0, 0], [40, 0], [-40, 0], [0, 40], [0, -40]]) slope += hf.slopeAt(x + ox!, z + oz!);
    const h = hf.heightAt(x, z);
    cand.push({ x, z, flat: slope / 5 + Math.max(0, h - sea - settings.maxHeight * .5) / 200 + sRng.next() * .04, shore: wetNear(x, z, 90) && hf.heightAt(x, z) < sea + 25 });
  }
  const sites: Array<{ x: number; z: number; r: number; preset: SettlementPresetId; label: string }> = [];
  for (const kind of SITE) {
    const n = p[kind.key] as number;
    for (let k = 0; k < n; k++) {
      const pool = cand.filter((c) => (kind.preset === 'port' ? c.shore : !wetNear(c.x, c.z, kind.radius * .6))
        && c.x > kind.radius && c.z > kind.radius && c.x < size - kind.radius && c.z < size - kind.radius
        && sites.every((s) => Math.hypot(s.x - c.x, s.z - c.z) > (s.r + kind.radius) * 1.2));
      if (!pool.length) break;
      pool.sort((a, b) => a.flat - b.flat);
      const c = pool[Math.floor(sRng.next() * Math.min(4, pool.length))]!;
      sites.push({ x: c.x, z: c.z, r: kind.radius, preset: kind.preset, label: kind.label });
    }
  }
  yield .35;

  /* Settlements, one after another: each joins the roads of those before it. */
  // Whole house models (built-in and the Model Studio's), no brick / concrete kit buildings.
  const catalog = buildCatalog(registry, { noKits: true });
  const roadsSoFar: Array<{ points: Vec2[]; width: number }> = [], obstacles: Obb[] = [];
  for (let i = 0; i < sites.length; i++) {
    const site = sites[i]!, poly: Vec2[] = [];
    for (let v = 0; v < 9; v++) {
      const a = v / 9 * Math.PI * 2 + sRng.next() * .3, rr = site.r * (.75 + sRng.next() * .4);
      poly.push([Math.max(10, Math.min(size - 10, site.x + Math.cos(a) * rr)), Math.max(10, Math.min(size - 10, site.z + Math.sin(a) * rr))]);
    }
    const region: Region = newRegion(poly, site.preset, i, `${req.seed}-${i + 1}`);
    region.name = `${site.label} ${NAMES[(i * 7 + 3) % NAMES.length]} ${NAMES[(i * 3 + 11) % NAMES.length]}`;
    try {
      const gen = generateSettlement({ polygon: poly, seed: region.seed, settings: region.settings, terrain: hf, water: doc.water, seaLevel: sea, externalRoads: roadsSoFar, obstacles, catalog });
      let r: IteratorResult<unknown, SettlementResult>;
      while (!(r = gen.next()).done) { /* step */ }
      const { grading, ...result } = r.value;
      if (grading) hf.restore(grading);
      region.result = result;
      roadsSoFar.push(...result.roads.map((q) => ({ points: q.points, width: q.width })));
      obstacles.push(...result.buildings.map((b) => b.obb));
      doc.regions.push(region);
    } catch { /* ground unsuitable after all: leave the site empty */ }
    yield .35 + .35 * (i + 1) / Math.max(1, sites.length);
  }

  /* Roads between the settlements: a spanning tree routed over the ground, round the water. */
  if (p.roads && doc.regions.length > 1) {
    const centres = doc.regions.map((r) => polygonCentroid(r.polygon)), linked = [0], edges: Array<[number, number]> = [];
    while (linked.length < centres.length) {
      let best: [number, number, number] | null = null;
      for (const a of linked) for (let b = 0; b < centres.length; b++) if (!linked.includes(b)) {
        const d = Math.hypot(centres[a]![0] - centres[b]![0], centres[a]![1] - centres[b]![1]);
        if (!best || d < best[2]) best = [a, b, d];
      }
      linked.push(best![1]); edges.push([best![0], best![1]]);
    }
    for (const [a, b] of edges) {
      const route = routeOverGround(hf, sea, centres[a]!, centres[b]!);
      if (route) doc.base.roads.push({ points: route, width: 8, paved: true });
    }
  }
  yield .78;

  /* Vegetation where it would really grow: by climate, moisture (hollows, valleys, near water),
     altitude (tree line), slope and sun; sampled evenly over the whole map, then thinned
     uniformly to the budget so no part of the map is left bare. */
  const climate = settings.climate ?? 'temperate';
  const fRng = stream(req.seed, 'auto-forest'), mask = new Simplex2(seedNumber(req.seed, 'auto-forest-mask'));
  const roadPts = new SpatialGrid<{ x: number; z: number; r: number }>(32, (q) => q.r);
  for (const r of doc.base.roads) for (let i = 1; i < r.points.length; i++) { const [ax, az] = r.points[i - 1]!, [bx, bz] = r.points[i]!, n = Math.ceil(Math.hypot(bx - ax, bz - az) / 8); for (let k = 0; k <= n; k++) roadPts.insert({ x: ax + (bx - ax) * k / n, z: az + (bz - az) * k / n, r: r.width / 2 + 4 }); }
  const riverPts = new SpatialGrid<{ x: number; z: number; r: number }>(64, (q) => q.r);
  for (const r of doc.water.rivers) for (const q of r.points) riverPts.insert({ x: q.x, z: q.z, r: q.width / 2 + 120 });
  for (const l of doc.water.lakes) for (const q of l.polygon) riverPts.insert({ x: q[0], z: q[1], r: 100 });
  const cap = Math.floor(MAX_FLORA * .9), top = Math.max(30, hf.stats().max - sea);
  const FLORA_MIX: Record<string, { density: number; treeLine: number; wet: Array<[string, number]>; dry: Array<[string, number]>; high: Array<[string, number]>; coast: Array<[string, number]> }> = {
    temperate: { density: 1, treeLine: .78, wet: [['forest', 4], ['oak', 2], ['bigtree', 1], ['shrub', 3], ['grass', 2], ['reeds', .4]], dry: [['broadleaf', 2], ['bush', 2], ['grass', 4], ['meadow', 2], ['stone', .8]], high: [['pine', 4], ['smallpine', 2], ['conifer', 1], ['rock', 1.2], ['stone', 1], ['granite_blocks', 1.5]], coast: [['grass', 3], ['bush', 1.5], ['stone', 1], ['broadleaf', .6], ['limestone_blocks', .6]] },
    tropical: { density: 1.25, treeLine: .85, wet: [['palm', 3], ['broadleaf', 4], ['bush', 4], ['reeds', 1.5], ['bigtree', 1]], dry: [['broadleaf', 3], ['bush', 3], ['grass', 3], ['palm', 1]], high: [['forest', 3], ['broadleaf', 2], ['rock', 1], ['mossy_blocks', 1.2]], coast: [['palm', 4], ['bush', 2], ['grass', 2], ['limestone_blocks', .5]] },
    arid: { density: .35, treeLine: .7, wet: [['bush', 3], ['oak', 1], ['grass', 2], ['reeds', 1]], dry: [['bush', 2], ['dead', 1.2], ['stone', 3], ['rock', 1.5], ['grass', 1], ['sandstone_blocks', 2]], high: [['rock', 3], ['boulder', 1], ['stone', 2], ['conifer', .4], ['sandstone_blocks', 2.5], ['basalt_blocks', 1]], coast: [['stone', 2], ['bush', 1], ['dead', .5], ['sandstone_blocks', 1]] },
    desert: { density: .12, treeLine: .6, wet: [['palm', 2], ['bush', 2], ['reeds', 1]], dry: [['dead', 1], ['stone', 3], ['rock', 2], ['boulder', .6], ['bush', .6], ['sandstone_blocks', 3]], high: [['rock', 3], ['boulder', 2], ['stone', 2], ['sandstone_blocks', 3]], coast: [['stone', 2], ['dead', .4], ['sandstone_blocks', 1.5]] },
    snow: { density: .45, treeLine: .55, wet: [['conifer', 3], ['pine', 3], ['smallpine', 2]], dry: [['smallpine', 2], ['conifer', 1.5], ['stone', 2], ['dead', .6]], high: [['rock', 3], ['boulder', 1.5], ['stone', 2], ['snow_blocks', 3], ['basalt_blocks', 1]], coast: [['stone', 2], ['rock', 1], ['snow_blocks', 1]] },
  };
  const mix = FLORA_MIX[climate] ?? FLORA_MIX.temperate!;
  const pickFrom = (list: Array<[string, number]>) => { let r = fRng.next() * list.reduce((a, [, w]) => a + w, 0); for (const [id, w] of list) if ((r -= w) <= 0) return id; return list[0]![0]; };
  const pickSp = (id: string) => { const sp = FLORA_SPECIES.find((q) => q.id === id)!; return sp.assets[Math.floor(fRng.next() * sp.assets.length)]!; };
  const spacing = Math.max(7, Math.sqrt(size * size / (cap * 2.2)));
  const flora: FloraItem[] = [];
  let seen = 0;
  for (let z = spacing / 2; z < size; z += spacing) {
    for (let x = spacing / 2; x < size; x += spacing) {
      const px = x + (fRng.next() - .5) * spacing, pz = z + (fRng.next() - .5) * spacing, h = hf.heightAt(px, pz), rel = h - sea;
      if (rel < 1.5) continue;
      const alt = rel / top, slope = hf.slopeAt(px, pz);
      if (slope > .95) continue;
      // Moisture: hollows and valleys, near rivers and lakes; patches by noise.
      const around = (hf.heightAt(px + 30, pz) + hf.heightAt(px - 30, pz) + hf.heightAt(px, pz + 30) + hf.heightAt(px, pz - 30)) / 4;
      const hollow = Math.max(-1, Math.min(1, (around - h) / 6));
      const nearWater = riverPts.query(px, pz, 0).length ? 1 : 0;
      const patch = mask.noise(px * .0022, pz * .0022) * .65 + mask.noise(px * .009, pz * .009) * .35;
      const moisture = Math.max(0, Math.min(1, .45 + hollow * .3 + nearWater * .35 + patch * .35 - alt * .25 - slope * .3));
      const cover = p.forest * mix.density * (alt > mix.treeLine ? .25 : 1) * smoothstep(.15, .75, moisture + (p.forest - .5) * .4);
      if (fRng.next() > cover) continue;
      if (doc.regions.some((r) => pointInPolygon(px, pz, r.polygon)) || roadPts.query(px, pz, 0).length) continue;
      if (doc.water.lakes.some((l) => pointInPolygon(px, pz, l.polygon))) continue;
      const list = alt > mix.treeLine * .8 ? mix.high : rel < 8 ? mix.coast : moisture > .55 ? mix.wet : mix.dry;
      const item: FloraItem = [pickSp(pickFrom(list)), Math.round(px * 10) / 10, Math.round(pz * 10) / 10, Math.round(fRng.next() * 628) / 100, Math.round((.75 + fRng.next() * .55) * 100) / 100];
      // Uniform thinning to the budget (reservoir sampling): every region keeps its share.
      seen++;
      if (flora.length < cap) flora.push(item);
      else { const k = Math.floor(fRng.next() * seen); if (k < cap) flora[k] = item; }
      if (moisture > .6 && climate === 'temperate') { const k = hf.index(hf.clampI(Math.round(px / hf.cell)), hf.clampJ(Math.round(pz / hf.cell))); if (hf.surface[k] === Surface.Grass) hf.surface[k] = Surface.ForestFloor; }
    }
    if (Math.round(z / spacing) % 40 === 0) yield .78 + .14 * z / size;
  }
  doc.flora = flora;
  yield .92;

  /* Match setup: places of interest, danger, spawns and loot from what was built. */
  const br = doc.gameplay[0]!;
  br.name = 'Battle Royale — tự động';
  br.pois = doc.regions.map((r) => { const c = polygonCentroid(r.polygon); return { id: `poi-${r.id}`, name: r.name, kind: r.preset, x: Math.round(c[0]), z: Math.round(c[1]), radius: Math.round(Math.sqrt(r.result?.analysis.area ?? 10000) / 2) }; });
  br.hotspots = doc.regions.filter((r) => r.preset === 'military-base' || r.preset === 'small-city' || r.preset === 'mixed-city' || r.preset === 'port').map((r) => { const c = polygonCentroid(r.polygon); return { id: `hot-${r.id}`, name: r.name, x: Math.round(c[0]), z: Math.round(c[1]), radius: 200, danger: r.preset === 'military-base' ? 5 : 4 }; });
  const ctx = { terrain: hf, water: doc.water, seaLevel: sea };
  br.spawnPoints = autoSpawnPoints(br, ctx, req.seed, br.maxPlayers);
  br.loot.points = autoLootPoints(br, doc.regions.flatMap((r) => r.result?.buildings ?? []).map((b) => ({ x: b.obb.x, z: b.obb.z, cls: b.cls, door: b.door })), req.seed);
  doc.meta.description = `${doc.regions.length} khu vực, ${doc.water.rivers.length} sông, ${doc.water.lakes.length} hồ, ${flora.length} cây/đá.`;
  yield 1;
  return { doc, terrain: hf };
}

/** Cheapest way over the ground on a coarse grid: steep and wet cells cost much more. */
function routeOverGround(hf: Heightfield, sea: number, a: Vec2, b: Vec2): Vec2[] | null {
  const step = Math.max(24, hf.size / 160), n = Math.ceil(hf.size / step) + 1;
  const cell = (x: number, z: number) => Math.max(0, Math.min(n - 1, Math.round(z / step))) * n + Math.max(0, Math.min(n - 1, Math.round(x / step)));
  const start = cell(...a), goal = cell(...b);
  const cost = new Float64Array(n * n).fill(Infinity), from = new Int32Array(n * n).fill(-1), done = new Uint8Array(n * n);
  const heap: Array<[number, number]> = [[0, start]];
  const push = (pr: number, c: number) => { heap.push([pr, c]); let k = heap.length - 1; while (k > 0) { const up = (k - 1) >> 1; if (heap[up]![0] <= pr) break; [heap[k], heap[up]] = [heap[up]!, heap[k]!]; k = up; } };
  const pop = () => { const top = heap[0]!, last = heap.pop()!; if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = k * 2 + 1, r = l + 1; let m = k; if (l < heap.length && heap[l]![0] < heap[m]![0]) m = l; if (r < heap.length && heap[r]![0] < heap[m]![0]) m = r; if (m === k) break; [heap[k], heap[m]] = [heap[m]!, heap[k]!]; k = m; } } return top; };
  cost[start] = 0;
  const gx = goal % n, gz = (goal - gx) / n;
  while (heap.length) {
    const [, c] = pop();
    if (done[c]) continue;
    done[c] = 1;
    if (c === goal) break;
    const cx = c % n, cz = (c - cx) / n, hc = hf.heightAt(cx * step, cz * step);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
      const ix = cx + dx, iz = cz + dz;
      if (ix < 0 || iz < 0 || ix >= n || iz >= n) continue;
      const nc = iz * n + ix, h = hf.heightAt(ix * step, iz * step), run = Math.hypot(dx, dz) * step, grade = Math.abs(h - hc) / run;
      const g = cost[c]! + run * (1 + 300 * Math.max(0, grade - .06) ** 2) * (h < sea + 1 ? 40 : 1);
      if (g >= cost[nc]!) continue;
      cost[nc] = g; from[nc] = c;
      push(g + Math.hypot(gx - ix, gz - iz) * step, nc);
    }
  }
  if (from[goal] < 0) return null;
  const pts: Vec2[] = [];
  for (let c = goal; c >= 0; c = from[c]!) { const x = c % n; pts.push([x * step, (c - x) / n * step]); if (c === start) break; }
  pts.reverse();
  // Smooth the grid steps into curves.
  let line = pts.filter((_, i) => i % 2 === 0 || i === pts.length - 1);
  for (let pass = 0; pass < 2; pass++) {
    const next: Vec2[] = [line[0]!];
    for (let k = 0; k < line.length - 1; k++) { const [px, pz] = line[k]!, [qx, qz] = line[k + 1]!; next.push([px * .75 + qx * .25, pz * .75 + qz * .25], [px * .25 + qx * .75, pz * .25 + qz * .75]); }
    next.push(line[line.length - 1]!); line = next;
  }
  return line.length > 1 ? line : null;
}
