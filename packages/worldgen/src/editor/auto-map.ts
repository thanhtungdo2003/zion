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
  { key: 'cities', preset: 'small-city', radius: 330, label: 'Thành phố' },
  { key: 'ports', preset: 'port', radius: 210, label: 'Cảng' },
  { key: 'towns', preset: 'dense-town', radius: 230, label: 'Thị trấn' },
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
  const catalog = buildCatalog(registry);
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

  /* Forests on open land: by noise, species by height and closeness to the sea. */
  const fRng = stream(req.seed, 'auto-forest'), mask = new Simplex2(seedNumber(req.seed, 'auto-forest-mask'));
  const roadPts = new SpatialGrid<{ x: number; z: number; r: number }>(32, (q) => q.r);
  for (const r of doc.base.roads) for (let i = 1; i < r.points.length; i++) { const [ax, az] = r.points[i - 1]!, [bx, bz] = r.points[i]!, n = Math.ceil(Math.hypot(bx - ax, bz - az) / 8); for (let k = 0; k <= n; k++) roadPts.insert({ x: ax + (bx - ax) * k / n, z: az + (bz - az) * k / n, r: r.width / 2 + 4 }); }
  const flora: FloraItem[] = [], spacing = 9, cap = Math.floor(MAX_FLORA * .9);
  const pickSp = (id: string) => { const sp = FLORA_SPECIES.find((q) => q.id === id)!; return sp.assets[Math.floor(fRng.next() * sp.assets.length)]!; };
  for (let z = spacing / 2; z < size && flora.length < cap; z += spacing) for (let x = spacing / 2; x < size && flora.length < cap; x += spacing) {
    const px = x + (fRng.next() - .5) * spacing, pz = z + (fRng.next() - .5) * spacing, h = hf.heightAt(px, pz);
    if (h < sea + 1.5) continue;
    const m = mask.noise(px * .0025, pz * .0025) * .7 + mask.noise(px * .01, pz * .01) * .3;
    const forest = smoothstep(1 - p.forest * 1.6, 1.15 - p.forest * 1.6, m * .5 + .5);
    if (fRng.next() > forest * .9 + .03) continue;
    if (doc.regions.some((r) => pointInPolygon(px, pz, r.polygon)) || roadPts.query(px, pz, 0).length || hf.slopeAt(px, pz) > .9) continue;
    if (doc.water.lakes.some((l) => pointInPolygon(px, pz, l.polygon))) continue;
    const rel = (h - sea) / Math.max(30, settings.maxHeight), roll = fRng.next();
    const species = forest < .3 ? (roll < .6 ? 'grass' : roll < .85 ? 'bush' : 'stone')
      : rel > .65 ? (roll < .6 ? 'pine' : roll < .8 ? 'conifer' : 'rock')
        : rel < .08 ? (roll < .4 ? 'palm' : roll < .7 ? 'broadleaf' : 'bush')
          : roll < .45 ? 'forest' : roll < .65 ? 'oak' : roll < .78 ? 'broadleaf' : roll < .92 ? 'shrub' : 'stone';
    flora.push([pickSp(species), Math.round(px * 10) / 10, Math.round(pz * 10) / 10, Math.round(fRng.next() * 628) / 100, Math.round((.75 + fRng.next() * .55) * 100) / 100]);
    if (forest > .6) { const k = hf.index(hf.clampI(Math.round(px / hf.cell)), hf.clampJ(Math.round(pz / hf.cell))); if (hf.surface[k] === Surface.Grass) hf.surface[k] = Surface.ForestFloor; }
  }
  doc.flora = flora;
  yield .92;

  /* Match setup: places of interest, danger, spawns and loot from what was built. */
  const br = doc.gameplay[0]!;
  br.name = 'Battle Royale — tự động';
  br.pois = doc.regions.map((r) => { const c = polygonCentroid(r.polygon); return { id: `poi-${r.id}`, name: r.name, kind: r.preset, x: Math.round(c[0]), z: Math.round(c[1]), radius: Math.round(Math.sqrt(r.result?.analysis.area ?? 10000) / 2) }; });
  br.hotspots = doc.regions.filter((r) => r.preset === 'military-base' || r.preset === 'small-city' || r.preset === 'port').map((r) => { const c = polygonCentroid(r.polygon); return { id: `hot-${r.id}`, name: r.name, x: Math.round(c[0]), z: Math.round(c[1]), radius: 200, danger: r.preset === 'military-base' ? 5 : 4 }; });
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
