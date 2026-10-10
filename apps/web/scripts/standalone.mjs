import { cp, mkdir } from 'node:fs/promises';
import { statSync } from 'node:fs';
import path from 'node:path';

function isFile(file) {
  try { return statSync(file).isFile(); } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false;
    throw error;
  }
}

/** Support the monorepo layout and standalone artifacts from older, flat builds. */
export function standaloneEntry(webDir) {
  const candidates = [
    path.join(webDir, '.next/standalone/apps/web/server.js'),
    path.join(webDir, '.next/standalone/server.js'),
  ];
  const entry = candidates.find(isFile);
  if (!entry) {
    throw new Error(`Missing Next.js standalone server. Checked:\n${candidates.join('\n')}\nRun pnpm --filter @zion/web build from the repository root and fix any build errors before restarting web.`);
  }
  const buildId = path.join(path.dirname(entry), '.next/BUILD_ID');
  if (!isFile(buildId)) throw new Error(`Incomplete standalone build: ${buildId} is missing. Run pnpm --filter @zion/web build successfully before restarting web.`);
  return entry;
}

/** Next copies traced server files; its public and static assets must be copied separately. */
export async function prepareStandalone(webDir) {
  const entry = standaloneEntry(webDir);
  const appDir = path.dirname(entry);
  await mkdir(path.join(appDir, '.next'), { recursive: true });
  await cp(path.join(webDir, '.next/static'), path.join(appDir, '.next/static'), { recursive: true, force: true });
  await cp(path.join(webDir, 'public'), path.join(appDir, 'public'), { recursive: true, force: true });
  return entry;
}

export function readyStandaloneEntry(webDir) {
  const entry = standaloneEntry(webDir);
  const appDir = path.dirname(entry);
  for (const dir of ['.next/static', 'public']) {
    let ready = false;
    try { ready = statSync(path.join(appDir, dir)).isDirectory(); } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
    }
    if (!ready) throw new Error(`Standalone assets are missing: ${path.join(appDir, dir)}. Run pnpm --filter @zion/web build (including postbuild), or node apps/web/scripts/prepare-standalone.mjs from the repository root.`);
  }
  return entry;
}
