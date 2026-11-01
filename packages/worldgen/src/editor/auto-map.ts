import type { AssetRegistry } from '@zion/assets';
import { CONDITION_DECAY, Surface, areaFor, kindOfArea, smoothstep, type BuildingCondition } from '@zion/shared';
import { Simplex2 } from '../noise';
import { createMapDoc, newRegion, type Region, type WorldMapDoc } from './document';
import { FLORA_SPECIES, MAX_FLORA, type FloraItem } from './flora';
import { autoLootPoints, autoSpawnPoints } from './gameplay';
import { SpatialGrid, pointInPolygon, polygonCentroid, type Obb, type Vec2 } from './geometry';
import { Heightfield, seedNumber, stream } from './heightfield';
import { buildCatalog } from './settlement/catalog';
import { generateSettlement, type SettlementResult } from './settlement/generate';
import { presetSettings, type SettlementPresetId } from './settlement/presets';
import { defaultTerrainSettings, generateTerrain } from './terrain-gen';
import type { NewMapRequest } from './templates';
import { carveRivers, rasterizeWater, type WaterData } from './water';

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
  /** Mines and quarries (at the foot of the ranges). */
  mines?: number;
  /** Join the settlements with roads. */
  roads: boolean;
  /** Battle royale: the fewest vehicles a match has. */
  vehicles?: number;
  /** The state of the whole map (its settlements take the Model Studio buildings made for it); 'mixed': each settlement its own. */
  condition?: BuildingCondition | 'mixed';
}
export const DEFAULT_AUTO: AutoParams = { cities: 1, towns: 2, villages: 4, industrial: 1, mines: 1, military: 1, ports: 1, lakes: 2, rivers: 3, forest: .45, roads: true, vehicles: 36 };

type SiteKind = 'city' | 'port' | 'town' | 'industrial' | 'mine' | 'military' | 'village';
const SITE: Array<{ kind: SiteKind; key: keyof AutoParams; preset: SettlementPresetId; radius: number; label: string }> = [
  { kind: 'city', key: 'cities', preset: 'mixed-city', radius: 330, label: 'Thành phố' },
  { kind: 'port', key: 'ports', preset: 'port', radius: 210, label: 'Cảng' },
  { kind: 'town', key: 'towns', preset: 'vn-town', radius: 230, label: 'Thị trấn' },
  { kind: 'industrial', key: 'industrial', preset: 'industrial-zone', radius: 190, label: 'Khu công nghiệp' },
  { kind: 'mine', key: 'mines', preset: 'industrial-zone', radius: 150, label: 'Mỏ' },
  { kind: 'military', key: 'military', preset: 'military-base', radius: 170, label: 'Căn cứ' },
  { kind: 'village', key: 'villages', preset: 'small-village', radius: 120, label: 'Làng' },
];

/**
 * Place names from the ground they stand on: a settlement by a river is a "Bến…", on a bay a
 * "Vịnh…", under the mountains a "Đèo…" or "Chân Núi…"; the second word describes the place
 * (stone, pines, wind, sand…) and repeats are avoided. Rivers, lakes and peaks are named the
 * same way after what is around them.
 */
