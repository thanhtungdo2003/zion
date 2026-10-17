import type { GameMode } from '@zion/shared';

/**
 * Coming back to a running match after the tab closed, the game crashed or the connection
 * dropped: the server holds the place for a while (REJOIN_GRACE_MS); the browser remembers which
 * match mode was being played so the menu can go straight back in.
 */
const KEY = 'zion.activeMatch';
const TRIES = 'zion.rejoinTries';
/** A little under the server's hold, so the menu never sends someone into a fresh match by mistake. */
const FRESH_MS = 140_000;

export function markActiveMatch(mode: GameMode): void {
  try { localStorage.setItem(KEY, JSON.stringify({ mode, at: Date.now() })); } catch { /* storage unavailable */ }
}
export function clearActiveMatch(): void {
  try { localStorage.removeItem(KEY); } catch { /* storage unavailable */ }
}
/** The match mode to go back to, if the last one was left less than a couple of minutes ago. */
export function activeMatch(): GameMode | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { mode?: GameMode; at?: number } | null;
    if (!v?.mode || !v.at || Date.now() - v.at > FRESH_MS) { clearActiveMatch(); return null; }
    return v.mode;
  } catch { return null; }
}
/** Automatic reconnect attempts in this tab since the last successful join. */
export function rejoinAttempt(): number {
  try { const n = Number(sessionStorage.getItem(TRIES) ?? 0) + 1; sessionStorage.setItem(TRIES, String(n)); return n; } catch { return 99; }
}
export function rejoinSucceeded(): void {
  try { sessionStorage.removeItem(TRIES); } catch { /* storage unavailable */ }
}
