import { CAMP_HALF_SIZE } from '@zion/worldgen';

/** Choose uniformly from matching buildings outside the camp, independent of player distance. */
export function chooseMissionStructure<T extends { kind: string; x: number; z: number; radius: number }>(
  structures: Iterable<T>, kind: string, camp?: { x: number; z: number } | null, random = Math.random,
): T | undefined {
  const candidates = [...structures].filter((loc) => loc.kind === kind && (!camp || Math.hypot(loc.x - camp.x, loc.z - camp.z) >= CAMP_HALF_SIZE + loc.radius));
  return candidates[Math.floor(random() * candidates.length)];
}
