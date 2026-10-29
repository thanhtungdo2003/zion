import { describe, expect, it } from 'vitest';
import { createDefaultRegistry } from '@zion/assets';
import { BATTLE_MAP, BATTLE_STAGES, Surface, hashString } from '@zion/shared';
import { normalizeSeed } from '../config';
import { WorldGenerator } from '../generator';
import {
  DEFAULT_BRUSH, EditHistory, Heightfield, SETTLEMENT_PRESETS, SettlementError, StrokeRecorder, applyBrush, autoSpawnPoints, buildCatalog, carveLake, carveRiver,
  checkSettlement, createMapDoc, levelRegion, defaultBattleConfig, defaultTerrainSettings, duplicateMap, generateSettlement, generateTerrain, obbInsidePolygon, obbOverlap,
  parseMapFile, presetSettings, riverLevels, serializeMap, simulateZones, stream, validateBattleConfig, validateMap, validateRegion, waterLevelAt, fromStoredBattleMap, toBattleMap,
  type SettlementInput, type SettlementResult, type Vec2,
} from './index';
import { Simplex2 } from '../noise';
import { buildNewMap } from './templates';

const registry = createDefaultRegistry();
const catalog = buildCatalog(registry);
const run = <T>(gen: Generator<unknown, T>): T => { for (;;) { const r = gen.next(); if (r.done) return r.value; } };
const digest = (a: ArrayLike<number>) => { let h = 0; for (let i = 0; i < a.length; i++) h = (h * 31 + Math.round(a[i]! * 1000)) | 0; return h; };

function hills(seed = 'test', size = 1024) {
  const s = { ...defaultTerrainSettings('hills', seed, size), maxHeight: 30 };
  const hf = new Heightfield(s.size, s.cell);
  run(generateTerrain(s, hf));
  return { s, hf };
}

describe('terrain', () => {
  it('generates the same terrain for the same seed and settings, different for another seed', () => {
    const a = hills('alpha'), b = hills('alpha'), c = hills('beta');
    expect(digest(a.hf.heights)).toBe(digest(b.hf.heights));
    expect(digest(a.hf.heights)).not.toBe(digest(c.hf.heights));
    const st = a.hf.stats();
    expect(st.min).toBeGreaterThan(a.s.seaLevel);
    expect(st.max - st.min).toBeGreaterThan(5);
  });

  it('every preset makes land; the island has sea at its edges', () => {
    for (const preset of ['plains', 'hills', 'mountains', 'valley', 'island', 'mixed'] as const) {
      const s = defaultTerrainSettings(preset, 'p', 1024), hf = new Heightfield(s.size, s.cell);
      run(generateTerrain(s, hf));
      const above = hf.heights.filter((h) => h > s.seaLevel).length / hf.heights.length;
      expect(above, preset).toBeGreaterThan(.3);
      if (preset === 'island') { expect(hf.heightAt(2, 2)).toBeLessThan(s.seaLevel); expect(hf.heightAt(512, 512)).toBeGreaterThan(s.seaLevel); }
    }
  });

  it('brushes change the ground as named, and one undo restores the stroke exactly', () => {
    const { hf } = hills();
    const before = hf.heights.slice();
    const rng = stream('b', 'brush'), noise = new Simplex2(1), history = new EditHistory<null>();
    const at = (x: number, z: number) => hf.heightAt(x, z);
    const rec = new StrokeRecorder(hf);
    const h0 = at(500, 500);
    rec.touch(applyBrush(hf, 'raise', { ...DEFAULT_BRUSH, radius: 40, strength: 1 }, 500, 500, rng, noise));
    expect(at(500, 500)).toBeGreaterThan(h0 + .5);
    rec.touch(applyBrush(hf, 'lower', { ...DEFAULT_BRUSH, radius: 40, strength: 1 }, 300, 300, rng, noise));
    const flat = { ...DEFAULT_BRUSH, radius: 30, strength: 1, falloff: 0, targetHeight: 33 };
    for (let k = 0; k < 12; k++) rec.touch(applyBrush(hf, 'flatten', flat, 700, 700, rng, noise));
    expect(Math.abs(at(700, 700) - 33)).toBeLessThan(.05);
    const rough = (x: number) => { let v = 0; for (let i = -10; i < 10; i++) v += Math.abs(at(x + i, 200) - at(x + i + 1, 200)); return v; };
    rec.touch(applyBrush(hf, 'noise', { ...DEFAULT_BRUSH, radius: 40, strength: 1 }, 200, 200, rng, noise));
    const r0 = rough(200);
    for (let k = 0; k < 8; k++) rec.touch(applyBrush(hf, 'smooth', { ...DEFAULT_BRUSH, radius: 40, strength: 1 }, 200, 200, rng, noise));
    expect(rough(200)).toBeLessThan(r0);
    rec.touch(applyBrush(hf, 'paint', { ...DEFAULT_BRUSH, radius: 20, surface: Surface.Rock }, 800, 200, rng, noise));
    expect(hf.surfaceAt(800, 200)).toBe(Surface.Rock);
    rec.touch(applyBrush(hf, 'sculpt', { ...DEFAULT_BRUSH, radius: 50, strength: 1, pattern: 'ridge' }, 600, 300, rng, noise));
    expect(rec.touch(applyBrush(hf, 'erosion', { ...DEFAULT_BRUSH, radius: 60, strength: 1 }, 520, 520, rng, noise))).toBeUndefined();
    history.push({ label: 'stroke', terrain: rec.finish()! });
    expect(digest(hf.heights)).not.toBe(digest(before));
    history.undo(hf);
    expect(digest(hf.heights)).toBe(digest(before));
    expect(hf.surfaceAt(800, 200)).not.toBe(Surface.Rock);
    history.redo(hf);
    expect(hf.surfaceAt(800, 200)).toBe(Surface.Rock);
  });

  it('erosion is deterministic for its random stream', () => {
    const a = hills().hf, b = hills().hf, n = new Simplex2(1);
    applyBrush(a, 'erosion', { ...DEFAULT_BRUSH, radius: 80, strength: 1 }, 400, 400, stream('e', 'erosion'), n);
    applyBrush(b, 'erosion', { ...DEFAULT_BRUSH, radius: 80, strength: 1 }, 400, 400, stream('e', 'erosion'), n);
    expect(digest(a.heights)).toBe(digest(b.heights));
    expect(digest(a.heights)).not.toBe(digest(hills().hf.heights));
  });
});

