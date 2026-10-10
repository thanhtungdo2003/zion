import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { prepareStandalone, readyStandaloneEntry, standaloneEntry } from './standalone.mjs';

const roots = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    const target = path.resolve(root);
    assert.equal(path.dirname(target), path.resolve(tmpdir()));
    assert.ok(path.basename(target).startsWith('zion-standalone-'));
    await rm(target, { recursive: true, force: true });
  }
});

async function fixture(layout = 'apps/web') {
  const root = await mkdtemp(path.join(tmpdir(), 'zion-standalone-'));
  roots.push(root);
  const app = path.join(root, '.next/standalone', layout);
  await mkdir(path.join(app, '.next'), { recursive: true });
  await writeFile(path.join(app, 'server.js'), '// server');
  await writeFile(path.join(app, '.next/BUILD_ID'), 'test-build');
  await mkdir(path.join(root, '.next/static/chunks'), { recursive: true });
  await writeFile(path.join(root, '.next/static/chunks/app.js'), 'app chunk');
  await mkdir(path.join(root, 'public/models'), { recursive: true });
  await writeFile(path.join(root, 'public/models/test.bbmodel'), 'model');
  return { root, app };
}

for (const layout of ['apps/web', '']) test(`prepares and validates ${layout || 'flat'} standalone artifacts`, async () => {
  const { root, app } = await fixture(layout);
  assert.equal(standaloneEntry(root), path.join(app, 'server.js'));
  assert.throws(() => readyStandaloneEntry(root), /Standalone assets are missing/);
  await prepareStandalone(root);
  assert.equal(readyStandaloneEntry(root), path.join(app, 'server.js'));
  assert.equal(await readFile(path.join(app, '.next/static/chunks/app.js'), 'utf8'), 'app chunk');
  assert.equal(await readFile(path.join(app, 'public/models/test.bbmodel'), 'utf8'), 'model');
});

test('reports a missing build with recovery instructions', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'zion-standalone-'));
  roots.push(root);
  assert.throws(() => standaloneEntry(root), /Missing Next.js standalone server.*\n.*\n.*\nRun pnpm --filter @zion\/web build/);
});

test('rejects an incomplete standalone build', async () => {
  const { root, app } = await fixture();
  await rm(path.join(app, '.next/BUILD_ID'));
  assert.throws(() => standaloneEntry(root), /Incomplete standalone build/);
});
