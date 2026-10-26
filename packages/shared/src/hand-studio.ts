import { z } from 'zod';

/**
 * Hand Studio data: hand poses (every finger joint's turn) and hand-and-weapon animations
 * (keyframed tracks for the gun, each hand and the gun's moving parts). Saved by the Studio as one
 * document; game clients load it and play an animation in place of a weapon's scripted reload.
 */

/** Finger chains, base to tip: `<finger>_01…03` (the survivor rig, either hand). */
export const HAND_FINGERS = ['f_index', 'f_middle', 'f_ring', 'f_pinky', 'thumb'] as const;
/** `hand`: the wrist, turned from where the arm puts it (bent back / forward, sideways, twisted). */
export const HAND_POSE_BONES: readonly string[] = ['hand', ...HAND_FINGERS.flatMap((f) => [1, 2, 3].map((k) => `${f}_0${k}`))];

const num = z.number().finite();
const vec3 = z.tuple([num, num, num]);
const id = z.string().regex(/^[a-z0-9_-]{1,40}$/);

/**
 * A hand pose: each finger joint's turn from the rig's bind pose (radians, XYZ order; X curls the
 * finger toward the palm). Joints left out stay as bound. Authored on the right hand; the left
 * uses the same turns (the rig's hands are mirrored).
 */
export const handPoseSchema = z.object({
  id,
  name: z.string().min(1).max(48),
  bones: z.record(z.string().max(20), vec3),
});
export type HandPose = z.infer<typeof handPoseSchema>;

export const HAND_EASES = ['linear', 'in', 'out', 'inOut', 'step'] as const;
export type HandEase = (typeof HAND_EASES)[number];

/**
 * One key of a track at `t` (0…1 of the animation). The segment arriving at a key is shaped by
 * that key's `ease`.
 *  - gun: `pos` (camera metres: x right, y up, z back), `rot` (degrees: pitch, yaw, roll), `scale`.
 *  - hand: `pos` (gun metres: x toward the muzzle, y up, z right) — relative to the gun part named
 *    by `part` when set, so the hand follows it —, `rot` (degrees, the hand's turn on the gun;
 *    without it the hand only reaches there), `pose` (a hand pose id), `elbow` (degrees the elbow
 *    swings round the shoulder–wrist line: + out and up), `shoulder` (camera metres the shoulder
 *    moves: x right, y up, z back).
 *  - part: `clip` (0…1 through the part's own model clip, when the track names one), or `pos`
 *    (gun metres) / `rot` (degrees) moved from where the part rests.
 */
export const handKeySchema = z.object({
  t: z.number().min(0).max(1),
  ease: z.enum(HAND_EASES).default('inOut'),
  pos: vec3.optional(),
  rot: vec3.optional(),
  scale: z.number().min(.1).max(5).optional(),
  pose: z.string().max(40).optional(),
  part: z.string().max(60).optional(),
  clip: z.number().min(0).max(1).optional(),
  elbow: z.number().min(-180).max(180).optional(),
  shoulder: vec3.optional(),
});
export type HandKey = z.infer<typeof handKeySchema>;

export const handTrackSchema = z.object({
  id,
  kind: z.enum(['gun', 'handL', 'handR', 'part']),
  /** Part tracks: the gun part (model node name) they move, and the model clip they play. */
  part: z.string().max(60).optional(),
  clip: z.string().max(80).optional(),
  keys: z.array(handKeySchema).max(64),
});
export type HandTrack = z.infer<typeof handTrackSchema>;

export const handAnimationSchema = z.object({
  id,
  name: z.string().min(1).max(60),
  /** The weapon (item id) it is made for and plays on; '*' for any gun. */
  weapon: z.string().max(40).default('*'),
  /** What it replaces in game: the weapon's reload (the reload's own length), or nothing yet. */
  action: z.enum(['reload', 'none']).default('reload'),
  /** Studio preview length and speed (in game a reload lasts as long as the weapon's reload). */
  duration: z.number().min(.1).max(20).default(2.2),
  speed: z.number().min(.05).max(4).default(1),
  tracks: z.array(handTrackSchema).max(32),
  /** Sounds at fractions of the animation; empty: the weapon's own reload sounds play. */
  sounds: z.array(z.object({ at: z.number().min(0).max(1), sound: z.string().max(40), volume: z.number().min(0).max(2).optional(), rate: z.number().min(.25).max(4).optional() })).max(48).default([]),
});
export type HandAnimation = z.infer<typeof handAnimationSchema>;

