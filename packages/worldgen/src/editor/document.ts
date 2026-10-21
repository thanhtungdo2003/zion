import { z } from 'zod';
import { isSimplePolygon, pointInPolygon, polygonArea, type Vec2 } from './geometry';
import { battleConfigSchema, defaultBattleConfig, validateBattleConfig, type BattleConfig, type GameplayIssue } from './gameplay';
import { Heightfield, base64ToBytes, bytesToBase64, decodeHeights, encodeHeights } from './heightfield';
import { SETTLEMENT_PRESET_IDS, presetSettings, type SettlementPresetId } from './settlement/presets';
import type { SettlementLayer, SettlementResult } from './settlement/generate';
import { TERRAIN_PRESETS, MAP_SIZES, defaultTerrainSettings, validateTerrainSettings, type TerrainSettings } from './terrain-gen';
import { lakeSpillLevel, riverLevels, riverMaxGrade, type WaterData } from './water';

export const MAP_KINDS = [
  { id: 'battle-royale', name: 'Battle Royale' }, { id: 'survival', name: 'Sinh tồn' }, { id: 'sandbox', name: 'Thử nghiệm' },
] as const;
export type MapKind = typeof MAP_KINDS[number]['id'];

export interface WorldMapMeta {
  id: string;
  name: string;
  kind: MapKind;
  description: string;
  /** Where it started: 'blank', a terrain preset id, or 'hac-son' (the live island). */
  template: string;
  createdAt: number;
  updatedAt: number;
  size: number;
  seed: string;
  /** Small hill-shaded preview (data URL), rendered on save. */
  thumbnail?: string;
}

export interface Region {
  id: string;
  name: string;
  polygon: Vec2[];
  preset: SettlementPresetId;
  seed: string;
  settings: ReturnType<typeof presetSettings>;
  /** The applied result (null until the preview is accepted). */
  result: SettlementResult | null;
  /** Spots cleared by hand: kept empty when layers are generated again. */
  exclusions: Array<{ x: number; z: number; hx: number; hz: number; yaw: number }>;
  history: Array<{ at: number; from: SettlementLayer; seed: string; buildings: number; props: number; roads: number }>;
}

/** Read-only reference imported with a template: the live island's roads and building pads. */
export interface BaseLayer {
  roads: Array<{ points: Vec2[]; width: number; paved: boolean }>;
  structures: Array<{ x: number; z: number; yaw: number; hx: number; hz: number }>;
}

export interface WorldMapDoc {
  format: 'zion-world-map';
  version: 1;
  meta: WorldMapMeta;
  terrain: TerrainSettings;
  water: WaterData;
  regions: Region[];
  base: BaseLayer;
  /** Match setups, kept apart from the terrain so one map serves several. */
  gameplay: BattleConfig[];
  activeGameplay: string;
}

/* ------------------------------------------------------------------------------ schemas */

