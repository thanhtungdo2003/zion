import { Color } from 'three';
import { Surface } from '@zion/shared';

/** Base ground colours (sRGB hex) per surface material. */
const SURFACE_HEX: Record<Surface, number> = {
  // Muted, natural field tones: olive grass, umber earth, grey-buff sand and stone.
  [Surface.Grass]: 0x5c7539,
  [Surface.DryGrass]: 0x938a5c,
  [Surface.ForestFloor]: 0x4b4431,
  [Surface.JungleFloor]: 0x456b2e,
  [Surface.Sand]: 0xc4b48c,
  [Surface.Sandstone]: 0xa98260,
  [Surface.Dirt]: 0x6b5843,
  [Surface.Mud]: 0x463e30,
  [Surface.Gravel]: 0x84807a,
  [Surface.Rock]: 0x7a766f,
  [Surface.Snow]: 0xeef2f6,
  [Surface.Seabed]: 0x8a8264,
  [Surface.DirtRoad]: 0x80694c,
  [Surface.WheelTrack]: 0x746049,
  [Surface.RoadVerge]: 0x5e743f,
  [Surface.Asphalt]: 0x505452,
  [Surface.MossyAsphalt]: 0x555f43,
  [Surface.BrokenAsphalt]: 0x716b5b,
  [Surface.GravelRoad]: 0x8a806c,
};

/** Linear-space copies (three.js lights in linear space). */
const SURFACE_LINEAR: Color[] = Object.values(SURFACE_HEX).map((h) => new Color(h));

const GRASS_DRY = new Color(0x9e925f);
const GRASS_LUSH = new Color(0x527236);
const GRASS_COLD = new Color(0x58705a);
const GRASS_BURNT = new Color(0xb79d68);
const ARID_SOIL = new Color(0xb08a5a);
const DESERT_SAND = new Color(0xd2b27c);
const FROST = new Color(0xc9ced4);
const smooth = (a: number, b: number, v: number) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
const GRASS_TROPIC = new Color(0x48722e);
const UNDERWATER = new Color(0x1f4d55);
const tmp = new Color();
const tmp2 = new Color();

/**
 * Minecraft-style climate tint for vegetation: dry → lush with humidity, bluish when cold,
 * saturated when hot and wet. Writes linear RGB into `out`.
 */
export function grassTint(temperature: number, humidity: number, out: Color): Color {
  // Hot and dry: straw and sun-burnt ochre; green only where it is humid (by the water).
  const lush = temperature > .7 ? smooth(.3, .7, humidity) : Math.min(1, humidity * 1.3);
  out.copy(GRASS_DRY).lerp(GRASS_LUSH, lush);
  if (temperature > .7 && humidity < .3) out.lerp(GRASS_BURNT, (.3 - humidity) / .3 * Math.min(1, (temperature - .7) * 4));
  if (temperature < 0.4) out.lerp(GRASS_COLD, (0.4 - temperature) * 1.8);
  else if (temperature > 0.62 && humidity > 0.5) out.lerp(GRASS_TROPIC, Math.min(1, (temperature - 0.62) * 3));
  return out;
}

/** Ground colour for a terrain vertex (linear RGB). */
export function surfaceColor(surface: number, temperature: number, humidity: number, out: Color): Color {
  const base = SURFACE_LINEAR[surface] ?? SURFACE_LINEAR[Surface.Dirt]!;
  out.copy(base);
  if (surface === Surface.Grass || surface === Surface.JungleFloor || surface === Surface.RoadVerge) {
    grassTint(temperature, humidity, tmp);
    out.lerp(tmp, 0.75);
  } else if (surface === Surface.ForestFloor) {
    grassTint(temperature, humidity, tmp);
    out.lerp(tmp, 0.25);
  } else if (surface === Surface.DryGrass) {
    grassTint(temperature, humidity * 0.6, tmp);
    out.lerp(tmp, 0.35);
  }
  // The climate colours the whole ground, soil and rock too: ochre in arid land, sand in the desert, frost in the cold.
  if (surface !== Surface.Snow && surface !== Surface.Asphalt) {
    const dry = temperature > .7 ? smooth(.45, .05, humidity) : 0;
    if (dry > 0) { tmp.copy(temperature > .9 ? DESERT_SAND : ARID_SOIL); out.lerp(tmp, dry * (temperature > .9 ? .6 : .4)); }
    if (temperature < .2) { tmp.copy(FROST); out.lerp(tmp, (.2 - temperature) * 1.5); }
  }
  return out;
}

/** Darkens and blue-shifts colours below the waterline for depth perception. */
export function applyUnderwater(color: Color, depth: number): void {
  if (depth <= 0) return;
  const k = Math.min(1, depth / 9);
  tmp2.copy(UNDERWATER);
  color.lerp(tmp2, k * 0.85);
}

/** Small deterministic per-vertex brightness jitter so flat areas do not look plastic. */
export function jitter(x: number, z: number): number {
  let h = Math.imul((x | 0) ^ 0x27d4eb2d, 0x165667b1) ^ Math.imul((z | 0) + 0x5bd1e995, 0x27d4eb2f);
  h ^= h >>> 15;
  return ((h >>> 0) / 4294967296) * 0.14 - 0.07;
}

export const FLOWER_COLORS = [0xe8d34a, 0xe0e4ea, 0xc94a4a, 0x9b6ad1, 0x5a8fe0, 0xf0904a].map((h) => new Color(h));
