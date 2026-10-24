import type { MocapLayer } from './human-rig';
import { ITEMS } from '@zion/shared';

export function usesRifleReload(itemId: string | null | undefined): boolean {
  return !!itemId && ITEMS[itemId]?.category === 'rifle' && !['crossbow', 'grenade_launcher', 'm79'].includes(itemId);
}

/** Play the entire recording once within the gameplay reload time, with soft handoffs. */
export function rifleReloadLayer(elapsed: number, duration: number, clipDuration: number): MocapLayer {
  const phase = Math.max(0, Math.min(1, elapsed / Math.max(.3, duration)));
  const ease = (x: number) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };
  return { clip: 'rifle_reload', time: phase * clipDuration, weight: ease(phase / .08) * ease((1 - phase) / .1) };
}
