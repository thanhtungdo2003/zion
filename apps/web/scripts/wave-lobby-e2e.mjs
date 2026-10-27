/** Wave lobby preview: a disposable Edge CDP session at localhost:9444, mocked API, screenshots in tmp/e2e/wave-lobby. */
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const req = createRequire(import.meta.resolve('vitest')), vite = createRequire(req.resolve('vite'));
const { build } = vite('esbuild');
const dir = path.join(root, 'tmp/e2e/wave-lobby'); await mkdir(dir, { recursive: true });
await build({ entryPoints: [path.join(root, 'apps/web/scripts/wave-lobby-preview.tsx')], outfile: path.join(dir, 'page.js'), bundle: true, jsx: 'automatic',
  format: 'esm', platform: 'browser', target: 'es2022', alias: { '@': path.join(root, 'apps/web/src') },
  define: { 'process.env.NEXT_PUBLIC_API_URL': '"same-origin"', 'process.env.NODE_ENV': '"production"', 'process.env': '{}' }, logLevel: 'warning' });
const css = await readFile(path.join(root, 'apps/web/src/app/globals.css'), 'utf8');
const json = (res, body) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); };
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  if (url.pathname === '/') { response.setHeader('content-type', 'text/html; charset=utf-8'); response.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script type="module" src="/page.js"></script>`); return; }
  if (url.pathname === '/page.js') { response.setHeader('content-type', 'text/javascript'); response.end(await readFile(path.join(dir, 'page.js'))); return; }
  if (url.pathname === '/api/auth/login') return json(response, { accessToken: 't', expiresIn: 900, account: { id: '00000000-0000-4000-8000-000000000001', username: 'Ann', guest: false } });
  if (url.pathname === '/api/waves/maps') return json(response, { maps: [{ id: 'kho-hang', name: 'Kho hàng', thumbnail: null, players: 3 }, { id: 'thi-tran', name: 'Thị trấn đêm', thumbnail: null, players: 0 }, { id: 'ben-cang', name: 'Bến cảng', thumbnail: null, players: 0 }] });
  if (url.pathname === '/api/waves/leaderboard') return json(response, { mapId: 'kho-hang', board: url.searchParams.get('board'), rows: [
    { position: 1, members: ['Ann', 'Hổ Mang (bot)'], cleared: 14, clearMs: 812000, survivedMs: 840000, at: Date.now() },
    { position: 2, members: ['Bảo'], cleared: 11, clearMs: 640000, survivedMs: 700000, at: Date.now() },
    { position: 3, members: ['Cường'], cleared: 9, clearMs: 500000, survivedMs: 530000, at: Date.now() },
    { position: 4, members: ['Dũng'], cleared: 4, clearMs: 200000, survivedMs: 240000, at: Date.now() }] });
  if (url.pathname.startsWith('/images/')) { try { response.end(await readFile(path.join(root, 'apps/web/public', url.pathname))); } catch { response.writeHead(404).end(); } return; }
  response.writeHead(404).end();
});
await new Promise((resolve) => server.listen(3188, '127.0.0.1', resolve));
const endpoint = process.env.RENDER_CDP ?? 'http://127.0.0.1:9444';
let ws;
try {
  const errors = [];
  for (const [view, w, h] of [['bots', 1280, 800], ['party', 1280, 800], ['join', 1280, 800], ['boards', 1280, 800], ['bots', 390, 844]]) {
    const target = await (await fetch(`${endpoint}/json/new?about:blank`, { method: 'PUT' })).json();
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    let id = 0; const pending = new Map();
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text); };
    const cmd = (method, params = {}) => new Promise((resolve) => { const n = ++id; pending.set(n, resolve); ws.send(JSON.stringify({ id: n, method, params })); });
    await cmd('Runtime.enable');
    await cmd('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 500 });
    await cmd('Page.navigate', { url: `http://127.0.0.1:3188/?view=${view}` });
    const start = Date.now();
    while (!(await cmd('Runtime.evaluate', { expression: '!!window.preview?.ready', returnByValue: true })).result?.value) { if (Date.now() - start > 30000) throw new Error('preview timed out'); await new Promise((r) => setTimeout(r, 200)); }
    await new Promise((r) => setTimeout(r, 600));
    const shot = await cmd('Page.captureScreenshot', { format: 'png' });
    await writeFile(path.join(dir, `${view}-${w}.png`), Buffer.from(shot.data, 'base64'));
    await cmd('Page.close'); ws.close();
  }
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('ok', dir);
} finally { ws?.close(); server.close(); }