const PLACE_WORDS: Record<string, string[]> = {
  river: ['Bến', 'Ngã Ba Sông', 'Bãi Bồi', 'Cầu', 'Đò'],
  lake: ['Hồ', 'Đầm', 'Bờ Hồ'],
  bay: ['Vịnh', 'Cửa Vịnh', 'Lạch'],
  coast: ['Bãi', 'Mũi', 'Ghềnh', 'Cửa Biển'],
  mountain: ['Đèo', 'Chân Núi', 'Lũng', 'Sườn'],
  high: ['Cao Nguyên', 'Đồi', 'Đỉnh Gió'],
  plain: ['Đồng', 'Cánh Đồng', 'Bình Nguyên'],
  forest: ['Rừng', 'Lâm Trường'],
};
const PLACE_TRAITS: Record<string, string[]> = {
  river: ['Phù Sa', 'Nước Bạc', 'Lau Sậy', 'Đá Cuội', 'Trúc'],
  lake: ['Sen', 'Gương', 'Mây', 'Lặng', 'Ngọc'],
  bay: ['Sóng Lặng', 'Thuyền', 'Hải Âu', 'Cát Trắng', 'San Hô'],
  coast: ['Cát', 'Gió', 'Hải Đăng', 'Đá Đen', 'Phi Lao'],
  mountain: ['Đá', 'Thông', 'Mây Trắng', 'Sấm', 'Đại Sơn', 'Kim Sơn'],
  high: ['Gió', 'Sương', 'Thông Reo', 'Chè'],
  plain: ['Lúa', 'An', 'Bình Yên', 'Hòa', 'Thịnh'],
  forest: ['Thông', 'Tràm', 'Lim', 'Xanh'],
};
const SIDE = (x: number, z: number, size: number) => {
  const dx = x / size - .5, dz = z / size - .5;
  if (Math.hypot(dx, dz) < .12) return 'Trung';
  return Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 'Đông' : 'Tây') : (dz > 0 ? 'Nam' : 'Bắc');
};

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
  // Relief, erosion and the drainage in one: the rivers and lakes are the terrain's own.
  const hydro: { water?: WaterData; lakes?: number; rivers?: number } = { lakes: p.lakes, rivers: p.rivers };
  for (const f of generateTerrain(settings, hf, hydro)) yield f * .3;
  const doc = createMapDoc({ name: req.name, kind: req.kind, description: req.description ?? 'Bản đồ sinh tự động.', template: 'auto', terrain: settings });
  doc.water = hydro.water ?? { lakes: [], rivers: [] };
  const land = (x: number, z: number) => hf.heightAt(x, z) > sea + 1.5;
  const wetNear = (x: number, z: number, r: number) => { for (let a = 0; a < 8; a++) if (!land(x + Math.cos(a * .785) * r, z + Math.sin(a * .785) * r)) return true; return false; };

  /* What the ground is like, on a coarse grid: distance to the sea, to rivers and lakes, how
     flat it is near and wide, the relief around (mountains), how enclosed the sea is (bays). */
  const gs = Math.max(48, size / 80), gn = Math.floor(size / gs) + 1;
  const wet = rasterizeWater(hf, doc.water);
  const seaMask = new Uint8Array(gn * gn), riverMask = new Uint8Array(gn * gn), lakeMask = new Uint8Array(gn * gn);
  for (let j = 0; j < gn; j++) for (let i = 0; i < gn; i++) {
    const x = Math.min(size, i * gs), z = Math.min(size, j * gs), r = hf.rectAround(x, z, gs * .5);
    if (hf.heightAt(x, z) < sea) seaMask[j * gn + i] = 1;
    for (let jj = r.j0; jj <= r.j1; jj += 2) for (let ii = r.i0; ii <= r.i1; ii += 2) {
      const k = jj * hf.cols + ii;
      if (wet.level[k]! > hf.heights[k]!) { if (wet.lake[k]) lakeMask[j * gn + i] = 1; else riverMask[j * gn + i] = 1; }
    }
  }
  const toSea = gridDistance(gn, seaMask, gs), toRiver = gridDistance(gn, riverMask, gs), toLake = gridDistance(gn, lakeMask, gs);
  const at = (d: Float32Array, x: number, z: number) => d[Math.max(0, Math.min(gn - 1, Math.round(z / gs))) * gn + Math.max(0, Math.min(gn - 1, Math.round(x / gs)))]!;
  const top = Math.max(30, hf.stats().max - sea);
  const sRng = stream(req.seed, 'auto-sites');
  interface Cand { x: number; z: number; h: number; flat: number; wide: number; relief: number; sea: number; river: number; lake: number; bay: number }
  const cand: Cand[] = [];
  for (let z = gs; z < size - gs; z += gs) for (let x = gs; x < size - gs; x += gs) {
    if (!land(x, z)) continue;
    let flat = 0, wide = 0, hi = -Infinity, seaRing = 0;
    for (const [ox, oz] of [[0, 0], [40, 0], [-40, 0], [0, 40], [0, -40]] as const) flat += hf.slopeAt(x + ox, z + oz);
    for (let a = 0; a < 12; a++) {
      const c = Math.cos(a * Math.PI / 6), sn = Math.sin(a * Math.PI / 6);
      wide += hf.slopeAt(x + c * 140, z + sn * 140);
      hi = Math.max(hi, hf.heightAt(x + c * 450, z + sn * 450), hf.heightAt(x + c * 900, z + sn * 900));
      if (hf.heightAt(x + c * 350, z + sn * 350) < sea) seaRing++;
    }
    const h = hf.heightAt(x, z);
    cand.push({ x, z, h, flat: flat / 5, wide: wide / 12, relief: Math.max(0, hi - h), sea: at(toSea, x, z), river: at(toRiver, x, z), lake: at(toLake, x, z), bay: seaRing / 12 });
  }
  // Lower is better: each kind of place where it really would be.
  const score: Record<SiteKind, (c: Cand) => number> = {
    // Cities on wide, low, flat ground with room to grow, by a river or the coast.
    city: (c) => c.flat * 5 + c.wide * 4 + Math.max(0, c.h - sea - top * .25) / 40 - (c.river < 500 ? .35 : 0) - (c.sea < 900 ? .2 : 0),
    // Ports in sheltered bays and coves (sea on part of the horizon only), on the shore.
    port: (c) => (c.sea > 160 || c.h > sea + 25 ? 99 : 0) + c.flat * 3 + Math.abs(c.bay - .4) * 2.5 - (c.river < 400 ? .25 : 0),
    town: (c) => c.flat * 4 + c.wide * 2 + Math.max(0, c.h - sea - top * .35) / 50 - (c.river < 400 ? .3 : 0) - (c.lake < 500 ? .15 : 0),
    // Industry by water (transport, cooling) and not far from the towns.
    industrial: (c) => c.flat * 4 + c.wide * 2 + Math.min(c.river, c.sea) / 1500 + Math.max(0, c.h - sea - top * .3) / 50,
    // Mines and quarries where the mountains rise: the ore and stone are there.
    mine: (c) => (c.relief < top * .25 ? 99 : 0) + c.flat * 3 - c.relief / top + Math.max(0, c.h - sea - top * .6) / 30,
    // Bases on commanding ground: raised, flat enough, away from the rest.
    military: (c) => c.flat * 4 + (c.h - sea < top * .12 ? 1 : 0) - Math.min(c.h - sea, top * .45) / top - (c.bay > .55 ? .3 : 0),
    // Villages in the valleys and by the water, farming the flats.
    village: (c) => c.flat * 3 + Math.min(c.river, c.lake, c.sea * 1.5) / 1200 + Math.max(0, c.h - sea - top * .5) / 60,
  };
  const sites: Array<{ x: number; z: number; r: number; kind: SiteKind; preset: SettlementPresetId; label: string; c: Cand }> = [];
  for (const kind of SITE) {
    const n = (p[kind.key] as number | undefined) ?? 0;
    for (let k = 0; k < n; k++) {
      const pool = cand.filter((c) => (kind.kind === 'port' || !wetNear(c.x, c.z, kind.radius * .6))
        && c.x > kind.radius && c.z > kind.radius && c.x < size - kind.radius && c.z < size - kind.radius
        // Room between places: no two settlements crammed together.
        && sites.every((s) => Math.hypot(s.x - c.x, s.z - c.z) > (s.r + kind.radius) * 1.35 + 120)
        && (kind.kind !== 'military' || sites.every((s) => s.kind === 'military' || Math.hypot(s.x - c.x, s.z - c.z) > 800))
        && (kind.kind !== 'industrial' || !sites.some((s) => s.kind === 'city' || s.kind === 'town' || s.kind === 'port') || sites.some((s) => (s.kind === 'city' || s.kind === 'town' || s.kind === 'port') && Math.hypot(s.x - c.x, s.z - c.z) < 1600)));
      const rated = pool.map((c) => ({ c, v: score[kind.kind](c) + sRng.next() * .08 })).filter((q) => q.v < 50).sort((a, b) => a.v - b.v);
      if (!rated.length) break;
      const c = rated[Math.floor(sRng.next() * Math.min(3, rated.length))]!.c;
      sites.push({ x: c.x, z: c.z, r: kind.radius, kind: kind.kind, preset: kind.preset, label: kind.label, c });
    }
  }
  // Names from the place: its setting (river, bay, coast, mountain, plateau, plain, forest) and
  // a trait of it, never twice the same.
  const nRng = stream(req.seed, 'auto-names'), used = new Set<string>();
  const nameFrom = (setting: string, x: number, z: number) => {
    const words = PLACE_WORDS[setting]!, traits = PLACE_TRAITS[setting]!;
    for (let t = 0; t < 40; t++) {
      const name = `${words[Math.floor(nRng.next() * words.length)]!} ${traits[Math.floor(nRng.next() * traits.length)]!}${t > 12 ? ` ${SIDE(x, z, size)}` : ''}`;
      if (!used.has(name)) { used.add(name); return name; }
    }
    return `${words[0]!} ${SIDE(x, z, size)} ${used.size}`;
  };
  const settingOf = (c: Cand, kind: SiteKind) =>
    kind === 'port' ? (c.bay > .25 && c.bay < .6 ? 'bay' : 'coast')
      : kind === 'mine' ? 'mountain'
        : c.river < 250 ? 'river' : c.lake < 300 ? 'lake' : c.sea < 250 ? (c.bay > .25 && c.bay < .6 ? 'bay' : 'coast')
          : c.relief > top * .35 ? 'mountain' : c.h - sea > top * .3 ? 'high' : c.flat < .06 ? 'plain' : 'forest';
  const siteNames = sites.map((s) => nameFrom(settingOf(s.c, s.kind), s.x, s.z));
  // Rivers: after the place they pass (a trunk "Sông …", a tributary "Suối …"); lakes after their own setting.
  doc.water.rivers.forEach((r, i) => {
    const src = r.points[0]!, mouth = r.points[r.points.length - 1]!, trunk = r.name.startsWith('Sông');
    let near = -1, nd = Infinity;
    sites.forEach((s, k) => { for (let q = 0; q < r.points.length; q += 4) { const d = Math.hypot(r.points[q]!.x - s.x, r.points[q]!.z - s.z); if (d < nd && d < s.r + 300) { nd = d; near = k; } } });
    const base = near >= 0 ? siteNames[near]!.split(' ').slice(-1)[0]! : PLACE_TRAITS.river![i % PLACE_TRAITS.river!.length]!;
    r.name = `${trunk ? 'Sông' : 'Suối'} ${base}${trunk ? '' : ` ${SIDE(src.x, src.z, size)}`}`;
    if (doc.water.rivers.slice(0, i).some((q) => q.name === r.name)) r.name = `${r.name} ${SIDE(mouth.x, mouth.z, size)}`;
  });
  doc.water.lakes.forEach((l) => { const [cx, cz] = polygonCentroid(l.polygon); l.name = nameFrom('lake', cx, cz); });
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
    // The map's condition: an abandoned or ruined map lays its towns out run-down and takes the
    // buildings published for that condition (mixed: mostly intact, some abandoned, a few ruined).
    const want = p.condition ?? 'intact';
    const roll = sRng.next();
    const condition: BuildingCondition = want === 'mixed' ? (roll < .5 ? 'intact' : roll < .82 ? 'abandoned' : 'ruined') : want;
    const kind = kindOfArea(site.preset), preset = areaFor(kind, condition, site.preset) as SettlementPresetId;
    const region: Region = { ...newRegion(poly, preset, i, `${req.seed}-${i + 1}`), kind, condition };
    region.settings = { ...presetSettings(preset), decay: CONDITION_DECAY[condition] };
    region.name = `${site.label} ${siteNames[i]!}`;
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

  // Levelling a town filled the stream beds through it: cut them again under the same water.
  carveRivers(hf, doc.water.rivers, true);

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
      const route = routeOverGround(hf, sea, centres[a]!, centres[b]!, wet);
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
  const cap = Math.floor(MAX_FLORA * .9);
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
      // Nothing grows in a river bed.
      { const k = hf.clampJ(Math.round(pz / hf.cell)) * hf.cols + hf.clampI(Math.round(px / hf.cell)); if (wet.level[k]! > hf.heights[k]! - .3) continue; }
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
  // The landmarks players steer by: the highest summits (apart from each other) and the lakes.
  const peaks = cand.filter((c) => c.h - sea > top * .55).sort((a, b) => b.h - a.h), named: Cand[] = [];
  for (const c of peaks) if (named.length < 3 && named.every((q) => Math.hypot(q.x - c.x, q.z - c.z) > 900)) named.push(c);
  for (const [k, c] of named.entries()) br.pois.push({ id: `poi-peak-${k}`, name: `Đỉnh ${nameFrom('mountain', c.x, c.z).split(' ').slice(1).join(' ')} (${Math.round(c.h - sea)} m)`.slice(0, 80), kind: 'peak', x: Math.round(c.x), z: Math.round(c.z), radius: 80 });
  for (const [k, l] of doc.water.lakes.entries()) { const [cx, cz] = polygonCentroid(l.polygon); br.pois.push({ id: `poi-lake-${k}`, name: l.name.slice(0, 80), kind: 'lake', x: Math.round(cx), z: Math.round(cz), radius: 60 }); }
  // Vehicles in every battle royale match, whatever the map's condition.
  br.vehicles = p.vehicles ?? DEFAULT_AUTO.vehicles;
  br.hotspots = doc.regions.filter((r) => r.preset === 'military-base' || r.preset === 'small-city' || r.preset === 'mixed-city' || r.preset === 'abandoned-city' || r.preset === 'port').map((r) => { const c = polygonCentroid(r.polygon); return { id: `hot-${r.id}`, name: r.name, x: Math.round(c[0]), z: Math.round(c[1]), radius: 200, danger: r.preset === 'military-base' ? 5 : 4 }; });
  const ctx = { terrain: hf, water: doc.water, seaLevel: sea };
  br.spawnPoints = autoSpawnPoints(br, ctx, req.seed, br.maxPlayers);
  br.loot.points = autoLootPoints(br, doc.regions.flatMap((r) => r.result?.buildings ?? []).map((b) => ({ x: b.obb.x, z: b.obb.z, cls: b.cls, door: b.door })), req.seed);
  doc.meta.description = `${doc.regions.length} khu vực, ${doc.water.rivers.length} sông, ${doc.water.lakes.length} hồ, ${flora.length} cây/đá.`;
  yield 1;
  return { doc, terrain: hf };
}

