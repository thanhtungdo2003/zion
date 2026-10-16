/**
 * Generates the precise shot geometry of every placed model (`GEN_HIT_MESHES=1 npx vitest run
 * apps/web/src/game/render/hit-meshes.gen.test.ts`). Movement keeps the simple colliders; bullets
 * that touch one are re-tested against the model's own triangles, so shots pass through windows,
 * gaps between planks, rails and branches the way they look. Output: packages/assets/data/hit-meshes.bin
 * (copied to apps/web/public/assets for the client).
 */
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { it, vi } from 'vitest';
import { Vector3, type Texture } from 'three';
import type * as Three from 'three';
import type * as Gltf from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createDefaultRegistry, encodeHitMeshes } from '@zion/assets';

const PUBLIC = new URL('../../../public', import.meta.url);
vi.mock('@/lib/preload', async () => ({ cachedFetch: async (url: string) => new Response(await readFile(new URL(`.${url}`, `${PUBLIC.href}/`))) }));
vi.mock('three/examples/jsm/loaders/GLTFLoader.js', async (orig) => {
  const actual = await orig<typeof Gltf>();
  const { untexturedGlb } = await import('./test-glb');
  class FileGLTFLoader extends actual.GLTFLoader {
    override async loadAsync(url: string) { return this.parseAsync(untexturedGlb(await readFile(new URL(`.${url}`, `${new URL('../../../public', import.meta.url).href}/`))), ''); }
  }
  return { ...actual, GLTFLoader: FileGLTFLoader };
});
vi.mock('three', async (orig) => {
  const actual = await orig<typeof Three>();
  // Textures need a browser; geometry does not.
  class NoTextures extends actual.TextureLoader { override loadAsync(): Promise<Texture> { return Promise.resolve(new actual.Texture()); } }
  return { ...actual, TextureLoader: NoTextures };
});

/** Merges vertices closer than `cell` and drops collapsed triangles (keeps shape, cuts size). */
function simplify(tris: number[], cell: number): number[] {
  const key = (i: number) => `${Math.round(tris[i]! / cell)},${Math.round(tris[i + 1]! / cell)},${Math.round(tris[i + 2]! / cell)}`;
  const out: number[] = [], seen = new Set<string>();
  for (let i = 0; i < tris.length; i += 9) {
    const a = key(i), b = key(i + 3), c = key(i + 6);
    if (a === b || b === c || a === c) continue;
    const id = [a, b, c].sort().join('|');
    if (seen.has(id)) continue;
    seen.add(id);
    for (let k = 0; k < 9; k++) out.push(Math.round(tris[i + k]! / cell) * cell);
  }
  return out;
}

it.runIf(process.env.GEN_HIT_MESHES)('generates hit meshes', async () => {
  const realFetch = globalThis.fetch;
  const { untexturedGlb } = await import('./test-glb');
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    const data = await readFile(new URL(`.${new URL(url, 'http://x').pathname}`, `${PUBLIC.href}/`));
    return new Response(url.split('?')[0]!.endsWith('.glb') ? untexturedGlb(data) : data);
  }) as typeof fetch;
  try {
    const { AssetLibrary } = await import('./asset-library');
    const registry = createDefaultRegistry();
    const library = new AssetLibrary(registry);
    const meshes = new Map<number, Float32Array>();
    const v = new Vector3();
    for (const def of registry.all()) {
      if (def.model.kind === 'procedural' || !def.colliders.length || def.collisionLayer !== 'static') continue;
      const visual = await library.load(def.numericId);
      if (!visual) continue;
      const tris: number[] = [];
      for (const part of visual.parts) {
        const g = part.geometry, pos = g.getAttribute('position'), index = g.getIndex();
        const count = index ? index.count : pos.count;
        for (let i = 0; i < count; i++) { v.fromBufferAttribute(pos, index ? index.getX(i) : i); if (part.wheelCenter) v.add(new Vector3(...part.wheelCenter)); tris.push(v.x, v.y, v.z); }
      }
      // Fine enough for 1 cm accuracy, coarser for very large models.
      let cell = .01, simple = simplify(tris, cell);
      while (simple.length / 9 > 6000 && cell < .2) { cell *= 1.6; simple = simplify(tris, cell); }
      if (simple.length) meshes.set(def.numericId, Float32Array.from(simple));
      console.log(def.id, tris.length / 9, '→', simple.length / 9);
    }
    console.log('ERRORS', library.errors.slice(0, 6).join(' || '));
    const bin = encodeHitMeshes(meshes);
    const out = new URL('../../../../../packages/assets/data/', import.meta.url);
    await mkdir(out, { recursive: true });
    await writeFile(new URL('hit-meshes.bin', out), bin);
    await writeFile(new URL('./assets/hit-meshes.bin', `${PUBLIC.href}/`), bin);
    console.log('assets', meshes.size, 'bytes', bin.byteLength);
  } finally { globalThis.fetch = realFetch; }
}, 600_000);
