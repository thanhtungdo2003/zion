/**
 * Builds the ZION desktop folder: release/ZION-win-x64/ with ZION.exe, the Electron runtime, the
 * bundled web client (a static export: pages, models, textures, sounds) and an editable config.json naming the
 * online server; then zips it (release/ZION-win-x64.zip) to hand out.
 *
 *   ZION_API_URL=https://api.your-domain ZION_WEB_ORIGIN=https://your-domain pnpm --filter @zion/desktop build
 *
 * Without the variables, config.json keeps the values of the previous build (or localhost).
 * Flags: --skip-web reuses the last web build; --no-zip leaves only the folder.
 */
import { execSync } from 'node:child_process';
import { cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktop = path.resolve(here, '..'), root = path.resolve(desktop, '../..'), web = path.join(root, 'apps/web');
const args = new Set(process.argv.slice(2));
const name = 'ZION-win-x64';
const out = path.join(desktop, 'release', name);
const step = (msg) => process.stdout.write(`\n▶ ${msg}\n`);

// 1. The web client, built to talk to the API through the app's local origin.
if (!args.has('--skip-web')) {
  step('Building the web client (desktop flavour)');
  // A static export into apps/web/.next-desktop (the website's own build is untouched).
  execSync('pnpm --filter @zion/assets build:manifest', { cwd: root, stdio: 'inherit' });
  execSync('pnpm exec next build', { cwd: web, stdio: 'inherit', env: { ...process.env, NEXT_PUBLIC_API_URL: 'same-origin' } });
}
// With output: 'export' Next writes the finished site into its distDir.
const exported = path.join(web, '.next-desktop');
if (!existsSync(path.join(exported, 'index.html'))) throw new Error('Missing apps/web/.next-desktop: the web build failed.');

// 2. The Electron runtime, renamed.
step(`Assembling ${path.relative(root, out)}`);
await rm(out, { recursive: true, force: true });
await mkdir(path.dirname(out), { recursive: true });
const electronDist = path.join(desktop, 'node_modules/electron/dist');
if (!existsSync(electronDist)) throw new Error('Electron is not installed: run pnpm install (then node apps/desktop/node_modules/electron/install.js).');
await cp(electronDist, out, { recursive: true });
await rename(path.join(out, 'electron.exe'), path.join(out, 'ZION.exe'));
await rm(path.join(out, 'resources/default_app.asar'), { force: true });

// 3. The app shell and the web bundle (pages, scripts, models, textures, sounds).
const appDir = path.join(out, 'resources/app');
await mkdir(appDir, { recursive: true });
const pkg = JSON.parse(await readFile(path.join(desktop, 'package.json'), 'utf8'));
await writeFile(path.join(appDir, 'package.json'), JSON.stringify({ name: 'zion', productName: 'ZION', version: pkg.version, main: 'main.cjs' }, null, 2));
await cp(path.join(desktop, 'main.cjs'), path.join(appDir, 'main.cjs'));
// The Studios stay on the website: their pages are left out of the app.
const studioPage = (src) => /^studio([\/.]|$)/.test(path.relative(exported, src));
await cp(exported, path.join(out, 'resources/web'), { recursive: true, dereference: true, filter: (src) => !studioPage(src) });

// 4. config.json beside the exe: which online server the game plays on (players may edit it).
const prev = path.join(desktop, 'config.json');
let config = { apiUrl: 'http://localhost:4000', webOrigin: 'http://localhost:3000' };
try { config = { ...config, ...JSON.parse(await readFile(prev, 'utf8')) }; } catch { /* first build */ }
if (process.env.ZION_API_URL) config.apiUrl = process.env.ZION_API_URL;
if (process.env.ZION_WEB_ORIGIN) config.webOrigin = process.env.ZION_WEB_ORIGIN;
await writeFile(prev, JSON.stringify(config, null, 2) + '\n');
await writeFile(path.join(out, 'config.json'), JSON.stringify(config, null, 2) + '\n');
await writeFile(path.join(out, 'README.txt'), [
  'ZION — The Last Light',
  '',
  'Chạy ZION.exe để chơi. Cần kết nối Internet (máy chủ game online).',
  'F11 hoặc Alt+Enter: bật/tắt toàn màn hình.',
  '',
  `Máy chủ: ${config.apiUrl}  (sửa trong config.json nếu cần)`,
  '',
].join('\r\n'));

// 5. The zip to hand out.
if (!args.has('--no-zip')) {
  step('Zipping');
  const zip = path.join(desktop, 'release', `${name}.zip`);
  await rm(zip, { force: true });
  const tar = process.platform === 'win32' ? `"${path.join(process.env.SystemRoot ?? 'C:/Windows', 'System32', 'tar.exe')}"` : 'tar';
  execSync(`${tar} -a -c -f "${zip}" "${name}"`, { cwd: path.dirname(out), stdio: 'inherit' });
  step(`Done: ${path.relative(root, zip)}`);
} else step(`Done: ${path.relative(root, out)}`);
