/**
 * Generates the precise shot geometry of every placed model (`GEN_HIT_MESHES=1 npx vitest run
 * apps/web/src/game/render/hit-meshes.gen.test.ts`). Movement keeps the simple colliders; bullets
 * that touch one are re-tested against the model's own triangles and, on see-through textures
 * (fences, grates, leaves), against the texture's alpha, so shots pass through every gap the way
 * it looks. Output: packages/assets/data/hit-meshes.bin (copied to apps/web/public/assets).
 */
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolveObjectURL } from 'node:buffer';
import { createRequire } from 'node:module';
import { it, vi } from 'vitest';
import { Vector2, Vector3, type BufferAttribute, type Material, type Texture } from 'three';
import type * as Three from 'three';
import type * as Gltf from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createDefaultRegistry, encodeHitMeshes, type HitMeshData } from '@zion/assets';

const PUBLIC = new URL('../../../public', import.meta.url);
const fromPublic = (url: string) => readFile(new URL(`.${new URL(url, 'http://x').pathname}`, `${PUBLIC.href}/`));

/** Decodes any image (data:, blob: or public path) to RGBA with sharp (texture alpha only). */
async function decode(url: string): Promise<{ data: Uint8Array; width: number; height: number }> {
  const req = createRequire(createRequire(import.meta.url).resolve('next/package.json'));
  const sharp = req('sharp') as (input: Buffer) => { ensureAlpha(): { raw(): { toBuffer(o: { resolveWithObject: true }): Promise<{ data: Buffer; info: { width: number; height: number } }> } } };
  let bytes: Buffer;
  if (url.startsWith('data:')) bytes = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
  else if (url.startsWith('blob:')) bytes = Buffer.from(await resolveObjectURL(url)!.arrayBuffer());
  else bytes = await fromPublic(url);
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data), width: info.width, height: info.height };
}

vi.mock('@/lib/preload', async () => ({ cachedFetch: async (url: string) => new Response(await fromPublic(url)) }));
vi.mock('three', async (orig) => {
  const actual = await orig<typeof Three>();
  // Textures are decoded in Node only for their alpha.
  class DecodingTextureLoader extends actual.TextureLoader {
    override load(url: string, onLoad?: (t: Texture) => void, _p?: unknown, onError?: (e: unknown) => void): Texture {
      const tex = new actual.Texture();
      void decode(url).then((img) => { tex.image = img; onLoad?.(tex); }).catch((e) => onError?.(e));
      return tex;
    }
    override loadAsync(url: string): Promise<Texture> { return new Promise((res, rej) => { this.load(url, res, undefined, rej); }); }
  }
  return { ...actual, TextureLoader: DecodingTextureLoader };
});
vi.mock('three/examples/jsm/loaders/GLTFLoader.js', async (orig) => {
  const actual = await orig<typeof Gltf>();
  class FileGLTFLoader extends actual.GLTFLoader {
    override async loadAsync(url: string) { const b = await fromPublic(url); return this.parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), ''); }
  }
  return { ...actual, GLTFLoader: FileGLTFLoader };
});

/** 1-bit alpha mask (alphaTest 0.5) at most 256 px a side; null when the texture is fully opaque. */
function alphaMask(tex: Texture | null | undefined): { w: number; h: number; bits: Uint8Array } | null {
  const img = tex?.image as { data?: Uint8Array; width?: number; height?: number } | undefined;
  if (!tex || !img?.data || !img.width || !img.height) return null;
  const w = Math.min(256, img.width), h = Math.min(256, img.height), bits = new Uint8Array(Math.ceil((w * h) / 8));
  let holes = false;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    // Mask rows run in GL v (bottom up); image rows run top down when flipY is set.
    const sx = Math.floor((x + .5) * img.width / w), syGl = Math.floor((y + .5) * img.height / h);
    const sy = tex.flipY ? img.height - 1 - syGl : syGl;
    const a = img.data[(sy * img.width + sx) * 4 + 3]!;
    if (a >= 128) bits[(y * w + x) >> 3]! |= 1 << ((y * w + x) & 7); else holes = true;
  }
  return holes ? { w, h, bits } : null;
}

