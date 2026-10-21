import type { AssetRegistry } from '@zion/assets';
import { BATTLE_MAP } from '@zion/shared';
import { normalizeSeed } from '../config';
import { WorldGenerator, makeColumnSample } from '../generator';
import { authoredWorld } from '../maps/authored';
import type { Vec2 } from './geometry';
import { createMapDoc, type MapKind, type WorldMapDoc } from './document';
import { Heightfield } from './heightfield';
import { defaultTerrainSettings, generateTerrain, type TerrainPreset } from './terrain-gen';
import { autoMap, type AutoParams } from './auto-map';
export { DEFAULT_AUTO, type AutoParams } from './auto-map';

export const MAP_TEMPLATES = [
  { id: 'hac-son', name: 'Đảo Hắc Sơn (bản đồ BR hiện tại)', description: 'Địa hình, đường, công trình và địa danh lấy từ bộ sinh map của game.' },
  { id: 'blank', name: 'Bản đồ trống', description: 'Mặt đất phẳng để tự nặn từ đầu.' },
  { id: 'auto', name: 'Tự động', description: 'Sinh trọn một bản đồ: địa hình, núi đồi, sông hồ, thành phố, thị trấn, làng, khu công nghiệp, căn cứ, cảng, đường nối, rừng và cấu hình trận.' },
  { id: 'procedural', name: 'Sinh từ seed', description: 'Địa hình nhiều lớp noise theo preset: đồng bằng, đồi, núi, thung lũng, đảo, hỗn hợp.' },
] as const;
export type MapTemplate = typeof MAP_TEMPLATES[number]['id'];

export interface NewMapRequest {
  template: MapTemplate;
  name: string;
  kind: MapKind;
  description?: string;
  size: number;
  seed: string;
  preset: TerrainPreset;
  maxHeight?: number;
  roughness?: number;
  detail?: number;
  seaEdge?: boolean;
  /** Template 'auto': what to put on the map. */
  auto?: AutoParams;
}

/**
 * Builds a new map, yielding progress (0..1). The live island is sampled from the game's own
 * WorldGenerator, so its heights, surfaces, roads and building pads are the ones players walk on.
 */
export function* buildNewMap(req: NewMapRequest, registry: AssetRegistry): Generator<number, { doc: WorldMapDoc; terrain: Heightfield }> {
  if (req.template === 'hac-son') return yield* islandTemplate(req, registry);
  if (req.template === 'auto') return yield* autoMap(req, registry);
  const settings = { ...defaultTerrainSettings(req.preset, req.seed, req.size) };
  if (req.maxHeight !== undefined) settings.maxHeight = req.maxHeight;
  if (req.roughness !== undefined) settings.roughness = req.roughness;
  if (req.detail !== undefined) settings.detail = req.detail;
  if (req.seaEdge !== undefined) settings.seaEdge = req.seaEdge || req.preset === 'island';
  const terrain = new Heightfield(settings.size, settings.cell);
  if (req.template === 'blank') { terrain.heights.fill(settings.seaLevel + 10); terrain.surface.fill(0); yield 1; }
  else yield* generateTerrain(settings, terrain);
  const doc = createMapDoc({ name: req.name, kind: req.kind, description: req.description, template: req.template === 'blank' ? 'blank' : req.preset, terrain: settings });
  return { doc, terrain };
}

function* islandTemplate(req: NewMapRequest, registry: AssetRegistry): Generator<number, { doc: WorldMapDoc; terrain: Heightfield }> {
  const gen = new WorldGenerator({ seed: normalizeSeed(BATTLE_MAP.seed), sizeChunks: BATTLE_MAP.sizeChunks, mode: 'battle-royale' }, registry);
  const size = gen.worldSize, settings = { ...defaultTerrainSettings('island', BATTLE_MAP.seed, size), seaLevel: gen.seaLevel };
  const terrain = new Heightfield(size, settings.cell), sample = makeColumnSample(), c = settings.cell;
  for (let j = 0; j < terrain.rows; j++) {
    for (let i = 0; i < terrain.cols; i++) {
      const x = i * c, z = j * c, s = gen.sampleColumn(x, z, sample), k = j * terrain.cols + i;
      terrain.heights[k] = s.height;
      // Slope from the neighbours already sampled (left and above).
      const hl = i ? terrain.heights[k - 1]! : s.height, hu = j ? terrain.heights[k - terrain.cols]! : s.height;
      const slope = Math.hypot(s.height - hl, s.height - hu) / c;
      terrain.surface[k] = gen.classifySurface(s, gen.classifyBiome(s, slope), slope, x, z);
    }
    if (j % 16 === 15) yield (j + 1) / terrain.rows * .95;
  }
  const world = authoredWorld(gen);
  const roads = world.map.roads.map((r) => ({ points: r.points.map((p) => [p[0], p[1]] as Vec2), width: r.width, paved: r.paved }));
  const structures = world.structures().filter((s) => s.parts.length && !(s as { decal?: boolean }).decal).map((s) => ({ x: s.x, z: s.z, yaw: s.yaw, hx: s.halfX ?? s.radius * .7, hz: s.halfZ ?? s.radius * .7 }));
  yield .98;
  const doc = createMapDoc({ name: req.name, kind: req.kind, description: req.description ?? 'Bản sao chỉnh sửa được của Đảo Hắc Sơn.', template: 'hac-son', terrain: settings, base: { roads, structures } });
  const br = doc.gameplay[0]!;
  br.name = 'Battle Royale — luật hiện hành';
  br.pois = world.areas().map((a) => ({ id: a.id, name: a.name, kind: a.kind, x: a.x, z: a.z, radius: a.radius }));
  // The busiest places draw the most fights.
  br.hotspots = world.areas().filter((a) => a.kind === 'military' || a.kind === 'town' || a.kind === 'port' || a.kind === 'airfield')
    .map((a) => ({ id: `hot-${a.id}`, name: a.name, x: a.x, z: a.z, radius: Math.round(a.radius * 1.1), danger: a.kind === 'military' ? 5 : 4 }));
  br.loot.points = world.lootSpots().slice(0, 4000).map((p, i) => ({ id: `lt${i}`, x: Math.round(p.x * 10) / 10, z: Math.round(p.z * 10) / 10, category: (['weapons', 'ammo', 'medical', 'food', 'armor', 'tools'] as const)[i % 6]!, tier: 1 }));
  yield 1;
  return { doc, terrain };
}
