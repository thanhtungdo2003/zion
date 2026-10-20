import { registerCustomWeapon, type CustomWeapon, type CustomWeaponList } from '@zion/shared';
import { API_URL } from '@/lib/api';
import { registerWeaponVisual } from './render/weapons';

let loading: Promise<CustomWeapon[]> | null = null;

/** Registers a Studio weapon on this client: shared rules (items, specs, shop) and its model. */
export function applyCustomWeapon(w: CustomWeapon & { modelUrl: string | null }): void {
  registerCustomWeapon(w);
  const { fpHip, fpEyeRelief, base, ...model } = w.model;
  registerWeaponVisual(w.id, w.modelUrl ? (w.modelUrl.startsWith('http') ? w.modelUrl : `${API_URL}${w.modelUrl}`) : null, w.format, {
    ...model, ...(fpHip ? { fpHip } : {}), ...(fpEyeRelief ? { fpEyeRelief } : {}),
  }, base);
}

/**
 * Fetches the weapons made in the Studio once per page load and registers them before the
 * weapon models are loaded. Offline / server errors leave just the built-in arsenal.
 */
export function loadCustomWeapons(): Promise<CustomWeapon[]> {
  if (typeof window === 'undefined') return Promise.resolve([]);
  loading ??= fetch(`${API_URL}/api/weapons`, { credentials: 'include' })
    .then((res) => (res.ok ? (res.json() as Promise<CustomWeaponList>) : { weapons: [] }))
    .then(({ weapons }) => { for (const w of weapons) { try { applyCustomWeapon(w); } catch { /* skip a bad entry */ } } return weapons; })
    .catch(() => []);
  return loading;
}
