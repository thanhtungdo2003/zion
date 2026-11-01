import type { AuthoredMap } from '../maps/island';
import { compositeParts } from './settlement/composite';
import type { WorldMapDoc } from './document';
import { quantizeHeight } from '@zion/shared';
import { bytesToBase64, encodeHeights, type Heightfield } from './heightfield';
import { rasterizeWater } from './water';

/**
 * A World Studio map as the game's battle royale generator reads it (`battleIsland`): the
 * edited height grid, every road, every building (models and storeyed kit buildings) on its
 * levelled pad, every prop and harbour piece on the ground or the water, and the vegetation.
 * Points of interest become the map's named areas.
 */
export function toBattleMap(doc: WorldMapDoc, hf: Heightfield): AuthoredMap {
  const size = hf.size, edge = 2;
  const placed: NonNullable<AuthoredMap['placed']> = [];
  const roads: AuthoredMap['roads'] = doc.base.roads.map((r) => ({ points: r.points.map(([x, z]) => [clamp(x, size), clamp(z, size)] as const), width: Math.min(40, Math.max(2, r.width)), paved: r.paved }));
  for (const region of doc.regions) {
    const r = region.result;
    if (!r) continue;
    for (const road of r.roads) roads.push({ points: road.points.map(([x, z]) => [clamp(x, size), clamp(z, size)] as const), width: Math.min(40, Math.max(2, road.width)), paved: road.kind !== 'alley' || r.settings.decay < .6 });
    for (const b of r.buildings) {
      const parts = b.recipe
        ? compositeParts(b.recipe, b.obb.x, b.obb.z, b.yaw).map((p) => ({ asset: p.asset, x: rotX(p.x - b.obb.x, p.z - b.obb.z, b.yaw), y: p.y, z: rotZ(p.x - b.obb.x, p.z - b.obb.z, b.yaw), yaw: p.yaw - b.yaw, scale: p.scale }))
        : [{ asset: b.asset, x: rotX(b.x - b.obb.x, b.z - b.obb.z, b.yaw), y: 0, z: rotZ(b.x - b.obb.x, b.z - b.obb.z, b.yaw), yaw: 0, scale: 1 }];
      placed.push({ x: b.obb.x, z: b.obb.z, y: b.y, yaw: b.yaw, radius: Math.hypot(b.obb.hx, b.obb.hz) + 1, halfX: b.obb.hx + 1, halfZ: b.obb.hz + 1, parts });
    }
    for (const p of r.props) {
      // Props on water (decks, piles, breakwaters) keep their absolute height; the rest follow the ground.
      const raised = p.kind === 'quay' || p.kind === 'pier' || p.kind === 'bollard' || p.kind === 'pile' || p.kind === 'breakwater' || p.y > hf.heightAt(p.x, p.z) + .3;
      placed.push({ x: p.x, z: p.z, y: 0, yaw: 0, radius: .5, decal: true, parts: [{ asset: p.asset, x: 0, y: raised ? p.y : 0, z: 0, yaw: p.yaw, scale: p.scale }] });
    }
  }
  const g = doc.gameplay.find((x) => x.id === doc.activeGameplay);
  const water = rasterizeWater(hf, doc.water);
  return {
    id: `studio-${doc.meta.id}`.slice(0, 80),
    name: doc.meta.name,
    coast: [[edge, edge], [size - edge, edge], [size - edge, size - edge], [edge, size - edge]],
    hills: [], forests: [], power: [],
    zones: (g?.pois ?? []).slice(0, 128).map((p, i) => ({ id: `poi${i}`, name: p.name.slice(0, 120), kind: 'village' as const, x: clamp(p.x, size), z: clamp(p.z, size), radius: Math.max(10, Math.min(2000, p.radius)) })),
    roads: roads.slice(0, 256).map((r) => ({ ...r, points: r.points.slice(0, 2048) })),
    terrainGrid: { size, cell: hf.cell, data: encodeHeights(hf.heights) },
    surfaceGrid: bytesToBase64(hf.surface),
    waterGrid: waterGrid(water, hf),
    moistureGrid: moistureGrid(water, doc.terrain.seaLevel, hf),
    ...(g?.vehicles !== undefined ? { vehicles: g.vehicles } : {}),
    climate: doc.terrain.climate ?? 'temperate',
    placed,
    flora: doc.flora.map((f) => [f[0], f[1], f[2], f[3], f[4]] as [number, number, number, number, number]),
  };
}
/**
 * How close each 16 m cell is to water (sea, lakes, rivers, marsh): 255 on the shore, fading to 0
 * about 110 m inland. In a dry climate only this ground stays green.
 */
export const MOISTURE_CELL = 16;
type WaterRaster = ReturnType<typeof rasterizeWater>;
function moistureGrid(water: WaterRaster, seaLevel: number, hf: Heightfield): string {
  const n = Math.ceil(hf.size / MOISTURE_CELL) + 1, dist = new Float32Array(n * n).fill(1e9);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = Math.min(hf.size, i * MOISTURE_CELL), z = Math.min(hf.size, j * MOISTURE_CELL);
    const k = hf.clampJ(Math.round(z / hf.cell)) * hf.cols + hf.clampI(Math.round(x / hf.cell)), ground = hf.heights[k]!;
    if (ground < seaLevel || water.level[k]! > ground || hf.surfaceAt(x, z) === 7 /* Mud */) dist[j * n + i] = 0;
  }
  // Two-pass chamfer distance transform (metres).
  const d1 = MOISTURE_CELL, d2 = MOISTURE_CELL * Math.SQRT2;
  const relax = (k: number, o: number, w: number) => { const v = dist[o]! + w; if (v < dist[k]!) dist[k] = v; };
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
  const out = new Uint8Array(n * n);
  for (let k = 0; k < out.length; k++) { const t = Math.max(0, 1 - dist[k]! / 110); out[k] = Math.round(t * t * 255); }
  return bytesToBase64(out);
}

/** The lakes and rivers per height-grid vertex as the game reads them (AuthoredMap.waterGrid). */
function waterGrid(water: WaterRaster, hf: Heightfield): string {
  const out = new Uint16Array(water.level.length);
  for (let k = 0; k < out.length; k++) {
    const l = water.level[k]!;
    // Only where it stands over the ground (or would at the cell's edge): the rest stays dry.
    if (l === l && l > hf.heights[k]! - .5) out[k] = Math.max(2, quantizeHeight(l) & ~1) | water.lake[k]!;
  }
  return bytesToBase64(new Uint8Array(out.buffer));
}

const clamp = (v: number, size: number) => Math.max(0, Math.min(size, v));
// World offset → site-local (inverse of the three.js yaw the game applies).
const rotX = (dx: number, dz: number, yaw: number) => dx * Math.cos(yaw) - dz * Math.sin(yaw);
const rotZ = (dx: number, dz: number, yaw: number) => dx * Math.sin(yaw) + dz * Math.cos(yaw);
