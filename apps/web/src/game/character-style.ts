import { API_URL } from '@/lib/api';

/** Player character look chosen in the Studio: the survivor, the survivor on the Mixamo skeleton, or the block character. */
export type CharacterStyle = 'survivor' | 'mixamo' | 'blocky';
export const CHARACTER_STYLES: readonly CharacterStyle[] = ['survivor', 'mixamo', 'blocky'];

let styleLoad: Promise<CharacterStyle> | null = null;
/** The Studio's character switch (asked once per page; the survivor when the server cannot say). */
export function characterStyle(): Promise<CharacterStyle> {
  if (typeof window === 'undefined') return Promise.resolve('survivor');
  styleLoad ??= fetch(`${API_URL}/api/character-style`, { credentials: 'include' })
    .then((res) => (res.ok ? res.json() as Promise<{ style?: unknown; blocky?: unknown }> : {} as { style?: unknown; blocky?: unknown }))
    .then((r) => (CHARACTER_STYLES.includes(r.style as CharacterStyle) ? r.style as CharacterStyle : r.blocky === true ? 'blocky' : 'survivor'))
    .catch(() => 'survivor' as const);
  return styleLoad;
}

/** Forgets the asked switch (the Studio after changing it). */
export function resetCharacterStyle(): void { styleLoad = null; }
