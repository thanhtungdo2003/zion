import type { AssetRegistry } from '@zion/assets';
import { lotFitFromLegacy, type LotFit } from '@zion/shared';
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
  /** Published from the Model Studio (the generator prefers these where they fit). */
  studio?: boolean;
}

export type PropKind = 'sign' | 'trafficLight' | 'quay' | 'pier' | 'pile' | 'breakwater' | 'crane' | 'container' | 'bollard' | 'hedge' | 'crop' | 'wall' | 'tree' | 'deadTree' | 'bush' | 'fence' | 'perimeter' | 'lamp' | 'vehicle' | 'militaryVehicle' | 'clutter' | 'industrialClutter' | 'militaryClutter' | 'bench' | 'debris';

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
  // Road furniture: stop, give way, 50, 80, curves, crossing, zombies, danger, one way (SIGN_ASSET).
  sign: [2720, 2721, 2722, 2723, 2724, 2725, 2726, 2727, 2728, 2729],
  trafficLight: [2691, 2692, 2693],
  // Harbour: deck slabs, steel piles, breakwater boulders, the tower crane, containers, bollards.
  quay: [2100, 2101],
  pier: [2104, 2105],
  pile: [2106],
  breakwater: [2468, 2469, 2470, 2465, 2466],
  crane: [2432],
  container: [2213, 2214, 2408],
  bollard: [2685],
  hedge: [2460, 2461, 2462],
  crop: [2460, 2462],
};

export interface Catalog {
  /** The built-in houses by lot class ('abandoned': run-down houses for abandoned residential lots). */
  buildings: Record<LotClass | 'abandoned', CatalogItem[]>;
  /** Houses from the Model Studio, each with where it fits (lot classes, conditions, kinds of area). */
  studio?: Array<CatalogItem & { fit: LotFit }>;
  /** No brick / concrete kit buildings: whole models only (built-in houses and the Model Studio's). */
  noKits?: boolean;
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
  return { asset, name: a.name, w: x1 - x0, d: z1 - z0, ox: (x0 + x1) / 2, oz: (z0 + z1) / 2, height: a.bounds.height, ...(a.tags.includes('model-studio') ? { studio: true } : {}) };
}

/**
 * The generator's models: the built-in houses and those published from the Model Studio (in the
 * lot class they were published for). `noKits`: no storeyed buildings assembled from brick /
 * concrete wall panels, only whole models.
 */
export function buildCatalog(registry: AssetRegistry, opts: { noKits?: boolean } = {}): Catalog {
  const byAsset = new Map<number, CatalogItem>();
  const take = (ids: number[]) => ids.flatMap((id) => {
    const item = byAsset.get(id) ?? measure(registry, id);
    if (!item) return [];
    byAsset.set(id, item);
    return [item];
  });
  const buildings = Object.fromEntries(Object.entries(BUILDINGS).map(([k, ids]) => [k, take(ids).sort((a, b) => b.w * b.d - a.w * a.d)])) as Catalog['buildings'];
  // Houses from the Model Studio with where they fit. Older ones: their single lot class tag; none
  // at all: an intact house on residential and commercial lots. Vehicles and other structures
  // from the Studio are not houses.
  // A house is what was published as a building or given a place on lots — or, whatever kind it
  // was left as (new projects start as "prop"), anything with doors, or the size of a house.
  const NOT_HOUSE = ['kind:vehicle', 'kind:furniture', 'kind:vegetation', 'kind:rock', 'kind:weapon'];
  const studio = registry.all().filter((a) => a.tags.includes('model-studio') && (a.fit || !a.tags.some((t) => NOT_HOUSE.includes(t)))).flatMap((a) => {
    const item = take([a.numericId])[0];
    if (!item) return [];
    const building = a.fit || a.tags.includes('kind:building') || (a.category === 'structure' && !a.tags.some((t) => t.startsWith('kind:'))) || a.doors?.length || (a.bounds.height >= 2.4 && item.w >= 3.5 && item.d >= 3.5);
    if (!building) return [];
    const fit: LotFit = a.fit ?? lotFitFromLegacy(a.tags.find((t) => t.startsWith('lot:'))?.slice(4)) ?? { lots: ['residential', 'commercial'], conditions: ['intact'], areas: [] };
    return [{ ...item, fit }];
  });
  const props = Object.fromEntries(Object.entries(PROPS).map(([k, ids]) => [k, take(ids)])) as Catalog['props'];
  return { buildings, studio, props, byAsset, ...(opts.noKits ? { noKits: true } : {}) };
}
