/**
 * Zombie rules shared by server and client. Zombie entity ids live in their own range so they
 * never collide with player ids. In snapshots a zombie's `weapon` byte carries its broken-limb
 * mask in bits 0..3 and its variant in bits 4..5 (zombies hold no weapons).
 */

export const ZOMBIE_ID_BASE = 1_000_000;

export const Limb = {
  ArmL: 1 << 0,
  ArmR: 1 << 1,
  LegL: 1 << 2,
  LegR: 1 << 3,
} as const;

export const LIMB_BY_ZONE: Readonly<Record<string, number>> = {
  arm_l: Limb.ArmL,
  arm_r: Limb.ArmR,
  leg_l: Limb.LegL,
  leg_r: Limb.LegR,
};

/** Livestock / wild animals live in [ANIMAL_ID_BASE, NPC_ID_BASE = 0xf0000000). */
export const ANIMAL_ID_BASE = 0xe0000000;

export function isZombieId(id: number): boolean {
  return id >= ZOMBIE_ID_BASE && id < ANIMAL_ID_BASE;
}

/** A zombie with a broken leg drags itself along the ground. */
export function isCrawling(limbs: number): boolean {
  return (limbs & (Limb.LegL | Limb.LegR)) !== 0;
}

/** Limbs still usable (0…4). */
export function limbsLeft(limbs: number): number {
  let n = 4;
  for (let b = limbs & 15; b; b &= b - 1) n--;
  return n;
}

export const ZOMBIE_MAX_HEALTH = 100;
export const ZombieVariant = { Rotting: 0, Gaunt: 1, Brute: 2, Crimson: 3 } as const;
export type ZombieVariant = (typeof ZombieVariant)[keyof typeof ZombieVariant];
export function zombieVariant(packed: number): ZombieVariant {
  const value = packed >>> 4;
  return value === 1 || value === 2 || value === 3 ? value : 0;
}
export function zombieMaxHealth(variant: ZombieVariant): number {
  return variant === ZombieVariant.Brute ? 280 : variant === ZombieVariant.Crimson ? 65 : ZOMBIE_MAX_HEALTH;
}

export function zombieScale(variant: ZombieVariant): number { return variant === ZombieVariant.Brute ? 1.5 : 1; }
