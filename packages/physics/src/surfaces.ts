import { Surface } from '@zion/shared';

/**
 * Surface material system: what every contact in the physics world is made of, and how two
 * materials grip each other. Jolt keeps one friction value per contact; the contact listener and the
 * tyre callback in JoltVehicles set it from this table every step, from the two materials and how
 * fast the surfaces slide (static friction while they stick, kinetic friction once they slip).
 */
export interface PhysicalMaterial {
  /** Coefficient while the surfaces stick (no relative sliding). */
  staticFriction: number;
  /** Coefficient once they slide. */
  dynamicFriction: number;
  /** Rolling resistance coefficient (force = Crr · normal load) for wheels and round things on it. */
  rolling: number;
  /** Bounce: 0 = dead stop, 1 = perfectly elastic. */
  restitution: number;
  /** Footstep / impact sound family. */
  sound: 'hard' | 'soft' | 'gravel' | 'wood' | 'metal' | 'water' | 'snow' | 'glass';
}

export const MATERIALS = {
  // Ground.
  concrete: { staticFriction: .8, dynamicFriction: .65, rolling: .012, restitution: .08, sound: 'hard' },
  asphalt: { staticFriction: .85, dynamicFriction: .7, rolling: .011, restitution: .06, sound: 'hard' },
  dirt: { staticFriction: .7, dynamicFriction: .55, rolling: .05, restitution: .04, sound: 'soft' },
  mud: { staticFriction: .45, dynamicFriction: .3, rolling: .14, restitution: .01, sound: 'water' },
  grass: { staticFriction: .6, dynamicFriction: .45, rolling: .06, restitution: .05, sound: 'soft' },
  sand: { staticFriction: .6, dynamicFriction: .5, rolling: .17, restitution: .02, sound: 'soft' },
  gravel: { staticFriction: .7, dynamicFriction: .55, rolling: .035, restitution: .06, sound: 'gravel' },
  rock: { staticFriction: .8, dynamicFriction: .6, rolling: .015, restitution: .12, sound: 'hard' },
  ice: { staticFriction: .1, dynamicFriction: .04, rolling: .01, restitution: .05, sound: 'hard' },
  snow: { staticFriction: .3, dynamicFriction: .2, rolling: .09, restitution: .02, sound: 'snow' },
  /** Ground under a film of standing water. */
  wet: { staticFriction: .5, dynamicFriction: .35, rolling: .03, restitution: .03, sound: 'water' },
  // Things.
  wood: { staticFriction: .55, dynamicFriction: .4, rolling: .02, restitution: .22, sound: 'wood' },
  metal: { staticFriction: .45, dynamicFriction: .32, rolling: .005, restitution: .18, sound: 'metal' },
  sheetMetal: { staticFriction: .4, dynamicFriction: .3, rolling: .005, restitution: .3, sound: 'metal' },
  plastic: { staticFriction: .45, dynamicFriction: .35, rolling: .01, restitution: .32, sound: 'hard' },
  rubber: { staticFriction: 1, dynamicFriction: .8, rolling: .015, restitution: .5, sound: 'soft' },
  glass: { staticFriction: .35, dynamicFriction: .25, rolling: .005, restitution: .15, sound: 'glass' },
} as const satisfies Record<string, PhysicalMaterial>;
export type MaterialKind = keyof typeof MATERIALS;
export const MATERIAL_KINDS = Object.keys(MATERIALS) as MaterialKind[];

/**
 * Pairs that do not follow the general rule. Tyres above all: rubber's grip is a property of the
 * pair (a tyre on asphalt grips far more than the two numbers' mean suggests; on ice it is gone).
 * Values are [static, dynamic].
 */
const PAIRS: Partial<Record<string, readonly [number, number]>> = {
  'rubber|asphalt': [1.05, .85], 'rubber|concrete': [.95, .8], 'rubber|rock': [.8, .65], 'rubber|gravel': [.65, .5],
  'rubber|dirt': [.68, .55], 'rubber|grass': [.55, .45], 'rubber|sand': [.5, .4], 'rubber|mud': [.3, .2],
  'rubber|snow': [.28, .2], 'rubber|ice': [.1, .06], 'rubber|wet': [.62, .45], 'rubber|wood': [.7, .55], 'rubber|metal': [.6, .45],
  'metal|ice': [.03, .02], 'wood|ice': [.06, .04], 'metal|concrete': [.55, .4], 'wood|concrete': [.6, .45],
};
const pairKey = (a: MaterialKind, b: MaterialKind) => (a < b ? `${a}|${b}` : `${b}|${a}`);
for (const k of Object.keys(PAIRS)) { const [a, b] = k.split('|') as [MaterialKind, MaterialKind]; const key = pairKey(a, b); if (key !== k) { PAIRS[key] = PAIRS[k]; delete PAIRS[k]; } }

/** Below this sliding speed (m/s) a contact sticks; above twice it, it slides. */
export const STICK_SPEED = .05;

/** Static and kinetic friction of a pair (pair table, else the geometric mean, as Jolt does). */
export function pairFriction(a: MaterialKind, b: MaterialKind): readonly [number, number] {
  const p = PAIRS[pairKey(a, b)];
  if (p) return p;
  const ma = MATERIALS[a], mb = MATERIALS[b];
  return [Math.sqrt(ma.staticFriction * mb.staticFriction), Math.sqrt(ma.dynamicFriction * mb.dynamicFriction)];
}

/** Friction of a contact sliding at `slip` m/s: static while it sticks, kinetic once it slides. */
export function contactFriction(a: MaterialKind, b: MaterialKind, slip: number): number {
  const [s, d] = pairFriction(a, b);
  const t = Math.max(0, Math.min(1, (slip - STICK_SPEED) / STICK_SPEED));
  return s + (d - s) * t;
}

/** Bounce of a contact: the geometric mean, so a dead material (mud, sand) deadens any contact. */
export function contactRestitution(a: MaterialKind, b: MaterialKind): number {
  return Math.sqrt(MATERIALS[a].restitution * MATERIALS[b].restitution);
}

/** Rolling resistance of a tyre (or anything round) on a surface. */
export function rollingResistance(ground: MaterialKind): number {
  return MATERIALS[ground].rolling;
}

/** The physical material of a terrain surface type; `wet` when standing water covers it. */
export function terrainMaterial(surface: number, wet = false): MaterialKind {
  // Frozen over where snow lies under water; churned to mud on soft ground.
  if (wet) return surface === Surface.Snow ? 'ice' : surface === Surface.Mud || surface === Surface.Seabed || surface === Surface.Dirt ? 'mud' : 'wet';
  switch (surface) {
    case Surface.Asphalt: case Surface.MossyAsphalt: return 'asphalt';
    case Surface.BrokenAsphalt: return 'concrete';
    case Surface.Gravel: case Surface.GravelRoad: return 'gravel';
    case Surface.Rock: case Surface.Sandstone: return 'rock';
    case Surface.Sand: case Surface.Seabed: return 'sand';
    case Surface.Mud: return 'mud';
    case Surface.Snow: return 'snow';
    case Surface.Dirt: case Surface.DirtRoad: case Surface.WheelTrack: case Surface.ForestFloor: case Surface.JungleFloor: return 'dirt';
    default: return 'grass';
  }
}
