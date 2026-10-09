import { Color } from 'three';
import { Surface } from '@zion/shared';

/** Base ground colours (sRGB hex) per surface material. */
const SURFACE_HEX: Record<Surface, number> = {
  [Surface.Grass]: 0x5d8a3a,
  [Surface.DryGrass]: 0xa39a5a,
  [Surface.ForestFloor]: 0x4a4a2c,
  [Surface.JungleFloor]: 0x3d6b28,
  [Surface.Sand]: 0xd9c592,
  [Surface.Sandstone]: 0xbf8a5b,
  [Surface.Dirt]: 0x7a5e3f,
  [Surface.Mud]: 0x4c4330,
  [Surface.Gravel]: 0x8a857b,
  [Surface.Rock]: 0x76726c,
  [Surface.Snow]: 0xeef2f6,
  [Surface.Seabed]: 0x8a8264,
};

/** Linear-space copies (three.js lights in linear space). */
const SURFACE_LINEAR: Color[] = Object.values(SURFACE_HEX).map((h) => new Color(h));

const GRASS_DRY = new Color(0xb3a55e);
const GRASS_LUSH = new Color(0x4f8f30);
const GRASS_COLD = new Color(0x56755a);
const GRASS_TROPIC = new Color(0x3b8a22);
const UNDERWATER = new Color(0x1f4d55);
const tmp = new Color();
const tmp2 = new Color();

/**
 * Minecraft-style climate tint for vegetation: dry → lush with humidity, bluish when cold,
 * saturated when hot and wet. Writes linear RGB into `out`.
 */
export function grassTint(temperature: number, humidity: number, out: Color): Color {
  out.copy(GRASS_DRY).lerp(GRASS_LUSH, Math.min(1, humidity * 1.3));
  if (temperature < 0.4) out.lerp(GRASS_COLD, (0.4 - temperature) * 1.8);
  else if (temperature > 0.62 && humidity > 0.5) out.lerp(GRASS_TROPIC, Math.min(1, (temperature - 0.62) * 3));
  return out;
}

/** Ground colour for a terrain vertex (linear RGB). */
export function surfaceColor(surface: number, temperature: number, humidity: number, out: Color): Color {
  const base = SURFACE_LINEAR[surface] ?? SURFACE_LINEAR[Surface.Dirt]!;
  out.copy(base);
  if (surface === Surface.Grass || surface === Surface.JungleFloor) {
    grassTint(temperature, humidity, tmp);
    out.lerp(tmp, 0.75);
  } else if (surface === Surface.ForestFloor) {
    grassTint(temperature, humidity, tmp);
    out.lerp(tmp, 0.25);
  } else if (surface === Surface.DryGrass) {
    grassTint(temperature, humidity * 0.6, tmp);
    out.lerp(tmp, 0.35);
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
