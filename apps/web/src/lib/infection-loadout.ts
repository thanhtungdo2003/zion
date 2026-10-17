import { DEFAULT_INFECTION_LOADOUT, sanitizeInfectionLoadout, type InfectionLoadout } from '@zion/shared';

const KEY = 'zion.infection.loadout.v1';

/** The weapons this browser last chose for Infection (the default set when none or invalid). */
export function loadInfectionLoadout(): InfectionLoadout {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? sanitizeInfectionLoadout(JSON.parse(raw) as Record<string, unknown>) : { ...DEFAULT_INFECTION_LOADOUT };
  } catch {
    return { ...DEFAULT_INFECTION_LOADOUT };
  }
}

export function saveInfectionLoadout(loadout: InfectionLoadout): void {
  try { localStorage.setItem(KEY, JSON.stringify(loadout)); } catch { /* private mode: kept for this session only */ }
}
