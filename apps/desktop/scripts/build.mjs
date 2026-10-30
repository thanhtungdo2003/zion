/**
 * Builds the ZION desktop folder: release/ZION-win-x64/ with ZION.exe, the Electron runtime, the
 * bundled web client (a static export: pages, models, textures, sounds) and an editable config.json naming the
 * online server; then zips it (release/ZION-win-x64.zip) to hand out.
 *
 *   ZION_API_URL=https://api.your-domain ZION_WEB_ORIGIN=https://your-domain pnpm --filter @zion/desktop build
 *
 * Without the variables, config.json keeps the values of the previous build (or localhost).
 * Flags: --skip-web reuses the last web build; --no-zip leaves only the folder.
 *
 * Local test build (pnpm desktop:local): --local builds release/ZION-local-win-x64/ that never
 * updates from a server (autoUpdate off: it always plays the client just built), talking to the
 * local dev server (http://localhost:4000, `pnpm dev:server`) unless ZION_API_URL names another.
 * No update blobs, no zip, and the shared config.json is left alone.
 *
 * Content updates: the bundled client is described by resources/web-manifest.json (path → sha256),
 * and release/update/ receives the same manifest plus every file as blobs/<sha256>. Copy that
 * folder to the server's DESKTOP_UPDATE_DIR (blobs accumulate; old ones may be deleted once every
 * app has updated): installed apps then download only the files that changed.
 */
import { execSync } from 'node:child_process';
import { copyFile, cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktop = path.resolve(here, '..'), root = path.resolve(desktop, '../..'), web = path.join(root, 'apps/web');
const args = new Set(process.argv.slice(2));
const local = args.has('--local');
const name = local ? 'ZION-local-win-x64' : 'ZION-win-x64';
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
await cp(path.join(desktop, 'updater.cjs'), path.join(appDir, 'updater.cjs'));
// The Studios stay on the website: their pages are left out of the app.
const studioPage = (src) => /^studio([/.]|$)/.test(path.relative(exported, src));
await cp(exported, path.join(out, 'resources/web'), { recursive: true, dereference: true, filter: (src) => !studioPage(src) });

// 3b. The content manifest (bundled) and the update folder for the server.
step(local ? 'Writing the content manifest' : 'Writing the content manifest and update blobs');
const webDir = path.join(out, 'resources/web');
const sha256 = (file) => new Promise((resolve, reject) => {
  const h = createHash('sha256');
  createReadStream(file).on('data', (c) => h.update(c)).on('error', reject).on('end', () => resolve(h.digest('hex')));
});
const files = {};
const walk = async (dir) => {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await walk(full);
    else files[path.relative(webDir, full).split(path.sep).join('/')] = [await sha256(full), (await stat(full)).size];
  }
};
await walk(webDir);
let rev = 'local';
try { rev = execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim(); } catch { /* not a checkout */ }
const builtAt = Date.now();
const manifest = { version: `${new Date(builtAt).toISOString().slice(0, 16).replace(/[-:T]/g, '')}-${rev}`, builtAt, files };
await writeFile(path.join(out, 'resources/web-manifest.json'), JSON.stringify(manifest));
if (!local) {
  const update = path.join(desktop, 'release', 'update');
  await mkdir(path.join(update, 'blobs'), { recursive: true });
  let added = 0;
  for (const [rel, [hash]] of Object.entries(files)) {
    const blob = path.join(update, 'blobs', hash);
    if (!existsSync(blob)) { await copyFile(path.join(webDir, ...rel.split('/')), blob); added++; }
  }
  await writeFile(path.join(update, 'manifest.json'), JSON.stringify(manifest));
  step(`Content ${manifest.version}: ${Object.keys(files).length} files, ${added} new blobs in ${path.relative(root, update)}`);
}

// 4. config.json beside the exe: which online server the game plays on (players may edit it).
const prev = path.join(desktop, 'config.json');
let config = { apiUrl: 'http://localhost:4000', webOrigin: 'http://localhost:3000', autoUpdate: true };
if (!local) try { config = { ...config, ...JSON.parse(await readFile(prev, 'utf8')) }; } catch { /* first build */ }
if (process.env.ZION_API_URL) config.apiUrl = process.env.ZION_API_URL;
if (process.env.ZION_WEB_ORIGIN) config.webOrigin = process.env.ZION_WEB_ORIGIN;
if (local) config.autoUpdate = false;
else await writeFile(prev, JSON.stringify(config, null, 2) + '\n');
await writeFile(path.join(out, 'config.json'), JSON.stringify(config, null, 2) + '\n');
await writeFile(path.join(out, 'README.txt'), [
  'ZION — The Last Light',
  '',
  local ? 'Bản thử trên máy: không tự cập nhật, luôn chạy đúng bản vừa build.' : 'Chạy ZION.exe để chơi. Cần kết nối Internet (máy chủ game online).',
  'F11 hoặc Alt+Enter: bật/tắt toàn màn hình.',
  '',
  `Máy chủ: ${config.apiUrl}  (sửa trong config.json nếu cần)`,
  '',
].join('\r\n'));

// 5. The zip to hand out.
if (!local && !args.has('--no-zip')) {
  step('Zipping');
  const zip = path.join(desktop, 'release', `${name}.zip`);
  await rm(zip, { force: true });
  const tar = process.platform === 'win32' ? `"${path.join(process.env.SystemRoot ?? 'C:/Windows', 'System32', 'tar.exe')}"` : 'tar';
  execSync(`${tar} -a -c -f "${zip}" "${name}"`, { cwd: path.dirname(out), stdio: 'inherit' });
  step(`Done: ${path.relative(root, zip)}`);
} else step(`Done: ${path.relative(root, out)}`);
