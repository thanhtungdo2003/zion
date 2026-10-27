/**
 * Team voice end to end: a VoiceHub on localhost, two (or three) browser pages in a disposable
 * Edge debugging session (port 9444, fake microphones playing a tone) join one team's room; each
 * must connect to the other over WebRTC, hear audio and see the other speaking. A third page in
 * another team must see nobody. Run: start Edge with --remote-debugging-port=9444
 * --use-fake-device-for-media-stream --use-fake-ui-for-media-stream, then node scripts/voice-e2e.mjs
 */
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const req = createRequire(import.meta.resolve('vitest')), vite = createRequire(req.resolve('vite'));
const { build } = vite('esbuild');
const dir = path.join(root, 'tmp/e2e/voice'); await mkdir(dir, { recursive: true });
const PORT = 3189;
const shared = path.join(root, 'packages/shared/src/index.ts');
// The hub, bundled for node.
await build({ entryPoints: [path.join(root, 'apps/server/src/game/voice.ts')], outfile: path.join(dir, 'hub.cjs'), bundle: true, platform: 'node', format: 'cjs',
  alias: { '@zion/shared': shared }, external: ['bufferutil', 'utf-8-validate'], nodePaths: [path.join(root, 'apps/server/node_modules')], logLevel: 'warning' });
// The page: the real client with the ticket request answered locally.
await build({
  stdin: { contents: `import { voice } from '@/lib/voice'; window.voice = voice; voice.join(new URLSearchParams(location.search).get('kind') ?? 'waves');`, resolveDir: path.join(root, 'apps/web/src'), loader: 'ts' },
  outfile: path.join(dir, 'page.js'), bundle: true, format: 'esm', platform: 'browser', target: 'es2022',
  alias: { '@': path.join(root, 'apps/web/src'), '@zion/shared': shared },
  define: { 'process.env.NEXT_PUBLIC_API_URL': '"same-origin"', 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
  plugins: [{ name: 'ticket', setup(b) {
    b.onResolve({ filter: /^\.\/api$/ }, () => ({ path: 'api', namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ loader: 'js', contents: `export async function getGameTicket() { const who = new URLSearchParams(location.search).get('who'); return { ticket: 't-' + who, wsUrl: 'ws://127.0.0.1:${PORT}/ws' }; }` }));
  } }],
  logLevel: 'warning',
});
const { VoiceHub } = createRequire(import.meta.url)(path.join(dir, 'hub.cjs'));
const logger = { child: () => logger, debug() {}, info() {}, warn() {}, error() {} };
const teams = { ann: 'A', bao: 'A', cy: 'B' };
const hub = new VoiceHub({ consumeTicket: async (t) => ({ accountId: t.slice(2), name: t.slice(2) }), teamOf: (_k, id) => teams[id], ice: { stun: [] } }, logger);
hub.start();
const server = createServer(async (rq, rs) => {
  const url = new URL(rq.url, 'http://x');
  if (url.pathname === '/page.js') { rs.setHeader('content-type', 'text/javascript'); rs.end(await readFile(path.join(dir, 'page.js'))); return; }
  rs.setHeader('content-type', 'text/html'); rs.end('<!doctype html><meta charset="utf-8"><script type="module" src="/page.js"></script>');
});
server.on('upgrade', (rq, socket, head) => hub.upgrade(rq, socket, head));
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const endpoint = process.env.RENDER_CDP ?? 'http://127.0.0.1:9444';
async function page(who) {
  const target = await (await fetch(`${endpoint}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pending = new Map(), errors = [];
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description); };
  const cmd = (method, params = {}) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
  await cmd('Runtime.enable');
  await cmd('Page.navigate', { url: `http://127.0.0.1:${PORT}/?who=${who}` });
  const ev = async (expression) => (await cmd('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.value;
  return { ev, errors, close: async () => { await cmd('Page.close'); ws.close(); } };
}
const wait = async (fn, what, ms = 20000) => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) throw new Error(`timed out: ${what}`); await new Promise((r) => setTimeout(r, 250)); } };
let pages = [];
try {
  const ann = await page('ann'), bao = await page('bao'), cy = await page('cy');
  pages = [ann, bao, cy];
  const peers = (p) => p.ev('JSON.stringify(window.voice?.get().peers ?? [])').then((s) => JSON.parse(s ?? '[]'));
  await wait(async () => (await peers(ann)).some((p) => p.id === 'bao' && p.connected) && (await peers(bao)).some((p) => p.id === 'ann' && p.connected), 'ann and bao connected');
  // The fake microphone plays a tone: both speak, both see the other speaking.
  await wait(async () => (await peers(ann)).some((p) => p.id === 'bao' && p.speaking), 'ann sees bao speaking');
  await wait(async () => (await peers(bao)).some((p) => p.id === 'ann' && p.speaking), 'bao sees ann speaking');
  // Audio actually arrives: the remote track is live.
  await wait(() => ann.ev(`[...document.querySelectorAll('audio')].some((a) => a.srcObject && a.srcObject.getAudioTracks().some((t) => t.readyState === 'live'))`), 'remote audio');
  // Muting stops "speaking" on the other side.
  await ann.ev('window.voice.setMic(false)');
  await wait(async () => (await peers(bao)).some((p) => p.id === 'ann' && p.muted && !p.speaking), 'bao sees ann muted');
  if ((await peers(cy)).length) throw new Error('another team heard them');
  const errors = pages.flatMap((p) => p.errors);
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('ok: two teammates connected, heard each other, saw speaking and mute; the other team saw no one');
} finally {
  for (const p of pages) await p.close().catch(() => undefined);
  hub.stop(); server.close();
}
