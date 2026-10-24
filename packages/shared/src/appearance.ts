import { z } from 'zod';

/**
 * A survivor's look, chosen in the character creator: haircut, outfit colours and the face and
 * body proportions of the shared base model. Saved on the account and sent to every player in
 * the match (`players`), so everyone sees the same character.
 */

export const HAIR_STYLES = ['side_part', 'crop', 'undercut', 'buzz', 'bald'] as const;
export type HairStyle = (typeof HAIR_STYLES)[number];

export const TOP_STYLES = ['tank_top', 'none'] as const;
export type TopStyle = (typeof TOP_STYLES)[number];

export const SKIN_TONES = ['#f2d4bf', '#e3b899', '#cd9b78', '#ad7652', '#845437', '#5a3826'] as const;
export const HAIR_COLORS = ['#2a1d14', '#0f0d0c', '#4a2f1d', '#7a5232', '#b08a58', '#8e3b22', '#8a8784', '#ddd6c8'] as const;
export const TOP_COLORS = ['#4a4f2e', '#2a2b2a', '#e6e1d4', '#3b4a5e', '#6c2e28', '#8a7a58', '#5e6b73'] as const;
export const PANTS_COLORS = ['#b5a27a', '#4a503a', '#2b2b2d', '#5d6670', '#34465f', '#6f5741'] as const;
export const BOOT_COLORS = ['#6b5236', '#2a2420', '#4f5141', '#80705c'] as const;

/** Face sliders, −100…100 (0 = the base model). */
export const FACE_KEYS = ['head', 'jaw', 'chin', 'cheeks', 'nose', 'brow', 'eyes', 'ears'] as const;
export type FaceKey = (typeof FACE_KEYS)[number];
/** Body sliders, −100…100 (0 = the base model). */
export const BODY_KEYS = ['build', 'muscle', 'shoulders', 'waist', 'legs'] as const;
export type BodyKey = (typeof BODY_KEYS)[number];

export interface Appearance {
  v: 1;
  hair: HairStyle;
  hairColor: number;
  skin: number;
  top: TopStyle;
  topColor: number;
  pantsColor: number;
  bootsColor: number;
  belt: boolean;
  face: Record<FaceKey, number>;
  body: Record<BodyKey, number>;
  /** −100…100: 0.93×…1.07× the base height (≈1.73 m). */
  height: number;
}

const slider = z.number().int().min(-100).max(100);
const index = (palette: readonly string[]) => z.number().int().min(0).max(palette.length - 1);

export const appearanceSchema = z.object({
  v: z.literal(1),
  hair: z.enum(HAIR_STYLES),
  hairColor: index(HAIR_COLORS),
  skin: index(SKIN_TONES),
  top: z.enum(TOP_STYLES),
  topColor: index(TOP_COLORS),
  pantsColor: index(PANTS_COLORS),
  bootsColor: index(BOOT_COLORS),
  belt: z.boolean(),
  face: z.object(Object.fromEntries(FACE_KEYS.map((k) => [k, slider])) as Record<FaceKey, typeof slider>).strict(),
  body: z.object(Object.fromEntries(BODY_KEYS.map((k) => [k, slider])) as Record<BodyKey, typeof slider>).strict(),
  height: slider,
}).strict();

export const DEFAULT_APPEARANCE: Appearance = {
  v: 1, hair: 'side_part', hairColor: 0, skin: 1, top: 'tank_top', topColor: 0, pantsColor: 0, bootsColor: 0, belt: true,
  face: { head: 0, jaw: 0, chin: 0, cheeks: 0, nose: 0, brow: 0, eyes: 0, ears: 0 },
  body: { build: 0, muscle: 0, shoulders: 0, waist: 0, legs: 0 },
  height: 0,
};

/** A valid look from anything (stored JSON, network), or null when it is not one. */
export function parseAppearance(value: unknown): Appearance | null {
  const r = appearanceSchema.safeParse(value);
  return r.success ? r.data : null;
}

export function sameAppearance(a: Appearance | null | undefined, b: Appearance | null | undefined): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** A plausible random look (bots, players who never chose one); deterministic per seed. */
export function randomAppearance(seed: number): Appearance {
  let s = (seed * 2654435761) >>> 0 || 1;
  const rnd = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  const pick = (n: number) => Math.floor(rnd() * n);
  const range = (spread: number) => Math.round((rnd() * 2 - 1) * spread);
  return {
    v: 1,
    hair: HAIR_STYLES[pick(HAIR_STYLES.length)]!,
    hairColor: pick(6),
    skin: pick(SKIN_TONES.length),
    top: rnd() < 0.9 ? 'tank_top' : 'none',
    topColor: pick(TOP_COLORS.length),
    pantsColor: pick(PANTS_COLORS.length),
    bootsColor: pick(BOOT_COLORS.length),
    belt: rnd() < 0.8,
    face: Object.fromEntries(FACE_KEYS.map((k) => [k, range(55)])) as Record<FaceKey, number>,
    body: Object.fromEntries(BODY_KEYS.map((k) => [k, range(60)])) as Record<BodyKey, number>,
    height: range(70),
  };
}

/** Height multiplier of a look. */
export function appearanceHeight(a: Appearance): number {
  return 1 + (a.height / 100) * 0.07;
}
