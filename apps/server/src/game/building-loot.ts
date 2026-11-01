import { isStudioModelAsset, type AssetRegistry } from '@zion/assets';
import type { HitMesh } from '@zion/physics';

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
 * Where loose loot may lie in a building model (in its own frame): on the floors — the ground
 * floor and every storey slab — and on tables, shelves and counters, wherever there is head room
 * and a ceiling or roof overhead (so outside, under the eaves, nothing); and on flat roofs
 * (open above, a broad slab up a storey or more). Read from the model's box colliders, so it
 * works for any building published from the Model Studio.
 */
export function buildingSurfaces(boxes: readonly Box[], step = 2.2): LootSpot[] {
  if (boxes.length < 3) return [];
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const b of boxes) { const r = Math.hypot(b.hx, b.hz); x0 = Math.min(x0, b.cx - r); x1 = Math.max(x1, b.cx + r); z0 = Math.min(z0, b.cz - r); z1 = Math.max(z1, b.cz + r); }
  if (x1 - x0 < 3.5 || z1 - z0 < 3.5) return [];
  // Boxes bucketed on a 4 m grid: a whole district (thousands of wall pieces) reads quickly.
  const G = 4, gw = Math.ceil((x1 - x0) / G) + 1, grid = new Map<number, Box[]>();
  for (const b of boxes) {
    const r = Math.hypot(b.hx, b.hz) + .4;
    for (let gx = Math.floor((b.cx - r - x0) / G); gx <= Math.floor((b.cx + r - x0) / G); gx++)
      for (let gz = Math.floor((b.cz - r - z0) / G); gz <= Math.floor((b.cz + r - z0) / G); gz++) {
        const k = gz * gw + gx; let l = grid.get(k); if (!l) grid.set(k, l = []); l.push(b);
      }
  }
  const out: LootSpot[] = [];
  for (let x = x0 + step / 2; x < x1; x += step) for (let z = z0 + step / 2; z < z1; z += step) {
    const near = grid.get(Math.floor((z - z0) / G) * gw + Math.floor((x - x0) / G));
    if (!near) continue;
    const here = near.filter((b) => inside(b, x, z));
    // The ground and the tops of whatever stands here (slabs, tables, counters, shelves).
    const levels = [0, ...here.map((b) => b.y1).filter((y) => y > .3)];
    for (const y of levels) {
      // Clear above it for a body's height (a table top: half that, it is reached from beside).
      const table = here.some((b) => Math.abs(b.y1 - y) < .02 && b.y1 - b.y0 < 1.3 && b.hx * b.hz < 2.5);
      const room = table ? .45 : 1.6;
      if (here.some((b) => b.y0 < y + room && b.y1 > y + .05)) continue;
      // A ceiling or roof overhead: indoors. Open above: only a flat roof (a broad slab, a storey up).
      const roof = !here.some((b) => b.y0 >= y + room);
      if (roof ? !(y > 2.2 && here.some((b) => Math.abs(b.y1 - y) < .02 && b.hx > 1.2 && b.hz > 1.2 && inside(b, x, z, -.5))) : !here.some((b) => b.y0 >= y + room && b.y0 < y + 6)) continue;
      // Not right against a wall (an item half in it): some clearance round the point.
      if (!table && near.some((b) => b.y0 < y + 1 && b.y1 > y + .05 && inside(b, x, z, .35))) continue;
      out.push({ x, y: y + .08, z });
    }
  }
  return out;
}

/**
 * The same for a building known by its own triangles (a Model Studio house collides as its mesh,
 * one box round it): down each column of a 2 m grid, every flat surface it meets — the ground
 * floor (the model stands on y = 0), storey floors, stair landings, the roof — with a body's room
 * above it (no triangle within a standing capsule) and a ceiling overhead, or open sky on a flat
 * roof a storey up.
 */
