import { z } from 'zod';

/**
 * Gear fitting from the Studio ("Studio trang bị"): hand adjustments of how each worn or carried
 * model sits on the character, and the painted soft regions (strap ends, cords) that swing with
 * gravity and inertia. Saved once on the server; every client applies it, so the game shows
 * exactly what the Studio preview shows.
 *
 * Keys: an armour item id ("vest_premium"), "military_backpack", a carry hook ("hook:back_left",
 * "hook:back_right", "hook:back_center", "hook:hip_left", "hook:hip_right", "hook:chest"), or a
 * stowed weapon's place ("sling:back_1" … "sling:back_3", "sling:holster", "sling:belt").
 */
const n = z.number().finite();
export const gearAdjustSchema = z.object({
  /** Metres in the character's frame (+X its left, +Y up, +Z forward). */
  offset: z.tuple([n.min(-.5).max(.5), n.min(-.5).max(.5), n.min(-.5).max(.5)]).default([0, 0, 0]),
  /** Degrees about X, Y, Z, turning the piece about its own centre. */
  rotate: z.tuple([n.min(-180).max(180), n.min(-180).max(180), n.min(-180).max(180)]).default([0, 0, 0]),
  scale: n.min(.3).max(3).default(1),
}).strict();
export type GearAdjust = z.infer<typeof gearAdjustSchema>;

/** A painted soft region of one mesh of a model: vertex indices (sorted, deduplicated). */
export const softRegionSchema = z.object({
  mesh: z.number().int().min(0).max(255),
  vertices: z.array(z.number().int().min(0).max(1_000_000)).max(60_000),
  /** 0 limp … 1 stiff. */
  stiffness: n.min(0).max(1).default(.35),
}).strict();
export type SoftRegion = z.infer<typeof softRegionSchema>;

/**
 * A hand pull of a model's surface (e.g. a shoulder strap brought over the shoulder): the mesh's
 * points near `p` (mesh space, within `r` metres, softly) move by `d`.
 */
const v3 = z.tuple([n, n, n]);
export const gearDragSchema = z.object({
  mesh: z.number().int().min(0).max(255),
  p: v3, d: z.tuple([n.min(-1).max(1), n.min(-1).max(1), n.min(-1).max(1)]),
  r: n.min(.002).max(.5),
}).strict();
export type GearDrag = z.infer<typeof gearDragSchema>;

const key = z.string().regex(/^[a-z0-9_:]{2,48}$/);
export const gearFitSchema = z.object({
  adjust: z.record(key, gearAdjustSchema).default({}),
  soft: z.record(key, z.array(softRegionSchema).max(16)).default({}),
  drag: z.record(key, z.array(gearDragSchema).max(200)).default({}),
}).strict();
export type GearFit = z.infer<typeof gearFitSchema>;

export const EMPTY_GEAR_FIT: GearFit = { adjust: {}, soft: {}, drag: {} };
export const CARRY_HOOKS = ['back_right', 'back_left', 'back_center', 'hip_right', 'hip_left', 'chest'] as const;
