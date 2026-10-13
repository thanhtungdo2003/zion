'use client';

import { SOUND_FILES } from '@/game/audio';

/**
 * Asset preloading for the main menu's loading screen. Core models and sounds are downloaded once
 * into memory; the game's loaders read through `cachedFetch`, so entering the world (a client-side
 * navigation, same JS context) needs no further downloads.
 */
const cache = new Map<string, Promise<ArrayBuffer | null>>();

function download(url: string): Promise<ArrayBuffer | null> {
  let p = cache.get(url);
  if (!p) {
    p = fetch(url)
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .catch(() => null);
    cache.set(url, p);
  }
  return p;
}

/** `fetch` that serves preloaded files from memory (falls back to the network). */
export async function cachedFetch(url: string): Promise<Response> {
  const hit = cache.get(url);
  const buf = hit ? await hit : null;
  if (buf) return new Response(buf.slice(0), { status: 200, headers: { 'content-length': String(buf.byteLength) } });
  return fetch(url);
}

interface Manifest { files: Record<string, { url: string; bytes?: number }> }

let started: Promise<void> | null = null;
let state = { done: 0, total: 0, file: '' };
const listeners = new Set<() => void>();

export function preloadState(): { done: number; total: number; file: string } {
  return state;
}

export function onPreload(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(next: Partial<typeof state>): void {
  state = { ...state, ...next };
  for (const l of listeners) l();
}

/** Downloads core models and sounds; prepared buildings/vehicles load only when nearby. */
export function preloadAll(): Promise<void> {
  started ??= (async () => {
    let manifest: Manifest | null = null;
    try {
      const r = await fetch('/assets/manifest.json', { cache: 'no-cache' });
      if (r.ok) manifest = (await r.json()) as Manifest;
    } catch {
      /* offline: the game still loads on demand */
    }
    const urls = new Set<string>();
    for (const [rel, f] of Object.entries(manifest?.files ?? {})) {
      if (/^(prepared|buildings|vehicles)\//.test(rel)) continue;
      urls.add(f.url);
      // Game models are also served by their plain path (characters, weapons, NPCs, props).
      if (!rel.startsWith('decor/') && !rel.startsWith('nature/')) urls.add(`/models/${rel}`);
    }
    for (const u of Object.values(SOUND_FILES)) urls.add(u);
    const list = [...urls];
    emit({ total: list.length, done: 0 });
    let next = 0;
    const worker = async () => {
      while (next < list.length) {
        const url = list[next++]!;
        emit({ file: url });
        await download(url);
        emit({ done: state.done + 1 });
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    emit({ file: '' });
  })();
  return started;
}