describe('water', () => {
  it('a river runs downhill in a carved channel; a lake bed sits under its surface', () => {
    const { hf, s } = hills('river');
    const river = { id: 'r', name: 'Sông', depth: 2, points: [{ x: 100, z: 500, width: 14 }, { x: 400, z: 520, width: 16 }, { x: 700, z: 480, width: 20 }, { x: 950, z: 520, width: 24 }] };
    const { levels } = carveRiver(hf, river);
    for (let i = 1; i < levels.length; i++) expect(levels[i]!).toBeLessThan(levels[i - 1]!);
    for (const p of river.points) expect(hf.heightAt(p.x, p.z)).toBeLessThan(riverLevels(hf, river)[0]! + 1);
    const water = { lakes: [], rivers: [{ ...river, levels }] };
    expect(waterLevelAt(hf, water, s.seaLevel, 400, 520)).not.toBeNull();
    const lake = { id: 'l', name: 'Hồ', polygon: [[600, 700], [760, 700], [760, 860], [600, 860]] as Vec2[], level: hf.heightAt(680, 780), depth: 4 };
    carveLake(hf, lake);
    expect(hf.heightAt(680, 780)).toBeLessThan(lake.level - 3);
  });
});

function region(hf: Heightfield, s: { seaLevel: number }, polygon: Vec2[], preset: (typeof SETTLEMENT_PRESETS)[number]['id'], extra: Partial<SettlementInput> = {}): SettlementInput {
  return { polygon, seed: 'town-1', settings: presetSettings(preset), terrain: hf, water: { lakes: [], rivers: [] }, seaLevel: s.seaLevel, externalRoads: [], obstacles: [], catalog, ...extra };
}
const square = (x: number, z: number, w: number, h = w): Vec2[] => [[x, z], [x + w, z], [x + w, z + h], [x, z + h]];

