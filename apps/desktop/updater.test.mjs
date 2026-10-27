import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const { ContentStore } = createRequire(import.meta.url)('./updater.cjs');

const sha = (b) => createHash('sha256').update(b).digest('hex');
const manifest = (version, builtAt, files) =>
  ({ version, builtAt, files: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, [sha(v), v.length]])) });

let server = null;
const dirs = [];
afterEach(() => { server?.close(); server = null; for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

async function setup(shipped, published, publishedBuiltAt = 2) {
  const root = mkdtempSync(path.join(tmpdir(), 'zion-upd-')); dirs.push(root);
  const web = path.join(root, 'web'), data = path.join(root, 'data');
  for (const [rel, body] of Object.entries(shipped)) { mkdirSync(path.dirname(path.join(web, rel)), { recursive: true }); writeFileSync(path.join(web, rel), body); }
  writeFileSync(path.join(root, 'web-manifest.json'), JSON.stringify(manifest('v1', 1, shipped)));
  const blobs = new Map(Object.values(published ?? {}).map((b) => [sha(b), b]));
  let requests = 0;
  server = createServer((req, res) => {
    requests++;
    if (!published) { res.writeHead(404); res.end(); return; }
    if (req.url === '/api/desktop/manifest') { res.end(JSON.stringify(manifest('v2', publishedBuiltAt, published))); return; }
    const b = blobs.get(req.url.split('/').pop());
    if (!b) { res.writeHead(404); res.end(); return; }
    res.end(b);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const api = `http://127.0.0.1:${server.address().port}`;
  const make = () => { const s = new ContentStore({ bundledDir: web, bundledManifest: path.join(root, 'web-manifest.json'), dataDir: data, apiOrigin: api }); s.load(); return s; };
  return { make, data, requests: () => requests };
}

describe('desktop content updates', () => {
  it('downloads only changed files, verifies them, and switches only when activated', async () => {
    const env = await setup({ 'index.html': 'home', 'assets/a.glb': 'model-1', 'same.js': 'x' }, { 'index.html': 'home', 'assets/a.glb': 'model-2', 'same.js': 'x', 'new.png': 'img' });
    const store = env.make();
    expect(readFileSync(store.resolve('assets/a.glb'), 'utf8')).toBe('model-1');
    let bytes = 0;
    const r = await store.check((d) => { bytes = d; });
    expect(r).toMatchObject({ state: 'ready', version: 'v2' });
    expect(bytes).toBe('model-2'.length + 'img'.length);
    // The running game keeps the old set until it reloads.
    expect(readFileSync(store.resolve('assets/a.glb'), 'utf8')).toBe('model-1');
    store.activate();
    expect(readFileSync(store.resolve('assets/a.glb'), 'utf8')).toBe('model-2');
    expect(readFileSync(store.resolve('new.png'), 'utf8')).toBe('img');
    expect(store.resolve('same.js')).toContain(`${path.sep}web${path.sep}`);
    // Next start: the downloaded set is used straight away, nothing fetched twice.
    const again = env.make();
    expect(again.version).toBe('v2');
    expect((await again.check()).state).toBe('current');
  });

  it('plays the shipped content when offline or when nothing is published', async () => {
    const env = await setup({ 'index.html': 'home' }, null);
    const store = env.make();
    expect((await store.check()).state).toBe('unpublished');
    expect(readFileSync(store.resolve('index.html'), 'utf8')).toBe('home');
    expect(store.resolve('../secret')).toBeNull();
  });

  it('never rolls a newer app back to older content still on the server', async () => {
    const env = await setup({ 'index.html': 'new home' }, { 'index.html': 'old home' }, 0);
    const store = env.make();
    expect((await store.check()).state).toBe('current');
    store.activate();
    expect(readFileSync(store.resolve('index.html'), 'utf8')).toBe('new home');
  });

  it('removes blobs no set uses any more', async () => {
    const env = await setup({ 'index.html': 'home' }, { 'index.html': 'home2' });
    const store = env.make();
    await store.check(); store.activate();
    const blobs = path.join(env.data, 'content', 'blobs');
    writeFileSync(path.join(blobs, 'f'.repeat(64)), 'stale');
    store.gc();
    expect(readdirSync(blobs)).toEqual([sha('home2')]);
    expect(existsSync(path.join(env.data, 'content', 'incoming.json'))).toBe(false);
  });
});
