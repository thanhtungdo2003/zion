import type { AssetRegistry } from '@zion/assets';

interface Part { asset: number; x: number; y: number; z: number; yaw: number; scale: number }
interface Site { x: number; y: number; z: number; yaw: number; parts: Part[] }
export interface LootSpot { x: number; y: number; z: number }

interface Box { cx: number; cz: number; hx: number; hz: number; yaw: number; y0: number; y1: number }

const inside = (b: Box, x: number, z: number, pad = 0) => {
  const dx = x - b.cx, dz = z - b.cz, c = Math.cos(b.yaw), s = Math.sin(b.yaw);
  // Into the box's own axes (the inverse of x = cx + lx·c + lz·s, z = cz − lx·s + lz·c).
  const lx = dx * c - dz * s, lz = dx * s + dz * c;
  return Math.abs(lx) <= b.hx + pad && Math.abs(lz) <= b.hz + pad;
};

/**
 * Where loose loot may lie inside a building model (in its own frame): on the floors — the
 * ground floor and every storey slab — and on tables, shelves and counters, wherever there is
 * head room and a ceiling or roof overhead (so outside, under the eaves, nothing). Read from the
 * model's box colliders, so it works for any building published from the Model Studio.
 */
export function buildingSurfaces(boxes: readonly Box[], step = 2.2): LootSpot[] {
  if (boxes.length < 3) return [];
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const b of boxes) { const r = Math.hypot(b.hx, b.hz); x0 = Math.min(x0, b.cx - r); x1 = Math.max(x1, b.cx + r); z0 = Math.min(z0, b.cz - r); z1 = Math.max(z1, b.cz + r); }
  if (x1 - x0 < 3.5 || z1 - z0 < 3.5) return [];
  const out: LootSpot[] = [];
  for (let x = x0 + step / 2; x < x1; x += step) for (let z = z0 + step / 2; z < z1; z += step) {
    const here = boxes.filter((b) => inside(b, x, z));
    // The ground and the tops of whatever stands here (slabs, tables, counters, shelves).
    const levels = [0, ...here.map((b) => b.y1).filter((y) => y > .3)];
    for (const y of levels) {
      // Clear above it for a body's height (a table top: half that, it is reached from beside).
      const table = here.some((b) => Math.abs(b.y1 - y) < .02 && b.y1 - b.y0 < 1.3 && b.hx * b.hz < 2.5);
      const room = table ? .45 : 1.6;
      if (here.some((b) => b.y0 < y + room && b.y1 > y + .05)) continue;
      // A ceiling or roof overhead: indoors.
      if (!here.some((b) => b.y0 >= y + room && b.y0 < y + 6)) continue;
      // Not right against a wall (an item half in it): some clearance round the point.
      if (!table && boxes.some((b) => b.y0 < y + 1 && b.y1 > y + .05 && inside(b, x, z, .35))) continue;
      out.push({ x, y: y + .08, z });
    }
  }
  return out;
}

const cache = new Map<number, LootSpot[]>();
function modelSpots(registry: AssetRegistry, asset: number): LootSpot[] {
  let spots = cache.get(asset);
  if (spots) return spots;
  const def = registry.byNumericId(asset);
  spots = [];
  if (def && def.category === 'structure') {
    const boxes: Box[] = [];
    for (const c of def.colliders) if (c.type === 'box') boxes.push({ cx: c.center[0], cz: c.center[2], hx: c.halfExtents[0], hz: c.halfExtents[2], yaw: c.yaw ?? 0, y0: c.center[1] - c.halfExtents[1], y1: c.center[1] + c.halfExtents[1] });
    spots = buildingSurfaces(boxes);
  }
  cache.set(asset, spots);
  return spots;
}

/** Floor and table spots in the buildings of a map (world coordinates), a few per building. */
export function buildingLootSpots(registry: AssetRegistry, sites: readonly Site[], perBuilding = 6, random: () => number = Math.random): LootSpot[] {
  const out: LootSpot[] = [];
  for (const site of sites) {
    const sc = Math.cos(site.yaw), ss = Math.sin(site.yaw);
    for (const p of site.parts) {
      const local = modelSpots(registry, p.asset);
      if (!local.length) continue;
      const px = site.x + p.x * sc + p.z * ss, pz = site.z - p.x * ss + p.z * sc, py = site.y + p.y, yaw = site.yaw + p.yaw;
      const c = Math.cos(yaw), s = Math.sin(yaw);
      // A few of its spots, at random, so every match is different.
      const pick = [...local].sort(() => random() - .5).slice(0, Math.max(2, Math.min(perBuilding, Math.ceil(local.length / 4))));
      for (const l of pick) {
        const lx = l.x * p.scale, lz = l.z * p.scale;
        out.push({ x: px + lx * c + lz * s, y: py + l.y * p.scale, z: pz - lx * s + lz * c });
      }
    }
  }
  return out;
}
