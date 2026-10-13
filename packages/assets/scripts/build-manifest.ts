/**
 * Asset pipeline: validates source models in /assets/source, copies them to the web app's public
 * folder under content-hashed names and writes /assets/manifest.json.
 *
 *   pnpm assets:build
 *
 * - .glb      → header/chunk structure + embedded JSON validated, size-limited.
 * - .bbmodel  → JSON validated against the bbmodel schema (embedded PNG textures only).
 * Every registry asset that references a file must resolve, otherwise the build fails.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUILTIN_ASSETS } from '../src/builtin';
import { parseBBModel } from '../src/bbmodel';
import { MAX_BBMODEL_BYTES, MAX_GLB_BYTES, assetManifestSchema, type AssetManifest } from '../src/manifest';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const sourceDir = path.join(repoRoot, 'assets/source');
const gameModelsDir = path.join(repoRoot, 'models');
const publicDir = path.join(repoRoot, 'apps/web/public/assets');
const modelsOut = path.join(publicDir, 'models');

async function walk(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(full)));
    else if (e.isFile()) out.push(full);
  }
  return out;
}

function validateGlb(buf: Buffer, rel: string): void {
  if (buf.length > MAX_GLB_BYTES) throw new Error(`${rel}: exceeds ${MAX_GLB_BYTES} bytes`);
  if (buf.length < 20) throw new Error(`${rel}: too small to be a GLB`);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`${rel}: bad GLB magic`);
  if (buf.readUInt32LE(4) !== 2) throw new Error(`${rel}: only glTF 2.0 is supported`);
  if (buf.readUInt32LE(8) !== buf.length) throw new Error(`${rel}: GLB length header mismatch`);
  const jsonLen = buf.readUInt32LE(12);
  if (buf.readUInt32LE(16) !== 0x4e4f534a) throw new Error(`${rel}: first chunk must be JSON`);
  if (20 + jsonLen > buf.length) throw new Error(`${rel}: JSON chunk overruns file`);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8')) as { asset?: { version?: string }; buffers?: Array<{ uri?: string }> };
  if (json.asset?.version !== '2.0') throw new Error(`${rel}: asset.version must be 2.0`);
  if (json.buffers?.some((b) => b.uri !== undefined)) throw new Error(`${rel}: external buffer URIs are not allowed`);
}

async function main(): Promise<void> {
  const files = [...await walk(sourceDir), ...await walk(gameModelsDir)].filter((f) => /\.(glb|bbmodel)$/i.test(f));
  await rm(modelsOut, { recursive: true, force: true });
  await mkdir(modelsOut, { recursive: true });

  const manifest: AssetManifest = { version: 1, generatedAt: new Date().toISOString(), files: {} };
  for (const file of files.sort()) {
    const isGameModel = file.startsWith(gameModelsDir + path.sep);
    const rel = path.relative(isGameModel ? gameModelsDir : sourceDir, file).split(path.sep).join('/');
    // Keep authored packs in /models. Deploy only the prepared, individually placeable GLBs.
    if (isGameModel && /^(buildings|vehicles)\//.test(rel) && !BUILTIN_ASSETS.some(a => a.model.kind === 'glb' && a.model.path === rel)) continue;
    if (manifest.files[rel]) throw new Error(`duplicate model path: ${rel}`);
    if (!/^[a-z0-9_\-/]+\.(glb|bbmodel)$/.test(rel)) throw new Error(`${rel}: use lowercase a-z0-9_- path names`);
    const info = await stat(file);
    const buf = await readFile(file);
    const kind = rel.endsWith('.glb') ? 'glb' : 'bbmodel';
    if (kind === 'glb') validateGlb(buf, rel);
    else {
      if (info.size > MAX_BBMODEL_BYTES) throw new Error(`${rel}: exceeds ${MAX_BBMODEL_BYTES} bytes`);
      parseBBModel(JSON.parse(buf.toString('utf8')));
    }
    if (isGameModel) {
      const served = path.join(repoRoot, 'apps/web/public/models', rel);
      await mkdir(path.dirname(served), { recursive: true });
      await writeFile(served, buf);
    }
    const sha256 = createHash('sha256').update(buf).digest('hex');
    const ext = path.extname(rel);
    const outName = `${rel.slice(0, -ext.length).replace(/\//g, '_')}.${sha256.slice(0, 12)}${ext}`;
    await writeFile(path.join(modelsOut, outName), buf);
    manifest.files[rel] = { url: `/assets/models/${outName}`, sha256, bytes: buf.length, kind };
  }

  const missing = BUILTIN_ASSETS.filter(
    (a) => (a.model.kind === 'glb' || a.model.kind === 'bbmodel') && !manifest.files[a.model.path],
  ).map((a) => a.id);
  if (missing.length) throw new Error(`assets reference missing model files: ${missing.join(', ')}`);

  assetManifestSchema.parse(manifest);
  await writeFile(path.join(publicDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  const soundsOut = path.join(repoRoot, 'apps/web/public/sounds');
  for (const file of await walk(path.join(repoRoot, 'sounds'))) {
    const rel = path.relative(path.join(repoRoot, 'sounds'), file);
    if (!rel.startsWith('musics' + path.sep) && !/^(car|motorcycle)-engine-(active|noise)\.mp3$/.test(rel)
      && !['braking-on-gravel.mp3','car-crash-sound-effect.mp3','sound-effect-car-crash.mp3'].includes(rel)) continue;
    const dest = path.join(soundsOut, rel);
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, await readFile(file));
  }
  console.log(`asset manifest: ${Object.keys(manifest.files).length} file(s) → ${path.relative(repoRoot, publicDir)}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
