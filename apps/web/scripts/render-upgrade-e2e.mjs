/** Run with a disposable Edge CDP session at localhost:9444. No game/database/server required. */
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const req = createRequire(import.meta.resolve('vitest')), vite = createRequire(req.resolve('vite'));
const { build } = vite('esbuild');
const dir = path.join(root, 'tmp/e2e/render-upgrade'); await mkdir(dir, { recursive: true });
await build({ entryPoints: [path.join(root, 'apps/web/scripts/render-upgrade-scene.ts')], outfile: path.join(dir, 'scene.js'), bundle: true,
  format: 'esm', platform: 'browser', target: 'es2022', external: ['node:module'], alias: { '@': path.join(root, 'apps/web/src') }, define: { 'process.env': '{}' }, logLevel: 'warning' });
const mime = { '.js': 'text/javascript', '.glb': 'model/gltf-binary', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/') { response.setHeader('content-type', 'text/html'); response.end('<script type="module" src="/scene.js"></script>'); return; }
    const baseDir = url.pathname === '/scene.js' ? dir : path.join(root, 'apps/web/public');
    const file = path.resolve(baseDir, '.' + url.pathname);
    if (!file.startsWith(path.resolve(baseDir) + path.sep)) { response.writeHead(403).end(); return; }
    response.setHeader('content-type', mime[path.extname(file)] ?? 'application/octet-stream');
    response.end(await readFile(file));
  } catch { response.writeHead(404).end(); }
});
await new Promise((resolve) => server.listen(3187, '127.0.0.1', resolve));
const endpoint = process.env.RENDER_CDP ?? 'http://127.0.0.1:9444';
let ws;
try {
  const target = await (await fetch(`${endpoint}/json/new?http://127.0.0.1:3187/`, { method: 'PUT' })).json();
  ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let seq = 0; const pending = new Map(), errors = [];
  ws.onmessage = (event) => { const m = JSON.parse(event.data); if (m.id) { const p = pending.get(m.id); pending.delete(m.id); if (m.error) p.reject(new Error(JSON.stringify(m.error))); else p.resolve(m.result); }
    else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
    else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.value ?? a.description).join(' ')); };
  const cmd = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
  const js = async (expression) => { const r = await cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; };
  await cmd('Runtime.enable'); await cmd('Page.enable');
  await cmd('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await cmd('Page.navigate', { url: 'http://127.0.0.1:3187/' });
  const start = Date.now();
  while (!await js('!!window.upgrade?.ready')) { if (errors.length) throw new Error(errors.join('\n')); if (Date.now() - start > 90000) throw new Error('Visual scene timed out'); await new Promise((r) => setTimeout(r, 250)); }
  await new Promise((r) => setTimeout(r, 1500));
  for (const mode of ['terrain-before', 'terrain-after', 'terrain-wet', 'sky-day', 'sky-night', 'animation-walk', 'animation-jog', 'animation-sprint']) {
    await js(`window.upgrade.capture(${JSON.stringify(mode)})`);
    const shot = await cmd('Page.captureScreenshot', { format: 'png' }); await writeFile(path.join(dir, `${mode}.png`), Buffer.from(shot.data, 'base64'));
  }
  const report = await js('window.upgrade.report'); report.errors = errors;
  await writeFile(path.join(dir, 'report.json'), JSON.stringify(report, null, 2));
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(JSON.stringify(report, null, 2));
  await cmd('Page.close');
} finally { ws?.close(); server.close(); }
