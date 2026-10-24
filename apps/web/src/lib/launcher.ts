/**
 * The ZION desktop launcher (apps/launcher) opens this site in its own window and says so in its
 * user agent ("ZIONLauncher/<version>"). The game itself always comes from the server, so only the
 * launcher can be out of date: the site publishes the current one in /downloads/launcher.json.
 */
export function launcherVersion(): string | null {
  if (typeof navigator === 'undefined') return null;
  return /ZIONLauncher\/([\d.]+)/.exec(navigator.userAgent)?.[1] ?? null;
}

const newer = (a: string, b: string) => {
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
};

/** The newer launcher version to download, or null (up to date, not in the launcher, or unknown). */
export async function launcherUpdate(): Promise<string | null> {
  const mine = launcherVersion();
  if (!mine) return null;
  try {
    const res = await fetch('/downloads/launcher.json', { cache: 'no-store' });
    if (!res.ok) return null;
    const { version } = await res.json() as { version?: string };
    return version && newer(version, mine) ? version : null;
  } catch { return null; }
}

/**
 * The server speaks a newer protocol than this page: load the new build once (in the launcher or
 * an installed app there is no address bar to refresh from). Guarded so it never loops.
 */
export function reloadForNewVersion(): boolean {
  try {
    const key = 'zion.reloadedForVersion', at = Number(sessionStorage.getItem(key) ?? 0);
    if (Date.now() - at < 60_000) return false;
    sessionStorage.setItem(key, String(Date.now()));
  } catch { /* storage blocked: still reload once */ }
  window.location.reload();
  return true;
}