export function meshSurfaces(mesh: HitMesh, step = 2): LootSpot[] {
  const box = mesh.bounds();
  if (!box || box.maxX - box.minX < 3 || box.maxZ - box.minZ < 3) return [];
  const out: LootSpot[] = [], n = { x: 0, y: 0, z: 0 };
  // Not quite vertical: an exact zero direction makes the ray's slab test divide 0 by 0.
  const down = (x: number, y: number, z: number) => mesh.raycast(x, y, z, 1e-6, -1, 1e-6, y - box.minY + .5, n);
  const free = (x: number, y: number, z: number) => { let clear = true; mesh.capsuleContacts(x, y + .42, z, x, y + 1.35, z, .35, () => (clear = false)); return clear; };
  for (let x = box.minX + step / 2; x < box.maxX; x += step) for (let z = box.minZ + step / 2; z < box.maxZ; z += step) {
    // Every surface down the column, top first: its height and whether it is flat.
    const hits: Array<{ y: number; flat: boolean }> = [];
    for (let y = box.maxY + .5, k = 0; k < 16; k++) {
      const t = down(x, y, z);
      if (t < 0) break;
      hits.push({ y: y - t, flat: Math.abs(n.y) > .9 });
      y -= t + .02;
    }
    if (!hits.length) continue;
    const levels = hits.filter((h) => h.flat && h.y > box.minY - .05);
    // The ground floor: the ground it stands on, where the model has no floor of its own.
    if (!hits.some((h) => Math.abs(h.y) < .3)) levels.push({ y: 0, flat: true });
    for (const { y } of levels) {
      const above = hits.filter((h) => h.y > y + .05).at(-1)?.y ?? Infinity;
      if (above - y < 1.7) continue;
      if (!Number.isFinite(above) ? y < 2.2 : above - y > 6) continue;
      if (!free(x, y, z)) continue;
      out.push({ x, y: y + .08, z });
    }
  }
  return out;
}

const boxCache = new Map<number, Box[]>();
/** A model's box colliders in its own frame (cached per model). */
function modelBoxes(registry: AssetRegistry, asset: number): Box[] {
  let boxes = boxCache.get(asset);
  if (boxes) return boxes;
  const def = registry.byNumericId(asset);
  boxes = [];
  if (def && (def.category === 'structure' || def.category === 'block'))
    for (const c of def.colliders) if (c.type === 'box') boxes.push({ cx: c.center[0], cz: c.center[2], hx: c.halfExtents[0], hz: c.halfExtents[2], yaw: c.yaw ?? 0, y0: c.center[1] - c.halfExtents[1], y1: c.center[1] + c.halfExtents[1] });
  boxCache.set(asset, boxes);
  return boxes;
}

const meshCache = new WeakMap<HitMesh, LootSpot[]>();
/** A whole house model's floors read from its triangles (cached per mesh; null: no triangles). */
function meshSpots(asset: number, meshOf: (asset: number) => HitMesh | undefined): LootSpot[] | null {
  const mesh = meshOf(asset);
  if (!mesh) return null;
  let spots = meshCache.get(mesh);
  if (!spots) meshCache.set(mesh, spots = meshSurfaces(mesh));
  return spots;
}

/**
 * Floor, table and doorstep spots for the loot of a map, a few per building (world coordinates).
 *
 * A building is read whole: the colliders of every part of a site (the walls, slabs and roof of a
 * kit building are separate parts, a Model Studio house is one model) are put together in the
 * site's frame, and the rooms are found in that; the loot is shared out over its storeys and
 * flat roof, and now and then a piece lies on the ground by its walls. A building with no room to
 * enter (a solid house, a ruin without a roof) gets its loot on the ground round it instead, so
 * every building of the map has some.
 */