const n = z.number().finite();
const coord = n.min(-64).max(8256);
const vec = z.tuple([coord, coord]);
const obb = z.object({ x: n, z: n, hx: n.min(0), hz: n.min(0), yaw: n }).strict();
const settingsSchema = z.object({
  preset: z.enum(SETTLEMENT_PRESET_IDS), layout: z.enum(['grid', 'organic']), density: n, randomness: n, concentration: n,
  mainRoadWidth: n, secondaryRoadWidth: n, alleyWidth: n, blockSize: n, lotWidth: n, lotDepth: n, setback: n, sizeBias: n,
  zoning: z.object({ residential: n, commercial: n, industrial: n, military: n }).strict(),
  treeDensity: n, propDensity: n, decay: n, fences: z.boolean(), lamps: z.boolean(), perimeter: z.boolean(), maxSlope: n, grading: n, maxBuildings: n.int(), maxProps: n.int(),
}).strict();
const cls = z.enum(['residential', 'commercial', 'industrial', 'military']);
const resultSchema = z.object({
  version: z.literal(1), seed: z.string().max(64), settings: settingsSchema,
  analysis: z.object({ area: n, buildableShare: n, waterShare: n, steepShare: n, meanHeight: n, center: vec, angle: n, radius: n }).strict(),
  roads: z.array(z.object({ id: z.string(), kind: z.enum(['main', 'secondary', 'alley', 'connector']), width: n, points: z.array(vec).min(2).max(4096) }).strict()).max(2000),
  blocks: z.array(z.object({ id: z.string(), polygon: z.array(vec).max(512), cls: z.union([cls, z.literal('green')]) }).strict()).max(5000),
  lots: z.array(z.object({ id: z.string(), block: z.string(), polygon: z.array(vec).max(96), front: z.tuple([vec, vec]), dir: z.tuple([n, n]), obb, cls: z.union([cls, z.enum(['green', 'empty'])]), shape: z.enum(['rect', 'skew', 'L', 'U', 'wide']).optional(), style: z.enum(['yard', 'full', 'garden', 'orchard', 'farm', 'walled', 'overgrown', 'vacant', 'work']).optional(), fence: z.enum(['none', 'wood', 'iron', 'wall', 'hedge', 'wire']).optional(), flora: n.int().optional() }).strict()).max(20000),
  buildings: z.array(z.object({ id: z.string(), asset: n.int(), x: n, z: n, y: n, yaw: n, obb, door: z.tuple([n, n]), lot: z.string().optional(), cls, manual: z.boolean().optional() }).strict()).max(4000),
  props: z.array(z.object({ id: z.string(), asset: n.int(), kind: z.string().max(32), x: n, z: n, y: n, yaw: n, scale: n, obb, manual: z.boolean().optional() }).strict()).max(20000),
  issues: z.array(z.object({ severity: z.enum(['error', 'warning', 'info']), code: z.string(), message: z.string(), x: n.optional(), z: n.optional() }).strict()).max(5000),
  stats: z.record(n),
}).strict();
const regionSchema = z.object({
  id: z.string().min(1).max(64), name: z.string().min(1).max(80), polygon: z.array(vec).min(3).max(128), preset: z.enum(SETTLEMENT_PRESET_IDS),
  seed: z.string().min(1).max(64), settings: settingsSchema, result: resultSchema.nullable(), exclusions: z.array(obb).max(4000),
  history: z.array(z.object({ at: n, from: z.enum(['roads', 'buildings', 'props']), seed: z.string(), buildings: n, props: n, roads: n }).strict()).max(64),
}).strict();
export const worldMapSchema = z.object({
  format: z.literal('zion-world-map'), version: z.literal(1),
  meta: z.object({
    id: z.string().min(1).max(64), name: z.string().min(1).max(80), kind: z.enum(['battle-royale', 'survival', 'sandbox']), description: z.string().max(500),
    template: z.string().max(40), createdAt: n, updatedAt: n, size: n, seed: z.string().max(64), thumbnail: z.string().max(200_000).optional(),
  }).strict(),
  terrain: z.object({
    preset: z.enum(TERRAIN_PRESETS.map((p) => p.id) as [string, ...string[]]), seed: z.string(), size: n, cell: n, seaLevel: n, maxHeight: n, roughness: n, detail: n.int(), seaEdge: z.boolean(),
  }).strict(),
  water: z.object({
    lakes: z.array(z.object({ id: z.string(), name: z.string().max(80), polygon: z.array(vec).min(3).max(256), level: n, depth: n.min(0).max(100) }).strict()).max(128),
    rivers: z.array(z.object({ id: z.string(), name: z.string().max(80), points: z.array(z.object({ x: coord, z: coord, width: n.min(1).max(200) }).strict()).min(2).max(512), depth: n.min(0).max(50), levels: z.array(n).optional() }).strict()).max(128),
  }).strict(),
  regions: z.array(regionSchema).max(64),
  base: z.object({
    roads: z.array(z.object({ points: z.array(vec).min(2).max(4096), width: n, paved: z.boolean() }).strict()).max(512),
    structures: z.array(obb).max(10000),
  }).strict(),
  gameplay: z.array(battleConfigSchema).min(1).max(16),
  activeGameplay: z.string(),
}).strict();
const fileSchema = worldMapSchema.extend({ data: z.object({ heights: z.string(), surface: z.string() }).strict() });

