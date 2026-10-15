import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Box3 } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { buildHandbook } from '@zion/shared';
import { loadItemDisplayModel } from './weapons';
import { loadCharacterModel } from './character-model';
import { ResourceDisposer } from './resources';
import { untexturedGlb } from './test-glb';

vi.mock('@/lib/preload', () => ({ cachedFetch: async (url: string) => {
  const file = fileURLToPath(new URL(`../../../public${url}`, import.meta.url));
  if (url.endsWith('.glb')) return new Response(untexturedGlb(await readFile(file)));
  const raw = JSON.parse(await readFile(file, 'utf8'));
  // Decode geometry in Node; texture decoding is performed by the actual WebGL viewer.
  raw.textures = [];
  return new Response(JSON.stringify(raw));
} }));
describe('complete handbook models', () => {
  it.each(buildHandbook().map(entry => ({ id: entry.id, model: entry.model })))('loads non-empty 3D geometry for $id', async ({ model }) => {
    const root = 'item' in model ? await loadItemDisplayModel(model.item) : (await loadCharacterModel(model.url)).root;
    const bounds = new Box3().setFromObject(root);
    expect(bounds.isEmpty()).toBe(false);
    expect(Number.isFinite(bounds.min.x) && Number.isFinite(bounds.max.y)).toBe(true);
    new ResourceDisposer().object(root);
  });
});
