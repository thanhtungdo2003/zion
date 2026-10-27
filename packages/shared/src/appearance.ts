import { z } from 'zod';

/**
 * A survivor's look, chosen in the character creator: haircut, outfit colours and the face and
 * body proportions of the shared base model. Saved on the account and sent to every player in
 * the match (`players`), so everyone sees the same character.
 */

/** The hair pack's 27 styles (models/hair/hair_NN.glb, as made), or none. */
export const HAIR_STYLES = ['hair_01', 'hair_02', 'hair_03', 'hair_04', 'hair_05', 'hair_06', 'hair_07', 'hair_08', 'hair_09', 'hair_10',
  'hair_11', 'hair_12', 'hair_13', 'hair_14', 'hair_15', 'hair_16', 'hair_17', 'hair_18', 'hair_19', 'hair_20', 'hair_21', 'hair_22',
  'hair_23', 'hair_24', 'hair_25', 'hair_26', 'hair_27', 'bald'] as const;
export type HairStyle = (typeof HAIR_STYLES)[number];
/** Looks saved before the hair pack keep a haircut of about the same length. */
const LEGACY_HAIR: Record<string, HairStyle> = { side_part: 'hair_01', crop: 'hair_01', undercut: 'hair_01', buzz: 'hair_01' };

export const TOP_STYLES = ['tank_top', 'none'] as const;
export type TopStyle = (typeof TOP_STYLES)[number];

export const SKIN_TONES = ['#f2d4bf', '#e3b899', '#cd9b78', '#ad7652', '#845437', '#5a3826'] as const;
/** Hair colours tinting the styles' (grey, made to be tinted) textures, their detail kept; 'natural' shows the texture as it is. */
export const HAIR_COLORS = ['natural', '#2a1d14', '#0f0d0c', '#4a2f1d', '#7a5232', '#b08a58', '#8e3b22', '#8a8784', '#ddd6c8', '#2f3f63', '#6b2a4a'] as const;
export const TOP_COLORS = ['#4a4f2e', '#2a2b2a', '#e6e1d4', '#3b4a5e', '#6c2e28', '#8a7a58', '#5e6b73'] as const;
/** Muted only (washed-out work and outdoor colours, never bright): grey joggers first. */
export const PANTS_COLORS = ['#7a7b79', '#4a503a', '#2b2b2d', '#5d6670', '#3d4652', '#6f5741', '#9a8f78'] as const;
export const BOOT_COLORS = ['#6b5236', '#2a2420', '#4f5141', '#80705c'] as const;

/** Face sliders, −100…100 (0 = the base model). */
export const FACE_KEYS = ['head', 'faceWidth', 'forehead', 'jaw', 'chin', 'cheeks', 'cheekbones', 'nose', 'noseWidth', 'noseBridge', 'lips', 'brow', 'eyes', 'eyeSize', 'ears'] as const;
export type FaceKey = (typeof FACE_KEYS)[number];
/** Eyebrows: none, or one of the three shapes (models/characters/eyebrows.glb). Beards grow from the skin. */
export const BROW_STYLES = 3;
export const BEARD_STYLES = ['none', 'stubble', 'mustache', 'goatee', 'full'] as const;
export type BeardStyle = (typeof BEARD_STYLES)[number];

/**
 * Whole faces to start from (the face sliders all at once): quite different people, each still
 * adjustable afterwards.
 */