/* ---------------------------------------------------------------------------- lifecycle */

export function newId(prefix: string): string {
  const random = globalThis.crypto?.randomUUID?.().slice(0, 8) ?? Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}

export function createMapDoc(opts: { name: string; kind: MapKind; description?: string; template: string; terrain: TerrainSettings; base?: BaseLayer; now?: number }): WorldMapDoc {
  const now = opts.now ?? Date.now();
  const gameplay = defaultBattleConfig(opts.terrain.size);
  return {
    format: 'zion-world-map', version: 1,
    meta: { id: newId('map'), name: opts.name, kind: opts.kind, description: opts.description ?? '', template: opts.template, createdAt: now, updatedAt: now, size: opts.terrain.size, seed: opts.terrain.seed },
    terrain: opts.terrain, water: { lakes: [], rivers: [] }, regions: [], base: opts.base ?? { roads: [], structures: [] },
    gameplay: [gameplay], activeGameplay: gameplay.id,
  };
}

export function duplicateMap(doc: WorldMapDoc, name = `${doc.meta.name} (bản sao)`): WorldMapDoc {
  const copy = structuredClone(doc), now = Date.now();
  copy.meta = { ...copy.meta, id: newId('map'), name, createdAt: now, updatedAt: now };
  return copy;
}

export function newRegion(polygon: Vec2[], preset: SettlementPresetId, index: number, seed: string): Region {
  return { id: newId('region'), name: `Khu vực ${index + 1}`, polygon, preset, seed, settings: presetSettings(preset), result: null, exclusions: [], history: [] };
}

export function blankTerrain(hf: Heightfield, height: number): void { hf.heights.fill(height); hf.surface.fill(0); }

/* ---------------------------------------------------------------------- save / load file */

export const MAX_MAP_FILE = 96 * 1024 * 1024;

export function serializeMap(doc: WorldMapDoc, hf: Heightfield): string {
  return JSON.stringify({ ...doc, data: { heights: encodeHeights(hf.heights), surface: bytesToBase64(hf.surface) } });
}