describe('settlement generator', () => {
  const { hf, s } = hills('settle');
  const flatHf = hf.clone();
  flatHf.heights.fill(30);

  it('rejects invalid regions', () => {
    expect(validateRegion([[0, 0], [10, 0]], 1024).map((i) => i.code)).toContain('too-few-points');
    expect(validateRegion([[0, 0], [200, 200], [200, 0], [0, 200]], 1024).map((i) => i.code)).toContain('self-intersect');
    expect(validateRegion(square(10, 10, 30), 1024).map((i) => i.code)).toContain('too-small');
    expect(validateRegion(square(900, 900, 300), 1024).map((i) => i.code)).toContain('outside-map');
    expect(() => run(generateSettlement(region(hf, s, square(10, 10, 30), 'small-village')))).toThrow(SettlementError);
  });

  for (const preset of SETTLEMENT_PRESETS) {
    it(`${preset.name}: buildings inside, on dry flat ground, apart, off the roads, with a way in`, () => {
      const poly: Vec2[] = [[180, 160], [760, 200], [840, 640], [520, 860], [200, 720]];
      const input = region(hf, s, poly, preset.id, { externalRoads: [{ points: [[0, 500], [150, 500]], width: 8 }] });
      const result = run(generateSettlement(input));
      expect(result.buildings.length, preset.id).toBeGreaterThan(8);
      expect(result.roads.some((r) => r.kind === 'main')).toBe(true);
      expect(result.roads.some((r) => r.kind === 'connector')).toBe(true);
      for (const b of result.buildings) expect(obbInsidePolygon(b.obb, poly)).toBe(true);
      for (let i = 0; i < result.buildings.length; i++) for (let j = i + 1; j < result.buildings.length; j++) expect(obbOverlap(result.buildings[i]!.obb, result.buildings[j]!.obb)).toBe(false);
      const errors = result.issues.filter((i) => i.severity === 'error');
      expect(errors, JSON.stringify(errors.slice(0, 3))).toHaveLength(0);
      expect(result.issues.some((i) => i.code === 'disconnected')).toBe(false);
      const noAccess = result.issues.filter((i) => i.code === 'no-access').length;
      expect(noAccess / result.buildings.length).toBeLessThan(.05);
      expect(result.props.length).toBeGreaterThan(0);
    });
  }

  it('levelling a region on steep hills lets a town fit', () => {
    const steepS = defaultTerrainSettings('hills', 'steep', 1024), steep = new Heightfield(steepS.size, steepS.cell);
    run(generateTerrain(steepS, steep));
    const poly = square(250, 250, 500);
    const flatOff = region(steep, steepS, poly, 'rural-town');
    flatOff.settings.grading = 0;
    const before = run(generateSettlement(flatOff));
    // Automatic cut and fill (preset default) works on a copy and hands back the patch.
    const graded = run(generateSettlement(region(steep, steepS, poly, 'rural-town')));
    expect(graded.grading).toBeDefined();
    expect(graded.buildings.length).toBeGreaterThan(before.buildings.length);
    // The same, done by hand on the map.
    levelRegion(steep, poly, 40);
    const after = run(generateSettlement(flatOff));
    expect(after.buildings.length).toBeGreaterThan(before.buildings.length * 1.5);
  });

  it('big buildings first: the largest lots hold the largest models', () => {
    const r = run(generateSettlement(region(flatHf, s, square(200, 200, 600), 'small-city')));
    const area = (id: number) => { const c = catalog.byAsset.get(id)!; return c.w * c.d; };
    expect(r.buildings.some((b) => b.asset === 2421)).toBe(true);
    const sorted = [...r.buildings].sort((a, b) => area(b.asset) - area(a.asset));
    expect(area(sorted[0]!.asset)).toBeGreaterThan(area(sorted[sorted.length - 1]!.asset));
  });

  it('same seed and settings give the same town; streams are independent per layer', () => {
    const poly = square(220, 220, 520);
    const a = run(generateSettlement(region(hf, s, poly, 'rural-town'))), b = run(generateSettlement(region(hf, s, poly, 'rural-town')));
    const strip = (r: SettlementResult) => JSON.stringify({ ...r, grading: r.grading ? [...r.grading.heights] : null, stats: { ...r.stats, ms: 0 } });
    expect(strip(a)).toBe(strip(b));
    const moreTrees = region(hf, s, poly, 'rural-town');
    moreTrees.settings.treeDensity = 1;
    const c = run(generateSettlement(moreTrees));
    expect(JSON.stringify(c.roads)).toBe(JSON.stringify(a.roads));
    expect(JSON.stringify(c.buildings)).toBe(JSON.stringify(a.buildings));
    expect(c.props.filter((p) => p.kind === 'tree').length).toBeGreaterThan(a.props.filter((p) => p.kind === 'tree').length);
  });

  it('regenerating one layer keeps the others and every hand-edited item', () => {
    const poly = square(220, 220, 520);
    const first = run(generateSettlement(region(hf, s, poly, 'residential-district')));
    const edited: SettlementResult = structuredClone(first);
    edited.buildings[0]!.manual = true;
    edited.props = edited.props.filter((p) => p.kind !== 'lamp');
    edited.props[0]!.manual = true;
    const propsOnly = run(generateSettlement(region(hf, s, poly, 'residential-district', { previous: edited, from: 'props', seed: 'other' })));
    expect(JSON.stringify(propsOnly.roads)).toBe(JSON.stringify(first.roads));
    expect(JSON.stringify(propsOnly.buildings)).toBe(JSON.stringify(edited.buildings));
    expect(propsOnly.props.some((p) => p.id === edited.props[0]!.id && p.manual)).toBe(true);
    const all = run(generateSettlement(region(hf, s, poly, 'residential-district', { previous: edited, from: 'roads', seed: 'another' })));
    expect(all.buildings.some((b) => b.id === edited.buildings[0]!.id && b.manual)).toBe(true);
  });

  it('never builds on a lake or a river crossing the region', () => {
    const wet = flatHf.clone();
    const lake = { id: 'l', name: 'Hồ', polygon: square(400, 400, 160), level: 30.5, depth: 4 };
    carveLake(wet, lake);
    const river = { id: 'r', name: 'S', depth: 2, points: [{ x: 150, z: 300, width: 18 }, { x: 900, z: 320, width: 18 }] };
    const { levels } = carveRiver(wet, river);
    const water = { lakes: [lake], rivers: [{ ...river, levels }] };
    const r = run(generateSettlement(region(wet, s, square(200, 200, 600), 'dense-town', { water })));
    expect(r.buildings.length).toBeGreaterThan(10);
    for (const b of r.buildings) expect(waterLevelAt(wet, water, s.seaLevel, b.obb.x, b.obb.z)).toBeNull();
    expect(checkSettlement(r, { polygon: square(200, 200, 600), terrain: wet, water, seaLevel: s.seaLevel, externalRoads: [] }).filter((i) => i.code === 'on-water')).toHaveLength(0);
  });

  it('keeps clear of obstacles (other regions, existing structures)', () => {
    const obstacles = [{ x: 500, z: 500, hx: 60, hz: 60, yaw: .3 }];
    const r = run(generateSettlement(region(flatHf, s, square(200, 200, 600), 'dense-town', { obstacles })));
    for (const b of r.buildings) expect(obbOverlap(b.obb, obstacles[0]!)).toBe(false);
  });
});