export function buildingLootSpots(registry: AssetRegistry, sites: readonly Site[], perBuilding = 6, random: () => number = Math.random, ground?: (x: number, z: number) => number, meshOf?: (asset: number) => HitMesh | undefined): LootSpot[] {
  const out: LootSpot[] = [];
  for (const site of sites) {
    // `boxes`: the whole building (its extent); `rooms`: the boxes read for rooms, `found`: floors
    // read from the triangles of whole house models (in the site's frame).
    const boxes: Box[] = [], rooms: Box[] = [], found: LootSpot[] = [];
    for (const p of site.parts) {
      const own = modelBoxes(registry, p.asset);
      if (!own.length) continue;
      const c = Math.cos(p.yaw), sn = Math.sin(p.yaw);
      const placed = own.map((b) => ({ cx: p.x + (b.cx * c + b.cz * sn) * p.scale, cz: p.z + (-b.cx * sn + b.cz * c) * p.scale, hx: b.hx * p.scale, hz: b.hz * p.scale, yaw: b.yaw + p.yaw, y0: p.y + b.y0 * p.scale, y1: p.y + b.y1 * p.scale }));
      boxes.push(...placed);
      const spots = (isStudioModelAsset(p.asset) || own.length < 3) && meshOf ? meshSpots(p.asset, meshOf) : null;
      if (!spots) { rooms.push(...placed); continue; }
      for (const l of spots) found.push({ x: p.x + (l.x * c + l.z * sn) * p.scale, y: p.y + l.y * p.scale, z: p.z + (-l.x * sn + l.z * c) * p.scale });
    }
    if (!boxes.length) continue;
    const sc = Math.cos(site.yaw), ss = Math.sin(site.yaw);
    const world = (l: LootSpot) => ({ x: site.x + l.x * sc + l.z * ss, y: site.y + l.y, z: site.z - l.x * ss + l.z * sc });
    // On the ground round it: just outside its walls, on the levelled ground.
    const outside = (n: number) => {
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const b of boxes) { const r = Math.hypot(b.hx, b.hz); x0 = Math.min(x0, b.cx - r); x1 = Math.max(x1, b.cx + r); z0 = Math.min(z0, b.cz - r); z1 = Math.max(z1, b.cz + r); }
      if (x1 - x0 < 2.5 || z1 - z0 < 2.5) return;
      for (let k = 0; k < n; k++) {
        const side = Math.floor(random() * 4), t = random() * .8 + .1;
        const lx = side < 2 ? x0 + (x1 - x0) * t : side === 2 ? x0 - 1.1 : x1 + 1.1;
        const lz = side >= 2 ? z0 + (z1 - z0) * t : side === 0 ? z0 - 1.1 : z1 + 1.1;
        const w = world({ x: lx, y: 0, z: lz });
        out.push({ x: w.x, y: (ground ? ground(w.x, w.z) : site.y) + .08, z: w.z });
      }
    };
    const inside = [...buildingSurfaces(rooms), ...found];
    if (inside.length) {
      // A few spots per building, at random, so every match is different (a site holding a
      // whole village gets as many as its buildings would).
      const buildings = Math.max(1, site.parts.filter((p) => modelBoxes(registry, p.asset).length > 2).length / 8, site.parts.filter((p) => isStudioModelAsset(p.asset) && modelBoxes(registry, p.asset).length).length);
      const count = Math.max(2, Math.min(Math.round(perBuilding * buildings), Math.ceil(inside.length / 4)));
      // Shared out over the storeys (ground floor, upper floors, the roof) so each gets its turn.
      const floors = new Map<number, LootSpot[]>();
      for (const l of [...inside].sort(() => random() - .5)) { const f = Math.round(l.y / 2.6); let a = floors.get(f); if (!a) floors.set(f, a = []); a.push(l); }
      const levels = [...floors.values()];
      for (let n = 0, i = 0; n < count && levels.some((a) => a.length); i++) {
        const l = levels[i % levels.length]!.pop();
        if (l) { out.push(world(l)); n++; }
      }
      outside(Math.floor(random() * 2));
      continue;
    }
    // No room to enter: on the ground round it.
    outside(1 + Math.floor(random() * 2));
  }
  return out;
}
