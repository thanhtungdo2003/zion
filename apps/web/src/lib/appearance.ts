'use client';

import { parseAppearance, type Appearance } from '@zion/shared';
import { currentAccount, getAppearance, saveAppearance } from './api';

/**
 * The player's character look on this device: the account's saved look (from the server),
 * remembered locally so the menu and the game show it immediately on the next visit.
 */
const KEY = 'zion.appearance';

export function cachedLook(): Appearance | null {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { account?: string; look?: unknown } | null;
    if (!saved || saved.account !== currentAccount()?.id) return null;
    return parseAppearance(saved.look);
  } catch {
    return null;
  }
}

function remember(look: Appearance): void {
  try { localStorage.setItem(KEY, JSON.stringify({ account: currentAccount()?.id, look })); } catch { /* storage unavailable */ }
  for (const listener of listeners) listener(look);
}

const listeners = new Set<(look: Appearance) => void>();
/** Called whenever the player's look changes (creator saved, loaded from the server). */
export function onLookChange(listener: (look: Appearance) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The account's look from the server (null: no character made yet). */
export async function loadLook(): Promise<Appearance | null> {
  const look = await getAppearance();
  if (look) remember(look);
  return look;
}

export async function storeLook(look: Appearance): Promise<Appearance> {
  const saved = await saveAppearance(look);
  remember(saved);
  return saved;
}
