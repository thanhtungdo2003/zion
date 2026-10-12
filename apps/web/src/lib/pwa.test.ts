import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import manifest from '../app/manifest';

interface WorkerEvent {
  request: Request;
  respondWith(response: Promise<Response>): void;
  waitUntil(work: Promise<unknown>): void;
}
function worker() {
  const listeners = new Map<string, (event: WorkerEvent) => void>();
  const offline = new Response('Offline');
  const add = vi.fn(async () => {}), remove = vi.fn(async () => true);
  const caches = {
    open: vi.fn(async () => ({ add })),
    keys: vi.fn(async () => ['zion-pwa-offline-v0', 'zion-pwa-offline-v1', 'unrelated-assets']),
    delete: remove, match: vi.fn(async () => offline),
  };
  const fetch = vi.fn(async (_request: Request) => new Response('Live game'));
  const self = { location: { origin: 'https://zion.test' }, skipWaiting: vi.fn(async () => {}), clients: { claim: vi.fn(async () => {}) }, addEventListener: (type: string, fn: (event: WorkerEvent) => void) => listeners.set(type, fn) };
  runInNewContext(readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8'), { self, caches, fetch, URL, Response });
  const event = (type: string, request = new Request('https://zion.test/')) => {
    let work: Promise<unknown> | undefined, response: Promise<Response> | undefined;
    listeners.get(type)!({ request, waitUntil: p => { work = p; }, respondWith: p => { response = p; } });
    return { work, response };
  };
  return { event, fetch, caches, add, remove, offline };
}
describe('PWA installation assets and networking', () => {
  it('launches the game menu in a standalone app and provides real PNG icons including maskable artwork', () => {
    const m = manifest();
    expect(m).toMatchObject({ id: '/', start_url: '/', scope: '/', display: 'standalone', short_name: 'ZION' });
    expect(m.icons?.some(i => i.purpose === 'maskable')).toBe(true);
    for (const icon of m.icons!) {
      const png = readFileSync(new URL('../../public' + icon.src, import.meta.url));
      expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
      expect(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`).toBe(icon.sizes);
    }
  });
  it('caches only the offline page and cleans only its own obsolete cache', async () => {
    const w = worker();
    await w.event('install').work;
    expect(w.add.mock.calls).toEqual([['/pwa/offline.html']]);
    await w.event('activate').work;
    expect(w.remove.mock.calls).toEqual([['zion-pwa-offline-v0']]);
  });
  it('does not intercept API calls, auth requests, assets or cross-origin traffic', () => {
    const w = worker();
    for (const [url, method] of [['/api/account', 'GET'], ['/auth/login', 'POST'], ['/models/weapon.bbmodel', 'GET'], ['https://api.zion.test/', 'GET']]) {
      expect(w.event('fetch', new Request(new URL(url!, 'https://zion.test'), { method })).response).toBeUndefined();
    }
    expect(w.fetch).not.toHaveBeenCalled(); expect(w.caches.match).not.toHaveBeenCalled();
  });
  it('fetches navigations live and returns the offline notice only on network failure', async () => {
    const w = worker();
    // The browser supplies navigate mode; Node forbids constructing it directly.
    const request = new Request('https://zion.test/play');
    Object.defineProperty(request, 'mode', { value: 'navigate' });
    expect(await (await w.event('fetch', request).response)!.text()).toBe('Live game');
    expect(w.caches.match).not.toHaveBeenCalled();
    w.fetch.mockRejectedValueOnce(new Error('offline'));
    expect(await w.event('fetch', request).response).toBe(w.offline);
    expect(w.caches.match).toHaveBeenCalledWith('/pwa/offline.html');
    expect(w.add).not.toHaveBeenCalled();
  });
});