describe('battle royale configuration', () => {
  const { hf, s } = hills('br');
  const ctx = { terrain: hf, water: { lakes: [], rivers: [] }, seaLevel: s.seaLevel };

  it('defaults follow the live match rules and validate cleanly', () => {
    const cfg = defaultBattleConfig(1024);
    expect(cfg.phases).toHaveLength(BATTLE_STAGES.length);
    expect(cfg.maxPlayers).toBe(BATTLE_MAP.maxPlayers);
    expect(validateBattleConfig(cfg, ctx).filter((i) => i.severity === 'error')).toHaveLength(0);
  });

  it('flags growing circles, escaping fixed centres, bad spawns and too few spawn points', () => {
    const cfg = defaultBattleConfig(1024);
    cfg.phases[2]!.radius = cfg.phases[1]!.radius + 10;
    cfg.phases[0]!.center = [1000, 1000];
    cfg.spawnMode = 'spawn-points';
    cfg.spawnPoints = [{ id: 'a', x: 5, z: 5 }];
    const codes = validateBattleConfig(cfg, ctx).map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(['phase-radius', 'phase-nesting', 'spawn-outside', 'spawn-count']));
  });

  it('auto spawn points are on land, inside the play area and spaced apart; zones nest', () => {
    const cfg = defaultBattleConfig(1024);
    cfg.minSpawnSpacing = 60;
    cfg.spawnPoints = autoSpawnPoints(cfg, ctx, 'seed', 48);
    expect(cfg.spawnPoints).toHaveLength(48);
    cfg.spawnMode = 'spawn-points';
    expect(validateBattleConfig(cfg, ctx).filter((i) => i.severity === 'error')).toHaveLength(0);
    const zones = simulateZones(cfg, ctx, 'z');
    expect(JSON.stringify(zones)).toBe(JSON.stringify(simulateZones(cfg, ctx, 'z')));
    for (let i = 1; i < zones.length; i++) expect(Math.hypot(zones[i]!.x - zones[i - 1]!.x, zones[i]!.z - zones[i - 1]!.z) + zones[i]!.radius).toBeLessThanOrEqual(zones[i - 1]!.radius + 1e-6);
  });
});

