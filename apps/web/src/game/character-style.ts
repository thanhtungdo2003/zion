import { API_URL } from '@/lib/api';

let styleLoad: Promise<boolean> | null = null;
/** The Studio's character switch: true when players are the old block character (asked once per page). */
export function blockyCharacters(): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false);
  styleLoad ??= fetch(`${API_URL}/api/character-style`, { credentials: 'include' })
    .then((res) => (res.ok ? res.json() as Promise<{ blocky?: unknown }> : { blocky: false }))
    .then((r) => r.blocky === true)
    .catch(() => false);
  return styleLoad;
}

/** Forgets the asked switch (the Studio after flipping it). */
export function resetCharacterStyle(): void { styleLoad = null; }