/** Parses and checks a map file: schema, sizes, and terrain data matching its grid. */
export function parseMapFile(text: string): { doc: WorldMapDoc; terrain: Heightfield } {
  if (text.length > MAX_MAP_FILE) throw new Error(`Tệp lớn hơn ${MAX_MAP_FILE / 1024 / 1024} MB.`);
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new Error('Tệp không phải JSON hợp lệ.'); }
  const parsed = fileSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`Tệp map không hợp lệ: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')} — ${i.message}`).join('; ')}`);
  const { data, ...doc } = parsed.data;
  const issues = validateTerrainSettings(doc.terrain as TerrainSettings);
  if (issues.length) throw new Error(issues.join(' '));
  const terrain = new Heightfield(doc.terrain.size, doc.terrain.cell, decodeHeights(data.heights), base64ToBytes(data.surface));
  if (![...terrain.heights].every(Number.isFinite)) throw new Error('Dữ liệu độ cao có giá trị không hợp lệ.');
  return { doc: doc as WorldMapDoc, terrain };
}

/** Checks a stored document (used on load from the browser database). */
export function checkDoc(doc: unknown): WorldMapDoc {
  const parsed = worldMapSchema.safeParse(doc);
  if (!parsed.success) throw new Error(`Dữ liệu map hỏng: ${parsed.error.issues.slice(0, 2).map((i) => `${i.path.join('.')} — ${i.message}`).join('; ')}`);
  return parsed.data as WorldMapDoc;
}

/* ---------------------------------------------------------------------------- validation */

export interface MapIssue extends GameplayIssue { area: 'terrain' | 'water' | 'settlement' | 'gameplay' | 'map' }

/** Map-wide checks: settings, water that would spill, river grades, regions and the active match setup. */
export function validateMap(doc: WorldMapDoc, hf: Heightfield): MapIssue[] {
  const out: MapIssue[] = [];
  for (const m of validateTerrainSettings(doc.terrain)) out.push({ area: 'terrain', severity: 'error', code: 'terrain-settings', message: m });
  if (!MAP_SIZES.includes(doc.meta.size as typeof MAP_SIZES[number]) || doc.meta.size !== doc.terrain.size) out.push({ area: 'map', severity: 'error', code: 'size', message: 'Kích thước map không khớp dữ liệu địa hình.' });
  const stats = hf.stats();
  if (stats.max <= doc.terrain.seaLevel) out.push({ area: 'terrain', severity: 'error', code: 'all-sea', message: 'Toàn bộ địa hình nằm dưới mực nước biển.' });
  for (const lake of doc.water.lakes) {
    const spill = lakeSpillLevel(hf, lake);
    if (!isSimplePolygon(lake.polygon)) out.push({ area: 'water', severity: 'error', code: 'lake-shape', message: `Hồ "${lake.name}" có đường bờ tự cắt.` });
    if (lake.level > spill + .5) out.push({ area: 'water', severity: 'warning', code: 'lake-spill', message: `Mặt hồ "${lake.name}" (${lake.level.toFixed(1)} m) cao hơn bờ thấp nhất (${spill.toFixed(1)} m): nước sẽ tràn.`, x: lake.polygon[0]![0], z: lake.polygon[0]![1] });
  }
  for (const river of doc.water.rivers) {
    const levels = river.levels ?? riverLevels(hf, river), grade = riverMaxGrade(river, levels);
    if (grade > 8) out.push({ area: 'water', severity: 'warning', code: 'river-grade', message: `Sông "${river.name}" có đoạn dốc ${grade.toFixed(1)}% — giống thác hơn sông.`, x: river.points[0]!.x, z: river.points[0]!.z });
    if (!river.levels) out.push({ area: 'water', severity: 'info', code: 'river-uncarved', message: `Sông "${river.name}" chưa khắc lòng vào địa hình.` });
  }
  doc.regions.forEach((r, i) => {
    if (!isSimplePolygon(r.polygon) || Math.abs(polygonArea(r.polygon)) < 2500) out.push({ area: 'settlement', severity: 'error', code: 'region-shape', message: `"${r.name}": vùng không hợp lệ.` });
    if (!r.result) out.push({ area: 'settlement', severity: 'info', code: 'region-empty', message: `"${r.name}" chưa được sinh.` });
    for (const issue of r.result?.issues ?? []) if (issue.severity !== 'info') out.push({ ...issue, area: 'settlement', message: `${r.name}: ${issue.message}` });
    for (const other of doc.regions.slice(i + 1)) {
      if (r.polygon.some(([x, z]) => pointInPolygon(x, z, other.polygon)) || other.polygon.some(([x, z]) => pointInPolygon(x, z, r.polygon))) out.push({ area: 'settlement', severity: 'warning', code: 'region-overlap', message: `"${r.name}" chồng lên "${other.name}".` });
    }
  });
  const active = doc.gameplay.find((g) => g.id === doc.activeGameplay);
  if (!active) out.push({ area: 'gameplay', severity: 'error', code: 'no-active', message: 'Chưa chọn cấu hình trận đấu.' });
  else for (const i of validateBattleConfig(active, { terrain: hf, water: doc.water, seaLevel: doc.terrain.seaLevel })) out.push({ ...i, area: 'gameplay' });
  return out;
}
export { defaultTerrainSettings };
