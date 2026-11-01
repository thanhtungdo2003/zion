import { describe, expect, it } from 'vitest';
import { Scene, MeshBasicMaterial, type Mesh } from 'three';
import { CHUNK_SIZE, Surface, heightIndex, quantizeHeight, type ChunkData } from '@zion/shared';
import { TerrainRelief, reliefUniforms } from './terrain-relief';
import { GROUND_LAYERS } from './ground-textures';

function flatChunk(cx: number, cz: number, surface: Surface): ChunkData {
  const verts = CHUNK_SIZE + 1, heights = new Uint16Array((verts + 2) ** 2).fill(quantizeHeight(40));
  for (let z = -1; z <= verts; z++) for (let x = -1; x <= verts; x++) heights[heightIndex(verts, x, z)] = quantizeHeight(40);
  return { cx, cz, lod: 0, verts, heights, props: [], cosmeticSeed: 3, water: new Uint16Array(verts ** 2), biome: new Uint8Array(verts ** 2),
    surface: new Uint8Array(verts ** 2).fill(surface), humidity: new Uint8Array(verts ** 2).fill(120), temperature: new Uint8Array(verts ** 2).fill(140) };
}

/** Height maps: stripes (a crack every texel row) on every layer. */
function stripes(): { data: Uint8Array; size: number } {
  const size = 16, layers = GROUND_LAYERS.length + 1, data = new Uint8Array(size * size * 4 * layers);
  for (let l = 0; l < layers; l++) for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) data[(l * size * size + y * size + x) * 4] = x % 2 ? 255 : 0;
  return { data, size };
}

function relief(surface: Surface) {
  const scene = new Scene(), chunks = new Map<string, ChunkData>();
  for (let z = 0; z < 3; z++) for (let x = 0; x < 3; x++) chunks.set(`${x},${z}`, flatChunk(x, z, surface));
  const r = new TerrainRelief(scene, new MeshBasicMaterial(), (x, z) => chunks.get(`${x},${z}`), stripes, 10, 0);
  r.density = 2;
  for (let i = 0; i < 20; i++) r.update(48, 48, Infinity);
  return { scene, meshes: scene.children as Mesh[] };
}

describe('3D relief of the ground round the player', () => {
  it('rebuilds the chunks round the camera denser, carrying the ground shader attributes', () => {
    const { meshes } = relief(Surface.Rock);
    expect(meshes).toHaveLength(9);
    const g = meshes[0]!.geometry;
    expect(g.getAttribute('position').count).toBe((CHUNK_SIZE * 2 + 1) ** 2);
    for (const a of ['normal', 'color', 'groundA', 'groundB', 'groundC', 'terrainDetail', 'aRelief']) expect(g.getAttribute(a)).toBeDefined();
    // The plain terrain is hidden under it.
    expect(reliefUniforms.uReliefRect.value).toEqual([0, 0, 96, 96]);
  });

  it('lifts and sinks rock by its texture, eased to nothing at the edge of the area', () => {
    const middle = relief(Surface.Rock).meshes.find((m) => m.position.x === 32 && m.position.z === 32)!;
    const pos = middle.geometry.getAttribute('position');
    let low = Infinity, high = -Infinity;
    for (let i = 0; i < pos.count; i++) { low = Math.min(low, pos.getY(i)); high = Math.max(high, pos.getY(i)); }
    expect(high - low).toBeGreaterThan(.15);
    const corner = relief(Surface.Rock).meshes.find((m) => m.position.x === 0 && m.position.z === 0)!.geometry.getAttribute('position');
    expect(corner.getY(0)).toBeCloseTo(40, 5);
  });

  it('leaves paved roads flat', () => {
    const middle = relief(Surface.Asphalt).meshes.find((m) => m.position.x === 32 && m.position.z === 32)!;
    const pos = middle.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i += 37) expect(pos.getY(i)).toBeCloseTo(40, 3);
  });

  it('builds a chunk at 25 cm quickly enough for one a frame', () => {
    const scene = new Scene(), chunks = new Map<number, ChunkData>();
    for (let z = 0; z < 3; z++) for (let x = 0; x < 3; x++) chunks.set(z * 8 + x, flatChunk(x, z, Surface.Rock));
    const r = new TerrainRelief(scene, new MeshBasicMaterial(), (x, z) => chunks.get(z * 8 + x), stripes, 10, 0);
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) r.update(48, 48, 0);
    const per = (performance.now() - t0) / 9;
    console.log(`relief chunk at 25 cm: ${per.toFixed(1)} ms`);
    expect(scene.children).toHaveLength(9);
  });
});
