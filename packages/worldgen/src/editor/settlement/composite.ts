import { Rng, hashString } from '@zion/shared';
import type { CampPart } from '../../camp';
import { modularBuilding } from '../../battle-map';
import { constructionSite, masonryBuilding } from '../../masonry';
import type { LotClass } from './presets';

/**
 * Buildings assembled from the game's building kits (brick courses, concrete panels, modular
 * enterable blocks) instead of one model: multi-storey flats, offices, barracks, building sites.
 * Only the recipe is stored; the parts are rebuilt from it wherever they are drawn, so a city of
 * hundreds of buildings stays a small document.
 */
export interface CompositeRecipe {
  kind: 'brick' | 'concrete' | 'modular' | 'site';
  w: number;
  d: number;
  floors: number;
  finish?: 'ivory' | 'gray' | 'darkred';
  seed: number;
}

/** A recipe with its footprint (m, along local x and z; local +z faces the street). */
export interface CompositeOption { recipe: CompositeRecipe; w: number; d: number; height: number }

const FINISHES = ['ivory', 'gray', 'darkred'] as const;

/** The kit buildings a lot of this class could take, biggest first. `tall` (0..1) favours storeys. */
export function compositeOptions(cls: LotClass, rng: Rng, tall: number, availW: number, availD: number): CompositeOption[] {
  const out: CompositeOption[] = [];
  const seed = rng.nextU32();
  const add = (kind: CompositeRecipe['kind'], w: number, d: number, floors: number, finish?: CompositeRecipe['finish']) => {
    // Modular blocks carry a front balcony 4 m deep.
    const fd = kind === 'modular' ? d + 4 : d;
    if (w <= availW && fd <= availD) out.push({ recipe: { kind, w, d, floors, finish, seed }, w, d: fd, height: floors * 3.2 + 1 });
  };
  const floors = (lo: number, hi: number) => lo + Math.floor(rng.next() * (hi - lo + 1) * (.4 + tall * .6));
  const finish = FINISHES[Math.floor(rng.next() * 3)]!;
  if (cls === 'commercial') {
    for (const w of [24, 18, 12]) add('concrete', w, 12, Math.max(3, floors(3, 9)), finish);
    add('brick', 12, 10, floors(2, 3));
    if (rng.next() < .12) add('site', 18, 12, 3);
  } else if (cls === 'residential') {
    for (const w of [12, 10, 8]) add('brick', w, w === 8 ? 8 : 10, Math.max(1, floors(1, 3)));
    if (tall > .5) add('concrete', 18, 12, Math.max(3, floors(3, 6)), finish);
  } else if (cls === 'military') {
    add('modular', 12, 12, Math.max(2, floors(2, 5)));
    add('concrete', 18, 12, Math.max(2, floors(2, 4)), 'gray');
    add('concrete', 12, 12, 2, 'gray');
  } else {
    add('concrete', 24, 12, Math.max(1, floors(1, 3)), 'gray');
    add('concrete', 18, 12, 1, finish);
    if (rng.next() < .2) add('site', 18, 12, 2);
  }
  return out;
}

/** World-space parts of a kit building whose footprint centre is (x, z), facing yaw (+z to the street). */
export function compositeParts(r: CompositeRecipe, x: number, z: number, yaw: number): CampPart[] {
  const parts: CampPart[] = [];
  // The kits build with their front at local −z: turn them round to face the street.
  const turn = yaw + Math.PI;
  const rng = new Rng(r.seed ^ hashString(r.kind));
  if (r.kind === 'modular') {
    // Body 12 × 12 centred on its origin, balcony 4 m out in front: shift so the footprint is centred.
    const ox = Math.sin(yaw) * -2, oz = Math.cos(yaw) * -2;
    modularBuilding(parts, x + ox, z + oz, r.floors, 1, false, turn, r.seed);
  } else if (r.kind === 'site') constructionSite(parts, [], x, z, turn, 1, rng);
  else masonryBuilding(parts, [], x, z, turn, { material: r.kind, finish: r.finish, w: r.w, d: r.d, floors: r.floors }, 1, rng);
  return parts;
}