/** Indices of the triangles kept after merging vertices closer than `cell`. */
function simplify(tris: number[], cell: number): number[] {
  const key = (i: number) => `${Math.round(tris[i]! / cell)},${Math.round(tris[i + 1]! / cell)},${Math.round(tris[i + 2]! / cell)}`;
  const out: number[] = [], seen = new Set<string>();
  for (let t = 0; t * 9 < tris.length; t++) {
    const a = key(t * 9), b = key(t * 9 + 3), c = key(t * 9 + 6);
    if (a === b || b === c || a === c) continue;
    const id = [a, b, c].sort().join('|');
    if (seen.has(id)) continue;
    seen.add(id); out.push(t);
  }
  return out;
}

it.runIf(process.env.GEN_HIT_MESHES)('generates hit meshes', async () => {
  (globalThis as { self?: unknown }).self ??= globalThis;
  globalThis.fetch = (async (input: RequestInfo | URL) => new Response(await fromPublic(String(input)))) as typeof fetch;
  const { AssetLibrary } = await import('./asset-library');
  const registry = createDefaultRegistry();
  const library = new AssetLibrary(registry);
  const meshes = new Map<number, HitMeshData>();
  const v = new Vector3(), uv = new Vector2();
  for (const def of registry.all()) {
    if (def.model.kind === 'procedural' || !def.colliders.length || def.collisionLayer !== 'static') continue;
    const visual = await library.load(def.numericId);
    if (!visual) continue;
    const tris: number[] = [], uvs: number[] = [], maskOf: number[] = [];
    const masks: NonNullable<HitMeshData['masks']> = [];
    for (const part of visual.parts) {
      const mat = part.material as Material & { map?: Texture | null };
      const mask = alphaMask(mat.map);
      const index = mask ? masks.push(mask) - 1 : -1;
      const g = part.geometry, pos = g.getAttribute('position'), tc = g.getAttribute('uv'), ix = g.getIndex();
      const count = ix ? ix.count : pos.count;
      for (let i = 0; i + 2 < count; i += 3) {
        for (let k = 0; k < 3; k++) {
          const vi = ix ? ix.getX(i + k) : i + k;
          v.fromBufferAttribute(pos, vi);
          if (part.wheelCenter) v.add(new Vector3(...part.wheelCenter));
          tris.push(v.x, v.y, v.z);
          if (tc) uv.fromBufferAttribute(tc as BufferAttribute, vi); else uv.set(0, 0);
          uvs.push(uv.x, uv.y);
        }
        maskOf.push(tc ? index : -1);
      }
    }
    let cell = .01, keep = simplify(tris, cell);
    while (keep.length > 6000 && cell < .2) { cell *= 1.6; keep = simplify(tris, cell); }
    if (!keep.length) continue;
    const q = (x: number) => Math.round(x / cell) * cell;
    const out: HitMeshData = { tris: Float32Array.from(keep.flatMap((t) => tris.slice(t * 9, t * 9 + 9).map(q))) };
    if (masks.length && keep.some((t) => maskOf[t]! >= 0)) {
      out.uvs = Float32Array.from(keep.flatMap((t) => uvs.slice(t * 6, t * 6 + 6)));
      out.maskOf = Int16Array.from(keep.map((t) => maskOf[t]!));
      out.masks = masks;
    }
    meshes.set(def.numericId, out);
    console.log(def.id, tris.length / 9, '→', keep.length, masks.length ? `masks ${masks.length}` : '');
  }
  console.log('ERRORS', library.errors.slice(0, 6).join(' || '));
  const bin = encodeHitMeshes(meshes);
  const dir = new URL('../../../../../packages/assets/data/', import.meta.url);
  await mkdir(dir, { recursive: true });
  await writeFile(new URL('hit-meshes.bin', dir), bin);
  await writeFile(new URL('./assets/hit-meshes.bin', `${PUBLIC.href}/`), bin);
  console.log('assets', meshes.size, 'bytes', bin.byteLength);
}, 900_000);