export const handStudioSchema = z.object({
  poses: z.array(handPoseSchema).max(300),
  animations: z.array(handAnimationSchema).max(300),
});
export type HandStudio = z.infer<typeof handStudioSchema>;

/** A pose curling every finger's three joints (and the thumb's) by these angles. */
function curled(idv: string, name: string, finger: [number, number, number], thumb: [number, number, number]): HandPose {
  const bones: Record<string, [number, number, number]> = {};
  for (const f of HAND_FINGERS) [1, 2, 3].forEach((k, j) => { bones[`${f}_0${k}`] = [(f === 'thumb' ? thumb : finger)[j]!, 0, 0]; });
  return { id: idv, name, bones };
}

/** The built-in hand shapes (the game's standard ones), editable in the Studio. */
export const BUILTIN_HAND_POSES: readonly HandPose[] = [
  curled('open', 'Xòe', [-.05, -.05, 0], [0, 0, 0]),
  curled('relaxed', 'Thả lỏng', [.22, .38, .28], [.1, .18, .12]),
  curled('ready', 'Chờ (khum)', [.7, .9, .6], [.35, .4, .3]),
  curled('fist', 'Nắm chặt', [1.25, 1.3, .85], [.5, .6, .55]),
  curled('pinch', 'Kẹp (cái + trỏ)', [.45, .55, .35], [.45, .5, .4]),
];

export const DEFAULT_HAND_STUDIO: HandStudio = { poses: BUILTIN_HAND_POSES.map((p) => structuredClone(p)), animations: [] };

/** Eased progress through a segment. */
export function handEase(ease: HandEase, u: number): number {
  const x = Math.min(1, Math.max(0, u));
  switch (ease) {
    case 'linear': return x;
    case 'in': return x * x * x;
    case 'out': return 1 - (1 - x) ** 3;
    case 'step': return x < 1 ? 0 : 1;
    default: return x < .5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
  }
}

/** The two keys around `t` and the eased progress between them (null: the track has no keys). */
export function handKeysAt(keys: readonly HandKey[], t: number): { a: HandKey; b: HandKey; u: number } | null {
  if (!keys.length) return null;
  const sorted = keys.length > 1 && keys.some((k, i) => i && k.t < keys[i - 1]!.t) ? [...keys].sort((x, y) => x.t - y.t) : keys;
  if (t <= sorted[0]!.t) return { a: sorted[0]!, b: sorted[0]!, u: 0 };
  for (let i = 1; i < sorted.length; i++) {
    const b = sorted[i]!;
    if (t <= b.t) { const a = sorted[i - 1]!; return { a, b, u: handEase(b.ease, (t - a.t) / Math.max(1e-6, b.t - a.t)) }; }
  }
  const last = sorted[sorted.length - 1]!;
  return { a: last, b: last, u: 0 };
}

/**
 * How long a weapon's reload takes when a Hand Studio animation plays it: the animation's own
 * length (at its speed). Server and clients register the saved studio; weapons without one keep
 * their fixed reload time.
 */
const animatedReloads = new Map<string, number>();
export function registerHandStudioReloads(studio: HandStudio): void {
  animatedReloads.clear();
  for (const a of studio.animations) if (a.action === 'reload' && a.weapon !== '*') animatedReloads.set(a.weapon, Math.round(a.duration / a.speed * 1000));
}
/** The reload time (ms) of a weapon: its animation's when it has one, else `fixedMs`. */
export function reloadMsFor(itemId: string | null | undefined, fixedMs: number): number {
  return (itemId && animatedReloads.get(itemId)) || fixedMs;
}
