import { deflateSync, inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { decodePng, encodePng } from '@zion/assets/model-studio';
import { ImageLibrary, fitWithin, flatten, usableLicense, weather } from './images';
import type { ModelStudioStore } from './store';

const png = (w: number, h: number, alpha: number) => {
  const d = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) d.set([200, 30, 30, alpha], i * 4);
  return Buffer.from(encodePng(w, h, d, (b) => new Uint8Array(deflateSync(b)), true));
};

describe('sign pictures', () => {
  it('keeps only licences a game may use and change', () => {
    for (const l of ['Public domain', 'CC0', 'CC BY 4.0', 'CC BY-SA 3.0', 'PD-self']) expect(usableLicense(l)).toBe(true);
    for (const l of ['CC BY-NC 2.0', 'CC BY-ND 4.0', 'CC BY-NC-SA 3.0', 'Fair use', 'GFDL', '']) expect(usableLicense(l)).toBe(false);
  });

  it('scales down, fills see-through corners and ages a picture', () => {
    const img = decodePng(new Uint8Array(png(2048, 1024, 0)), (b) => new Uint8Array(inflateSync(b)));
    const small = fitWithin(img, 1024);
    expect([small.width, small.height]).toEqual([1024, 512]);
    flatten(small);
    expect(Array.from(small.data.slice(0, 4))).toEqual([214, 216, 214, 255]);
    const red = decodePng(new Uint8Array(png(64, 64, 255)), (b) => new Uint8Array(inflateSync(b)));
    weather(red, 1, 7);
    // Faded: the red pales towards grey.
    expect(red.data[0]! - red.data[1]!).toBeLessThan(170);
  });

  it('searches Wikimedia Commons and Openverse, drops unusable licences, and stores the picture found', async () => {
    const calls: string[] = [];
    const fake = (async (url: string) => {
      calls.push(url);
      if (url.includes('commons.wikimedia.org')) return new Response(JSON.stringify({ query: { pages: {
        1: { pageid: 1, index: 1, title: 'File:Vietnam road sign P.131a.svg', imageinfo: [{ url: 'https://upload/a.svg', thumburl: 'https://upload/a.png', width: 600, height: 600, mime: 'image/svg+xml', descriptionurl: 'https://commons/a', extmetadata: { LicenseShortName: { value: 'Public domain' }, Artist: { value: '<a>Someone</a>' } } }] },
        2: { pageid: 2, index: 2, title: 'File:Ad.jpg', imageinfo: [{ url: 'https://upload/b.jpg', width: 800, height: 600, mime: 'image/jpeg', descriptionurl: 'https://commons/b', extmetadata: { LicenseShortName: { value: 'CC BY-NC 2.0' } } }] },
      } } }));
      if (url.includes('openverse')) return new Response(JSON.stringify({ results: [{ id: 'abc', title: 'Old poster', url: 'https://img/c.jpg', width: 900, height: 1200, license: 'by-sa', license_version: '4.0', creator: 'X', foreign_landing_url: 'https://flickr/c', filetype: 'jpg' }] }));
      if (url === 'https://upload/a.png') return new Response(png(600, 600, 128));
      return new Response('nope', { status: 404 });
    }) as unknown as typeof fetch;
    const files: Array<{ name: string; bytes: Buffer }> = [];
    const store = { addFile: async (_p: string, name: string, bytes: Buffer) => { files.push({ name, bytes }); return { id: `f${files.length}`, name, mime: 'image/png', size: bytes.length }; } } as unknown as ModelStudioStore;
    const lib = new ImageLibrary(store, null, fake);
    const hits = await lib.search('Vietnam road sign no parking', 10);
    expect(hits.map((h) => h.id)).toEqual(['wm:1', 'ov:abc']);
    expect(hits[0]).toMatchObject({ license: 'Public domain', author: 'Someone' });
    const pic = await lib.download('p1', 'wm:1', { age: .5 });
    expect(pic).toMatchObject({ width: 600, height: 600, aged: true, source: { kind: 'web', license: 'Public domain', url: 'https://commons/a' } });
    // Stored opaque (the see-through half filled in).
    const stored = decodePng(new Uint8Array(files[0]!.bytes), (b) => new Uint8Array(inflateSync(b)));
    expect(stored.data[3]).toBe(255);
    await expect(lib.download('p1', 'wm:999')).rejects.toThrow();
    expect(lib.canPaint).toBe(false);
  });
});