describe('map documents', () => {
  it('save → load gives back the same map; corrupt files are refused', () => {
    const { hf, s } = hills('doc');
    const doc = createMapDoc({ name: 'Thử', kind: 'battle-royale', template: 'hills', terrain: s });
    const text = serializeMap(doc, hf);
    const back = parseMapFile(text);
    expect(JSON.stringify(back.doc)).toBe(JSON.stringify(doc));
    expect(digest(back.terrain.heights)).toBe(digest(hf.heights));
    expect(() => parseMapFile('{')).toThrow();
    expect(() => parseMapFile(text.replace('"zion-world-map"', '"other"'))).toThrow();
    const broken = JSON.parse(text); broken.data.heights = broken.data.heights.slice(0, 100);
    expect(() => parseMapFile(JSON.stringify(broken))).toThrow();
    const copy = duplicateMap(doc);
    expect(copy.meta.id).not.toBe(doc.meta.id);
    expect(validateMap(doc, hf).filter((i) => i.severity === 'error')).toHaveLength(0);
  });

  it('the Hắc Sơn template is sampled from the live battle royale generator', () => {
    const { doc, terrain } = run(buildNewMap({ template: 'hac-son', name: 'Hắc Sơn', kind: 'battle-royale', size: 4096, seed: BATTLE_MAP.seed, preset: 'island' }, registry));
    const gen = new WorldGenerator({ seed: normalizeSeed(BATTLE_MAP.seed), sizeChunks: BATTLE_MAP.sizeChunks, mode: 'battle-royale' }, registry);
    for (const [x, z] of [[2048, 2048], [1980, 2680], [820, 1950], [100, 100]] as const) expect(terrain.heightAt(x, z)).toBeCloseTo(gen.heightAt(x, z), 0);
    expect(doc.base.roads.length).toBe(14);
    expect(doc.base.structures.length).toBeGreaterThan(100);
    expect(doc.gameplay[0]!.pois.length).toBeGreaterThan(20);
    expect(hashString(doc.meta.template)).toBe(hashString('hac-son'));
  }, 120_000);
});

describe('published battle maps back into the studio', () => {
  const make = () => {
    const terrain = defaultTerrainSettings('plains', 'pub', 512);
    const hf = new Heightfield(512, terrain.cell);
    hf.heights.forEach((_, i) => { hf.heights[i] = 21 + (i % 13) * .37; });
    hf.surface.forEach((_, i) => { hf.surface[i] = i % 5; });
    const doc = createMapDoc({ name: 'Bản đồ thử', kind: 'battle-royale', template: 'plains', terrain });
    doc.flora = [[1, 40, 40, 0, 1], [2, 60, 80, .5, 1.2]];
    return { doc, hf };
  };
  it('restores the exact terrain and the editor document', () => {
    const { doc, hf } = make();
    const map = toBattleMap(doc, hf);
    const back = fromStoredBattleMap({ id: 'pub-map', name: 'Đã xuất bản', seaLevel: 20, map: JSON.parse(JSON.stringify(map)), source: JSON.parse(JSON.stringify(doc)) });
    expect(back.complete).toBe(true);
    expect(back.doc.meta.id).toBe('pub-map');
    expect(back.doc.flora).toEqual(doc.flora);
    expect([...back.terrain.heights]).toEqual([...hf.heights]);
    expect([...back.terrain.surface]).toEqual([...hf.surface]);
  });
  it('maps published without a document come back with terrain, flora and the reference layer', () => {
    const { doc, hf } = make();
    const map = { ...toBattleMap(doc, hf), roads: [{ points: [[10, 10], [300, 300]] as Vec2[], width: 8, paved: true }], placed: [{ x: 100, z: 120, y: 22, yaw: .4, radius: 9, halfX: 6, halfZ: 5, parts: [] }] };
    const back = fromStoredBattleMap({ id: 'old-map', name: 'Cũ', seaLevel: 18, map, source: null });
    expect(back.complete).toBe(false);
    expect(back.doc.terrain.seaLevel).toBe(18);
    expect(back.doc.base.roads).toHaveLength(1);
    expect(back.doc.base.structures[0]).toMatchObject({ x: 100, z: 120, hx: 5, hz: 4 });
    expect(back.doc.flora).toHaveLength(2);
    expect([...back.terrain.heights]).toEqual([...hf.heights]);
    expect(() => validateMap(back.doc, back.terrain)).not.toThrow();
  });
});
