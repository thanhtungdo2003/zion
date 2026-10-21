/**
 * World Studio end-to-end check in a real browser over the Chrome DevTools protocol.
 *
 *   1. next dev -p 3100 (apps/web)
 *   2. a disposable Chromium/Edge: msedge --headless=new --remote-debugging-port=9444 --user-data-dir=<temp>
 *   3. node apps/web/scripts/world-studio-e2e.mjs [--out docs/world-editor/evidence]
 *
 * Wipes the studio's IndexedDB in that browser profile, then drives the UI like a user: create,
 * edit terrain (with undo), lake, settlement (preview → apply → props-only regeneration), match
 * setup, validation, autosave + reload, library actions (rename, duplicate, search, delete), the
 * Hắc Sơn template and the 3D view. Fails on any unhandled page exception.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
const endpoint = arg('--cdp', 'http://127.0.0.1:9444');
const base = arg('--url', 'http://localhost:3100');
const root = fileURLToPath(new URL('../../../', import.meta.url));
const out = `${root}${arg('--out', 'docs/world-editor/evidence')}`;
await mkdir(out, { recursive: true });

const target = await (await fetch(`${endpoint}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let seq = 0;
const pending = new Map(), exceptions = [], consoleErrors = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id) { const p = pending.get(m.id); pending.delete(m.id); if (m.error) p.reject(new Error(JSON.stringify(m.error))); else p.resolve(m.result); }
  else if (m.method === 'Runtime.exceptionThrown') exceptions.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
  else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') consoleErrors.push(m.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 300));
};
const cmd = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
const js = async (expression) => { const r = await cmd('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(`${expression.slice(0, 80)}: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`); return r.result.value; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(expression, timeout = 30000, label = expression) {
  const t0 = Date.now();
  for (;;) { if (await js(expression)) return Date.now() - t0; if (Date.now() - t0 > timeout) throw new Error(`Timed out (${timeout} ms): ${label}`); await sleep(150); }
}
const click = (testId) => js(`(() => { const el = document.querySelector('[data-testid="${testId}"]'); if (!el) throw new Error('missing ${testId}'); el.click(); return true; })()`);
const text = (sel) => js(`document.querySelector(${JSON.stringify(sel)})?.textContent ?? ''`);
const canvasBox = () => js(`(() => { const r = document.querySelector('[data-testid=map-canvas]').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`);
const mouse = (type, x, y, buttons = 1) => cmd('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: 1 });
async function tap(x, y) { await mouse('mouseMoved', x, y, 0); await mouse('mousePressed', x, y); await mouse('mouseReleased', x, y, 0); await sleep(40); }
const key = async (k, code = k) => { await cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: k === 'Enter' ? 13 : k === 'Escape' ? 27 : 0 }); await cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code }); };
const shot = async (name) => { const r = await cmd('Page.captureScreenshot', { format: 'png' }); await writeFile(`${out}/${name}.png`, Buffer.from(r.data, 'base64')); };
const mapHash = async () => { await mouse('mouseMoved', 5, 300, 0); await sleep(120); return hashCanvas(); };
const hashCanvas = () => js(`(() => { const c = document.querySelector('[data-testid=map-canvas]'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let h = 0; for (let i = 0; i < d.length; i += 97) h = (h * 31 + d[i]) | 0; return h; })()`);
const footer = () => js(`[...document.querySelectorAll('footer span')].map((s) => s.textContent).join(' | ')`);
const report = { browser: (await (await fetch(`${endpoint}/json/version`)).json()).Browser, steps: [] };
const step = (name, data = {}) => { report.steps.push({ name, ...data }); console.log('✓', name, JSON.stringify(data)); };

try {
  await cmd('Runtime.enable'); await cmd('Page.enable'); await cmd('Page.bringToFront');
  await cmd('Emulation.setFocusEmulationEnabled', { enabled: true });
  await cmd('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await cmd('Page.navigate', { url: `${base}/studio/world` });
  await until(`!!document.querySelector('[data-testid=map-manager]')`, 120000, 'manager');
  if (!(await js('new Promise((r) => { requestAnimationFrame(() => r(true)); setTimeout(() => r(false), 2000); })'))) throw new Error('requestAnimationFrame does not run in this tab');
  await js(`new Promise((res) => { const r = indexedDB.deleteDatabase('zion-world-studio'); r.onsuccess = r.onerror = r.onblocked = () => res(true); })`);
  await cmd('Page.reload'); await until(`!!document.querySelector('[data-testid=map-manager]')`, 60000);
  // Long tasks on the main thread (> 50 ms) while the studio works.
  await js(`(() => { window.__long = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push(Math.round(e.duration)); }).observe({ type: 'longtask', buffered: false }); return true; })()`);
  const noScroll = async (label) => { const r = await js(`({ h: document.documentElement.scrollHeight - innerHeight, w: document.documentElement.scrollWidth - innerWidth })`); if (r.h > 1 || r.w > 1) throw new Error(`${label}: page scrolls (${JSON.stringify(r)})`); };
  await noScroll('manager');
  step('Mở trang quản lý map, kho trống');

  /* Create a procedural map. */
  await click('new-map'); await until(`!!document.querySelector('[data-testid=new-map-dialog]')`);
  await click('template-procedural');
  await js(`(() => { const set = (id, v) => { const el = document.querySelector('[data-testid="' + id + '"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }; set('new-map-name', 'E2E Đồi'); set('new-map-seed', 'e2e-seed'); return true; })()`);
  await js(`[...document.querySelectorAll('[data-testid=new-map-dialog] button')].find((b) => b.textContent === 'Đồi').click()`);
  await js(`[...document.querySelectorAll('[data-testid=new-map-dialog] button')].find((b) => b.textContent === '2048 m').click()`);
  await click('create-map');
  const created = await until(`!!document.querySelector('[data-testid=world-editor]')`, 60000, 'editor after create');
  await sleep(500);
  await noScroll('editor');
  step('Tạo map từ seed (đồi, 2048 m) và mở editor', { ms: created, name: await text('[data-testid=map-name]') });
  await shot('studio-terrain');

  /* Brush stroke with undo / redo. */
  const box = await canvasBox(), cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  const before = await mapHash();
  await click('tool-raise');
  await mouse('mouseMoved', cx - 120, cy, 0); await mouse('mousePressed', cx - 120, cy);
  for (let i = 0; i <= 12; i++) await mouse('mouseMoved', cx - 120 + i * 20, cy + Math.sin(i) * 10);
  await mouse('mouseReleased', cx + 120, cy, 0); await sleep(300);
  const afterStroke = await mapHash();
  if (afterStroke === before) throw new Error('raise stroke did not change the map');
  if (await js(`document.querySelector('[data-testid=undo]').disabled`)) throw new Error('undo not available after a stroke');
  await click('undo'); await sleep(300);
  const undone = await mapHash();
  await click('redo'); await sleep(300);
  const redone = await mapHash();
  step('Nâng địa hình bằng brush, hoàn tác, làm lại', { changed: afterStroke !== before, undoRestores: undone === before, redoReapplies: redone === afterStroke });
  if (undone !== before || redone !== afterStroke) throw new Error('undo/redo did not restore the stroke exactly');
  for (const t of ['smooth', 'flatten', 'sculpt', 'noise', 'erosion', 'paint']) {
    await click(`tool-${t}`);
    await mouse('mouseMoved', cx + 40, cy + 80, 0); await mouse('mousePressed', cx + 40, cy + 80); await mouse('mouseMoved', cx + 90, cy + 90); await mouse('mouseReleased', cx + 90, cy + 90, 0); await sleep(150);
  }
  step('Smooth / Flatten / Sculpt / Noise / Erosion / Paint chạy trên viewport', { history: await footer() });

  /* A lake. */
  await click('tool-draw-lake');
  for (const [dx, dy] of [[150, -160], [230, -150], [240, -80], [160, -70]]) await tap(cx + dx, cy + dy);
  await key('Enter'); await sleep(400);
  const lakeFooter = await footer();
  if (!lakeFooter.includes('Hồ 1')) throw new Error(`lake not created: ${lakeFooter}`);
  step('Vẽ hồ (dữ liệu nước riêng + khắc lòng hồ)', { footer: lakeFooter });

  /* Settlement: draw, generate (worker), preview, apply. */
  await click('tab-settlement'); await click('tool-draw-region');
  for (const [dx, dy] of [[-260, -40], [-60, -60], [-40, 160], [-180, 200], [-280, 120]]) await tap(cx + dx, cy + dy);
  await key('Enter'); await sleep(300);
  if (!(await js(`!!document.querySelector('[data-testid=region-name]')`))) throw new Error('region not created');
  await js(`[...document.querySelectorAll('[data-testid=presets] button')].find((b) => b.textContent.startsWith('Thị trấn đông đúc')).click()`);
  await sleep(100);
  await js('window.__long = []');
  const t0 = Date.now();
  await click('generate-region');
  await until(`!!document.querySelector('[data-testid=apply-preview]')`, 60000, 'settlement preview');
  const genMs = Date.now() - t0, longTasks = await js('window.__long.slice()');
  const stats = await text('[data-testid=result-stats]');
  await shot('studio-settlement-preview');
  await click('apply-preview'); await sleep(300);
  const sFooter = await footer();
  const buildings = Number(/Công trình (\d+)/.exec(sFooter.replace(/\./g, ''))?.[1] ?? 0);
  if (!buildings) throw new Error(`no buildings after apply: ${sFooter}`);
  step('Vẽ vùng → sinh thị trấn trong worker → xem trước → áp dụng', { genMs, stats, footer: sFooter, longestMainThreadTaskMs: Math.max(0, ...longTasks) });

  await click('regen-props');
  await until(`!!document.querySelector('[data-testid=apply-preview]')`, 60000, 'props preview');
  await click('apply-preview'); await sleep(300);
  const after = await footer();
  if (Number(/Công trình (\d+)/.exec(after.replace(/\./g, ''))?.[1]) !== buildings) throw new Error('props-only regeneration changed the buildings');
  step('Sinh lại riêng cây/vật thể: công trình giữ nguyên', { footer: after });

  /* Direct editing: select a generated building on the map, drag it, delete it, undo. */
  await until(`document.querySelector('[data-testid=save-state]').textContent === 'Đã lưu'`, 15000, 'autosave before edit');
  const target0 = await js(`new Promise((res, rej) => { const r = indexedDB.open('zion-world-studio'); r.onsuccess = () => { const t = r.result.transaction('docs').objectStore('docs').getAll(); t.onsuccess = () => { const d = t.result[0]; const bs = d.regions[0].result.buildings; const b = bs.reduce((m, x) => (x.obb.hx * x.obb.hz > m.obb.hx * m.obb.hz ? x : m), bs[0]); res({ x: b.obb.x, z: b.obb.z }); r.result.close(); }; }; r.onerror = rej; })`);
  const toScreen = async ({ x, z }) => { const [vx, vz, sc] = (await js(`document.querySelector('[data-testid=map-canvas]').dataset.view`)).split(',').map(Number); const b = await canvasBox(); return [b.x + b.w / 2 + (x - vx) * sc, b.y + b.h / 2 + (z - vz) * sc]; };
  await click('tool-select');
  // Zoom in on the building first (wheel at its position) so it is several pixels wide.
  let [bx, by] = await toScreen(target0);
  for (let i = 0; i < 6; i++) { await cmd('Input.dispatchMouseEvent', { type: 'mouseWheel', x: bx, y: by, deltaX: 0, deltaY: -240 }); await sleep(60); [bx, by] = await toScreen(target0); }
  await tap(bx, by); await sleep(250);
  const inspector = await js(`[...document.querySelectorAll('aside h3')].map((h) => h.textContent).join('|')`);
  if (!inspector.includes('Công trình')) throw new Error(`building not selected: ${inspector}`);
  await mouse('mouseMoved', bx, by, 0); await mouse('mousePressed', bx, by);
  for (let i = 1; i <= 6; i++) await mouse('mouseMoved', bx + i * 4, by + i * 2);
  await mouse('mouseReleased', bx + 24, by + 12, 0); await sleep(300);
  const moved = await js(`[...document.querySelectorAll('aside p')].map((p) => p.textContent).find((t) => t.includes('đã sửa tay')) ?? ''`);
  const count = async () => Number(/Công trình (\d+)/.exec((await footer()).replace(/\./g, ''))?.[1]);
  const n0 = await count();
  await key('Delete'); await sleep(300);
  const n1 = await count();
  await click('undo'); await sleep(300);
  const n2 = await count();
  if (!moved || n1 !== n0 - 1 || n2 !== n0) throw new Error(`direct edit failed: moved=${!!moved} counts ${n0} → ${n1} → ${n2}`);
  step('Chọn công trình trên bản đồ, kéo di chuyển (đánh dấu sửa tay), xóa, hoàn tác', { before: n0, afterDelete: n1, afterUndo: n2 });
  await shot('studio-settlement');

  /* Match setup. */
  await click('tab-gameplay'); await sleep(200);
  await click('auto-spawn'); await sleep(400);
  await click('simulate-zones'); await sleep(300);
  await click('validate-gameplay'); await sleep(300);
  const gIssues = await js(`[...document.querySelectorAll('[data-testid=gameplay-issues] button')].map((b) => b.textContent)`);
  step('Gameplay: tự sinh spawn, mô phỏng vòng bo, kiểm tra', { issues: gIssues });
  await shot('studio-gameplay');

  await click('validate'); await sleep(400);
  const mapIssues = await js(`[...document.querySelectorAll('[data-testid=issues] button')].map((b) => b.textContent).slice(0, 12)`);
  step('Kiểm tra toàn bản đồ', { issues: mapIssues });

  /* Autosave, then reload from IndexedDB. */
  await until(`document.querySelector('[data-testid=save-state]').textContent === 'Đã lưu'`, 15000, 'autosave');
  const savedFooter = await footer();
  await cmd('Page.reload');
  await until(`!!document.querySelector('[data-testid=world-editor]')`, 60000, 'editor after reload');
  await sleep(400);
  const reloadedFooter = await footer();
  const strip = (f) => f.split(' | ').filter((p) => !p.startsWith('X ') && !p.startsWith('Lịch sử')).join(' | ');
  if (strip(reloadedFooter) !== strip(savedFooter)) throw new Error(`reload differs:\n${savedFooter}\n${reloadedFooter}`);
  step('Tự lưu → tải lại trang: map mở lại đúng dữ liệu', { footer: reloadedFooter });

  /* 3D preview. */
  await click('toggle-3d');
  await until(`!!document.querySelector('[data-testid=map-3d] canvas')`, 30000, '3d canvas');
  await sleep(4000);
  await shot('studio-3d');
  step('Xem trước 3D với model thật');
  await click('toggle-3d'); await sleep(300);

  /* Library actions. */
  await click('back');
  await until(`document.querySelectorAll('[data-testid=map-card]').length === 1`, 20000, 'manager list');
  await click('duplicate-map');
  await until(`document.querySelectorAll('[data-testid=map-card]').length === 2`, 20000, 'duplicate');
  await js(`document.querySelectorAll('[data-testid=edit-map]')[0].click()`);
  await until(`!!document.querySelector('[data-testid=meta-dialog-name]')`);
  await js(`(() => { const el = document.querySelector('[data-testid=meta-dialog-name]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, 'Bản đổi tên'); el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await click('meta-dialog-save');
  await until(`[...document.querySelectorAll('[data-testid=map-card] h2')].some((h) => h.textContent === 'Bản đổi tên')`, 10000, 'rename');
  await js(`(() => { const el = document.querySelector('[data-testid=search]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, 'đổi tên'); el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await until(`document.querySelectorAll('[data-testid=map-card]').length === 1`, 5000, 'search');
  await js(`(() => { const el = document.querySelector('[data-testid=search]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ''); el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await until(`document.querySelectorAll('[data-testid=map-card]').length === 2`);
  await js(`[...document.querySelectorAll('[data-testid=map-card]')].find((c) => c.querySelector('h2').textContent === 'Bản đổi tên').querySelector('[data-testid=delete-map]').click()`);
  await until(`!!document.querySelector('.confirm-dialog')`);
  await js(`document.querySelector('.confirm-dialog button[type=submit]').click()`);
  await until(`document.querySelectorAll('[data-testid=map-card]').length === 1`, 10000, 'delete');
  step('Thư viện: nhân bản, đổi tên, tìm kiếm, xóa (có xác nhận)');
  await shot('studio-manager');

  /* The live island as a template. */
  await click('new-map'); await click('template-hac-son');
  const t1 = Date.now();
  await click('create-map');
  await until(`!!document.querySelector('[data-testid=world-editor]')`, 120000, 'island template');
  const islandMs = Date.now() - t1;
  await sleep(800);
  await shot('studio-hac-son');
  step('Mẫu Đảo Hắc Sơn lấy từ WorldGenerator của game', { ms: islandMs, footer: await footer() });

  /* Narrow screen: no page scroll, inspector as a drawer. */
  await cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await sleep(500); await noScroll('mobile');
  await shot('studio-mobile');
  step('Màn hình hẹp: không cuộn trang');

  report.unhandledExceptions = exceptions;
  report.consoleErrors = consoleErrors;
  await writeFile(`${out}/world-studio-e2e.json`, `${JSON.stringify(report, null, 2)}\n`);
  if (exceptions.length) throw new Error(`Unhandled page exceptions:\n${exceptions.join('\n')}`);
  console.log(`\nAll ${report.steps.length} steps passed. Report: ${out}/world-studio-e2e.json`);
} catch (err) {
  await shot('failure').catch(() => {});
  console.error('page text:', (await js('document.body.innerText').catch(() => '')).slice(0, 1500));
  console.error('exceptions:', exceptions, 'console errors:', consoleErrors);
  throw err;
} finally {
  ws.close();
  await fetch(`${endpoint}/json/close/${target.id}`).catch(() => {});
}
