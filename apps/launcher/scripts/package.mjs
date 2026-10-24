// Builds the launcher and packs it for the site's download button:
//   apps/web/public/downloads/zion.zip     ZION.exe + zion.json (the game's address) + README
//   apps/web/public/downloads/launcher.json {"version"} — the game page tells older launchers to update.
// Usage (repo root): ZION_URL=https://your-game-site pnpm --filter @zion/launcher package
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const here = path.resolve(import.meta.dirname, '..');
const web = path.resolve(here, '../web/public/downloads');
const url = process.env.ZION_URL || 'http://localhost:3000';
const { version } = JSON.parse(readFileSync(path.join(here, 'src-tauri/tauri.conf.json'), 'utf8'));

execFileSync('pnpm', ['exec', 'tauri', 'build', '--no-bundle'], { cwd: here, stdio: 'inherit', shell: true, env: { ...process.env, ZION_URL: url } });

const stage = path.join(here, 'target-zip/ZION');
rmSync(path.dirname(stage), { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
copyFileSync(path.join(here, 'src-tauri/target/release/zion-launcher.exe'), path.join(stage, 'ZION.exe'));
writeFileSync(path.join(stage, 'zion.json'), JSON.stringify({ url }, null, 2));
writeFileSync(path.join(stage, 'README.txt'), [
  'ZION — giải nén thư mục này rồi chạy ZION.exe.',
  'Game luôn tải bản mới nhất từ máy chủ mỗi lần mở: không cần tải lại ZIP khi game cập nhật.',
  'Cần Windows 10/11 (có sẵn Microsoft Edge WebView2) và kết nối Internet.',
  '',
].join('\r\n'));
mkdirSync(web, { recursive: true });
const zip = path.join(web, 'zion.zip');
rmSync(zip, { force: true });
execFileSync('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path '${stage}' -DestinationPath '${zip}' -Force`], { stdio: 'inherit' });
writeFileSync(path.join(web, 'launcher.json'), JSON.stringify({ version }));
console.log(`packed ${zip} (launcher ${version}, game ${url})`);
