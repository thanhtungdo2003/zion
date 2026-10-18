import { describe, expect, it, vi } from 'vitest';
import { BoxGeometry, MeshLambertMaterial, Scene, type InstancedMesh } from 'three';
import { Surface, quantizeHeight, quantizeLocal, quantizeScale, type ChunkData, type VegetationMessage } from '@zion/shared';
import { ALL_COVER_ASSETS, COVER_ASSETS, VegetationRenderer } from './vegetation';
import type { AssetVisual } from './asset-library';

vi.mock('./asset-library', () => ({ windUniforms: { uTime: { value: 0 } } }));

/** Every grass model as a small box (the real ones come from the asset library). */
function models() {
  const visuals = new Map<number, AssetVisual>(ALL_COVER_ASSETS.map((id) => [id, { def: { numericId: id } as AssetVisual['def'], parts: [{ geometry: new BoxGeometry(.2, .4, .2), material: new MeshLambertMaterial() }] }]));
  return { get: (id: number) => visuals.get(id), load: (id: number) => Promise.resolve(visuals.get(id)!) };
}

function chunkOf(surface: Surface, props: ChunkData['props'] = []): ChunkData {
  return {
    cx: 0, cz: 0, lod: 0, verts: 33,
    heights: new Uint16Array(35 * 35).fill(quantizeHeight(0)),
    water: new Uint16Array(33 * 33), biome: new Uint8Array(33 * 33),
    surface: new Uint8Array(33 * 33).fill(surface),
    temperature: new Uint8Array(33 * 33).fill(150), humidity: new Uint8Array(33 * 33).fill(180),
    props, cosmeticSeed: 17,
  };
}

async function fixture(chunk = chunkOf(Surface.Grass), propRadius: (asset: number) => number = () => 0) {
  const scene = new Scene();
  const renderer = new VegetationRenderer(scene, (cx, cz) => cx === 0 && cz === 0 ? chunk : undefined, -10, 0, null, models(), propRadius);
  await Promise.resolve(); await Promise.resolve();
  renderer.update(1, 1);
  const meshes = scene.children.filter((c) => c.name.startsWith('vegetation:')) as InstancedMesh[];
  return { renderer, scene, meshes };
}
const count = (meshes: InstancedMesh[], ids: readonly number[]) => meshes.filter((m) => ids.includes(Number(m.name.split(':')[1]))).reduce((n, m) => n + m.count, 0);

describe('ground cover', () => {
  it('carpets grassland densely with the grass models, a few draw calls for the whole area', async () => {
    const { renderer, meshes } = await fixture();
    expect(count(meshes, COVER_ASSETS.carpet)).toBeGreaterThan(600);
    expect(meshes.length).toBeLessThanOrEqual(ALL_COVER_ASSETS.length);
    renderer.dispose();
  });

  it('puts ferns on the forest floor and nothing on bare rock', async () => {
    const forest = await fixture(chunkOf(Surface.ForestFloor));
    expect(count(forest.meshes, COVER_ASSETS.ferns)).toBeGreaterThan(20);
    forest.renderer.dispose();
    const rock = await fixture(chunkOf(Surface.Rock));
    expect(rock.renderer.instanceCount).toBe(0);
    rock.renderer.dispose();
  });

  it('grows thick tufts at the foot of a tree on grass', async () => {
    const tree = { asset: 2445, lx: quantizeLocal(16), lz: quantizeLocal(16), yq: quantizeHeight(0), rot: 0, scale: quantizeScale(1), group: 0 };
    const bare = await fixture(chunkOf(Surface.Grass));
    const withTree = await fixture(chunkOf(Surface.Grass, [tree]), (a) => (a === 2445 ? 2 : 0));
    expect(count(withTree.meshes, COVER_ASSETS.lush)).toBeGreaterThan(count(bare.meshes, COVER_ASSETS.lush));
    bare.renderer.dispose(); withTree.renderer.dispose();
  });

  it('hides burnt plants and restores their exact transforms', async () => {
    const { renderer, meshes } = await fixture();
    const mesh = meshes.find((m) => m.count > 0)!;
    const original = (mesh.instanceMatrix.array as Float32Array).slice(0, 16);
    const lx = Math.floor(original[12]!), lz = Math.floor(original[14]!);
    const message: VegetationMessage = { t: 'vegetation', reset: false, chunks: [{ cx: 0, cz: 0, cells: [[lx, lz, 0, 4000]] }] };
    renderer.applyDamage(message);
    expect(mesh.instanceMatrix.array[0]).toBe(0);
    expect(mesh.instanceMatrix.array[12]).toBe(original[12]);
    renderer.applyDamage({ t: 'vegetation', reset: false, chunks: [{ cx: 0, cz: 0, cells: [] }] });
    expect((mesh.instanceMatrix.array as Float32Array).slice(0, 16)).toEqual(original);
    // Fire on occupied cells until the server's expiry.
    renderer.applyDamage(message);
    const emit = vi.fn(), random = vi.spyOn(Math, 'random').mockReturnValue(0);
    renderer.emitBurning(1000, emit);
    expect(emit).toHaveBeenCalledTimes(1);
    renderer.emitBurning(4000, emit);
    expect(emit).toHaveBeenCalledTimes(1);
    random.mockRestore();
    renderer.dispose();
  });
});
