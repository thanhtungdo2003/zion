import type { AssetRegistry } from '@zion/assets';
import type { LotClass } from './presets';

/** A model the generator can place, with its footprint measured from the asset's colliders. */
export interface CatalogItem {
  asset: number;
  name: string;
  /** Footprint extents (m) along the model's local x and z; local +z faces the street. */
  w: number;
  d: number;
  /** Offset of the footprint centre from the model origin (local x, z). */
  ox: number;
  oz: number;
  height: number;
}

export type PropKind = 'hedge' | 'crop' | 'wall' | 'tree' | 'deadTree' | 'bush' | 'fence' | 'perimeter' | 'lamp' | 'vehicle' | 'militaryVehicle' | 'clutter' | 'industrialClutter' | 'militaryClutter' | 'bench' | 'debris';

/** Real asset ids per building class (see packages/assets: imported buildings, battle kit, camp). */
const BUILDINGS: Record<LotClass | 'abandoned', number[]> = {
  residential: [2402, 2403, 2404, 2200, 2201, 2420],
  commercial: [2421, 2201, 2420, 2403, 2200],
  industrial: [2400, 2401, 2213, 2214, 2408, 2409, 2411, 2410],
  military: [2407, 2406, 2405, 2007, 2408, 2213, 2214, 2410],
  abandoned: [2402, 2404, 2200, 2422, 2423, 2420],
};
const PROPS: Record<PropKind, number[]> = {
  tree: [2440, 2441, 2442, 2443, 2444, 2445, 2446, 2447, 2448, 2449],
  deadTree: [2452, 2453],
  bush: [2460, 2461, 2462],
  fence: [2028, 2413],
  perimeter: [2000, 2024],
  lamp: [2040],
  vehicle: [2526, 2111],
  militaryVehicle: [2038, 2039],
  clutter: [2003, 2017, 2011],
  industrialClutter: [2661, 2662, 2663, 2660, 2667, 2003],
  militaryClutter: [2002, 2024, 2003, 2681],
  bench: [2537, 2412],
  debris: [2031, 2682],
  wall: [2034, 2008, 2033],
  hedge: [2460, 2461, 2462],
  crop: [2460, 2462],
};

export interface Catalog {
  buildings: Record<LotClass | 'abandoned', CatalogItem[]>;
  props: Record<PropKind, CatalogItem[]>;
  byAsset: Map<number, CatalogItem>;
}

export function measure(registry: AssetRegistry, asset: number): CatalogItem | null {
  const a = registry.byNumericId(asset);
  if (!a) return null;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const c of a.colliders) {
    if (c.type !== 'box') continue;
    const yaw = c.yaw ?? 0, co = Math.cos(yaw), s = Math.sin(yaw);
    for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      const lx = u * c.halfExtents[0], lz = v * c.halfExtents[2];
      const x = c.center[0] + lx * co + lz * s, z = c.center[2] - lx * s + lz * co;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
    }
  }
  // Trees and bushes have no box: a square inside their crown radius keeps the trunks apart.
  if (!Number.isFinite(x0)) { const r = a.bounds.radius * .45; x0 = z0 = -r; x1 = z1 = r; }
  return { asset, name: a.name, w: x1 - x0, d: z1 - z0, ox: (x0 + x1) / 2, oz: (z0 + z1) / 2, height: a.bounds.height };
}

export function buildCatalog(registry: AssetRegistry): Catalog {
  const byAsset = new Map<number, CatalogItem>();
  const take = (ids: number[]) => ids.flatMap((id) => {
    const item = byAsset.get(id) ?? measure(registry, id);
    if (!item) return [];
    byAsset.set(id, item);
    return [item];
  });
  const buildings = Object.fromEntries(Object.entries(BUILDINGS).map(([k, ids]) => [k, take(ids).sort((a, b) => b.w * b.d - a.w * a.d)])) as Catalog['buildings'];
  const props = Object.fromEntries(Object.entries(PROPS).map(([k, ids]) => [k, take(ids)])) as Catalog['props'];
  return { buildings, props, byAsset };
}