export const FACE_PRESETS: ReadonlyArray<{ id: string; name: string; face: Partial<Record<(typeof FACE_KEYS)[number], number>> }> = [
  { id: 'base', name: 'Mặc định', face: {} },
  { id: 'angular', name: 'Góc cạnh', face: { faceWidth: -20, jaw: 85, chin: 40, cheeks: -60, cheekbones: 70, nose: 20, noseBridge: 60, lips: -40, brow: 70, eyeSize: -30 } },
  { id: 'round', name: 'Mặt tròn', face: { head: 15, faceWidth: 80, jaw: -30, chin: -60, cheeks: 90, cheekbones: -20, nose: -30, noseWidth: 40, noseBridge: -40, lips: 30, eyeSize: 20 } },
  { id: 'long', name: 'Mặt dài', face: { faceWidth: -70, forehead: 60, jaw: -40, chin: 90, cheeks: -40, nose: 50, noseBridge: 40, lips: -20, eyes: -20 } },
  { id: 'broad', name: 'Bặm trợn', face: { head: 25, faceWidth: 60, forehead: -40, jaw: 100, chin: 20, cheeks: 30, cheekbones: 40, nose: 70, noseWidth: 80, noseBridge: -20, lips: 50, brow: 100, eyeSize: -60, ears: 30 } },
  { id: 'gentle', name: 'Thư sinh', face: { head: -10, faceWidth: -40, forehead: 30, jaw: -70, chin: -10, cheeks: -20, cheekbones: 10, nose: -40, noseWidth: -50, noseBridge: 30, lips: -10, brow: -50, eyeSize: 60, ears: -20 } },
  { id: 'flat', name: 'Mũi tẹt, mắt xa', face: { faceWidth: 40, forehead: 20, jaw: 10, chin: -30, cheeks: 50, cheekbones: 60, nose: -20, noseWidth: 90, noseBridge: -100, lips: 60, brow: -30, eyes: 70, eyeSize: -10 } },
  { id: 'weathered', name: 'Từng trải', face: { head: 5, faceWidth: -10, forehead: 50, jaw: 50, chin: 30, cheeks: -90, cheekbones: 90, nose: 60, noseWidth: 20, noseBridge: 70, lips: -60, brow: 80, eyes: -30, eyeSize: -40, ears: 50 } },
  { id: 'young', name: 'Trẻ trung', face: { head: 10, faceWidth: 10, forehead: 40, jaw: -50, chin: -40, cheeks: 60, cheekbones: -30, nose: -60, noseWidth: -20, noseBridge: -30, lips: 40, brow: -60, eyeSize: 90, ears: -30 } },
];

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
  /** 0 = none, 1…BROW_STYLES. */
  brows: number;
  beard: BeardStyle;
  body: Record<BodyKey, number>;
  /** −100…100: 0.93×…1.07× the base height (≈1.73 m). */
  height: number;
}

const slider = z.number().int().min(-100).max(100);
const index = (palette: readonly string[]) => z.number().int().min(0).max(palette.length - 1);

export const appearanceSchema = z.object({
  v: z.literal(1),
  hair: z.preprocess((v) => (typeof v === 'string' && LEGACY_HAIR[v] ? LEGACY_HAIR[v] : v), z.enum(HAIR_STYLES)),
  hairColor: index(HAIR_COLORS),
  skin: index(SKIN_TONES),
  top: z.enum(TOP_STYLES),
  topColor: index(TOP_COLORS),
  pantsColor: index(PANTS_COLORS),
  bootsColor: index(BOOT_COLORS),
  belt: z.boolean(),
  // (Looks saved with fewer face sliders take 0 for the new ones.)
  face: z.preprocess((v) => (v && typeof v === 'object' ? { ...Object.fromEntries(FACE_KEYS.map((k) => [k, 0])), ...v } : v),
    z.object(Object.fromEntries(FACE_KEYS.map((k) => [k, slider])) as Record<FaceKey, typeof slider>).strict()),
  brows: z.number().int().min(0).max(BROW_STYLES).default(1),
  beard: z.enum(BEARD_STYLES).default('none'),
  body: z.object(Object.fromEntries(BODY_KEYS.map((k) => [k, slider])) as Record<BodyKey, typeof slider>).strict(),
  height: slider,
}).strict();

export const DEFAULT_APPEARANCE: Appearance = {
  v: 1, hair: 'hair_01', hairColor: 1, skin: 1, top: 'tank_top', topColor: 0, pantsColor: 0, bootsColor: 0, belt: true,
  face: Object.fromEntries(FACE_KEYS.map((k) => [k, 0])) as Record<FaceKey, number>,
  brows: 1,
  beard: 'none',
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
    hairColor: 1 + pick(7),
    skin: pick(SKIN_TONES.length),
    top: rnd() < 0.9 ? 'tank_top' : 'none',
    topColor: pick(TOP_COLORS.length),
    pantsColor: pick(PANTS_COLORS.length),
    bootsColor: pick(BOOT_COLORS.length),
    belt: rnd() < 0.8,
    face: Object.fromEntries(FACE_KEYS.map((k) => [k, range(55)])) as Record<FaceKey, number>,
    brows: 1 + pick(BROW_STYLES),
    beard: rnd() < .5 ? 'none' : BEARD_STYLES[1 + pick(BEARD_STYLES.length - 1)]!,
    body: Object.fromEntries(BODY_KEYS.map((k) => [k, range(60)])) as Record<BodyKey, number>,
    height: range(70),
  };
}

/** Height multiplier of a look. */
export function appearanceHeight(a: Appearance): number {
  return 1 + (a.height / 100) * 0.07;
}