/**
 * Cheapest way over the ground on a coarse grid: steep cells cost much more, cliffs are all but
 * impassable, the sea and lakes are avoided and rivers are crossed where they are narrow.
 */
function routeOverGround(hf: Heightfield, sea: number, a: Vec2, b: Vec2, wet: ReturnType<typeof rasterizeWater>): Vec2[] | null {
  const water = (x: number, z: number) => { const k = hf.clampJ(Math.round(z / hf.cell)) * hf.cols + hf.clampI(Math.round(x / hf.cell)); return wet.level[k]! > hf.heights[k]! ? (wet.lake[k] ? 2 : 1) : 0; };
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
      const w = water(ix * step, iz * step);
      const g = cost[c]! + run * (1 + 300 * Math.max(0, grade - .06) ** 2 + 400 * Math.max(0, grade - .25)) * (h < sea + 1 || w === 2 ? 40 : w === 1 ? 6 : 1);
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

/** Two-pass chamfer distance (m) on an n×n grid to the nearest marked cell (∞ when none). */
function gridDistance(n: number, mask: Uint8Array, cell: number): Float32Array {
  const d = new Float32Array(n * n);
  for (let k = 0; k < d.length; k++) d[k] = mask[k] ? 0 : 1e9;
  const d1 = cell, d2 = cell * Math.SQRT2;
  const relax = (k: number, o: number, w: number) => { const v = d[o]! + w; if (v < d[k]!) d[k] = v; };
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = j * n + i;
    if (i > 0) relax(k, k - 1, d1);
    if (j > 0) { relax(k, k - n, d1); if (i > 0) relax(k, k - n - 1, d2); if (i < n - 1) relax(k, k - n + 1, d2); }
  }
  for (let j = n - 1; j >= 0; j--) for (let i = n - 1; i >= 0; i--) {
    const k = j * n + i;
    if (i < n - 1) relax(k, k + 1, d1);
    if (j < n - 1) { relax(k, k + n, d1); if (i < n - 1) relax(k, k + n + 1, d2); if (i > 0) relax(k, k + n - 1, d2); }
  }
  return d;
}
