/**
 * Heavy model files (map models, Model Studio houses, the game's GLBs) kept on this machine
 * between matches and sessions, in the browser's Cache Storage (the desktop app's too): a second
 * match on the same map reads them from disk instead of the server.
 *
 * Content-named files (hashed manifest names, `?v=` urls) never change and are served from disk
 * as they are. Others are asked again with the stored ETag; the server answers "not modified"
 * without sending the file, or the new version, which replaces the stored one. Offline or when
 * the server fails, the stored copy is used.
 */
const CACHE = 'zion-models-v1';

/** A file whose url names its content: the stored copy is always right. */
export const immutableUrl = (url: string) => /[?&]v=/.test(url) || /\/assets\/.+\.[0-9a-f]{8,}\.[a-z0-9]+(\?|$)/i.test(url);

let opened: Promise<Cache | null> | null = null;
function store(): Promise<Cache | null> {
  if (!opened) {
    // Ask the browser not to evict them under storage pressure (granted silently or not at all).
    void (typeof navigator !== 'undefined' ? navigator.storage?.persist?.() : undefined)?.catch(() => undefined);
    opened = typeof caches === 'undefined' ? Promise.resolve(null) : caches.open(CACHE).catch(() => null);
  }
  return opened;
}

/** One download per url at a time, shared by its readers (the renderer and the collision). */
const inFlight = new Map<string, Promise<ArrayBuffer>>();

async function load(url: string): Promise<ArrayBuffer> {
  const cache = await store();
  const stored = cache ? await cache.match(url).catch(() => undefined) : undefined;
  if (stored && immutableUrl(url)) return stored.arrayBuffer();
  const etag = stored?.headers.get('etag');
  let res: Response;
  try {
    res = await fetch(url, etag ? { headers: { 'if-none-match': etag } } : undefined);
  } catch (err) {
    if (stored) return stored.arrayBuffer();
    throw err;
  }
  if (res.status === 304 && stored) return stored.arrayBuffer();
  if (!res.ok) {
    if (stored && res.status >= 500) return stored.arrayBuffer();
    throw new Error(`fetch ${url} failed (${res.status})`);
  }
  const buf = await res.arrayBuffer();
  // Kept when it can be checked again later (an ETag) or never changes.
  if (cache && (res.headers.get('etag') || immutableUrl(url))) {
    const headers = new Headers({ 'content-type': res.headers.get('content-type') ?? 'application/octet-stream' });
    const tag = res.headers.get('etag');
    if (tag) headers.set('etag', tag);
    void cache.put(url, new Response(buf.slice(0), { headers })).catch(() => undefined);
  }
  return buf;
}

/** The file's bytes, from this machine when it already has the current version. */
export function modelBytes(url: string): Promise<ArrayBuffer> {
  let p = inFlight.get(url);
  if (!p) {
    p = load(url).finally(() => inFlight.delete(url));
    inFlight.set(url, p);
  }
  // Each reader gets its own copy (parsers may detach or keep the buffer).
  return p.then((b) => b.slice(0));
}

/** How much the stored models take (for the settings screen), and clearing them. */
export async function modelCacheSize(): Promise<{ files: number; bytes: number }> {
  const cache = await store();
  if (!cache) return { files: 0, bytes: 0 };
  const keys = await cache.keys();
  let bytes = 0;
  for (const k of keys) { const r = await cache.match(k); bytes += Number(r?.headers.get('content-length')) || (r ? (await r.clone().arrayBuffer()).byteLength : 0); }
  return { files: keys.length, bytes };
}
export async function clearModelCache(): Promise<void> {
  opened = null;
  if (typeof caches !== 'undefined') await caches.delete(CACHE);
}
