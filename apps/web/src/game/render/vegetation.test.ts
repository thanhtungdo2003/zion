import { describe, expect, it, vi } from 'vitest';
import { Scene, type InstancedMesh } from 'three';
import { Surface, quantizeHeight, type ChunkData, type VegetationMessage } from '@zion/shared';
import { VegetationRenderer } from './vegetation';

vi.mock('./asset-library', () => ({ windUniforms: { uTime: { value: 0 } } }));

function fixture() {
  const chunk: ChunkData = {
    cx: 0, cz: 0, lod: 0, verts: 33,
    heights: new Uint16Array(35 * 35).fill(quantizeHeight(0)),
    water: new Uint16Array(33 * 33), biome: new Uint8Array(33 * 33),
    surface: new Uint8Array(33 * 33).fill(Surface.Grass),
    temperature: new Uint8Array(33 * 33).fill(150), humidity: new Uint8Array(33 * 33).fill(180),
    props: [], cosmeticSeed: 17,
  };
  const scene = new Scene();
  const renderer = new VegetationRenderer(scene, (cx, cz) => cx === 0 && cz === 0 ? chunk : undefined, -10);
  renderer.update(1, 1);
  const mesh = scene.children.find((child) => child.name.startsWith('vegetation:') && child.name !== 'vegetation:moss') as InstancedMesh;
  const original = (mesh.instanceMatrix.array as Float32Array).slice(0, 16);
  const lx = Math.floor(original[12]!);
  const lz = Math.floor(original[14]!);
  const message: VegetationMessage = { t: 'vegetation', reset: false, chunks: [{ cx: 0, cz: 0, cells: [[lx, lz, 0, 4000]] }] };
  return { renderer, scene, mesh, original, message };
}

describe('vegetation damage rendering', () => {
  it('hides hit plants immediately and restores their exact original transforms', () => {
    const { renderer, mesh, original, message } = fixture();
    renderer.applyDamage(message);
    expect(Math.abs(mesh.instanceMatrix.array[0]!)).toBe(0);
    expect(Math.abs(mesh.instanceMatrix.array[5]!)).toBe(0);
    expect(mesh.instanceMatrix.array[12]).toBe(original[12]);
    renderer.applyDamage({ t: 'vegetation', reset: false, chunks: [{ cx: 0, cz: 0, cells: [] }] });
    expect((mesh.instanceMatrix.array as Float32Array).slice(0, 16)).toEqual(original);
    renderer.dispose();
  });

  it('preserves damage when a chunk unloads, rebuilds or upgrades its LOD', () => {
    const { renderer, scene, message, mesh } = fixture();
    renderer.applyDamage(message);
    renderer.update(1000, 1000);
    expect(scene.children).toHaveLength(0);
    renderer.update(1, 1);
    const rebuilt = scene.children.find((child) => child.name === mesh.name) as InstancedMesh;
    expect(Math.abs(rebuilt.instanceMatrix.array[0]!)).toBe(0);
    renderer.invalidate(0, 0);
    renderer.update(1, 1);
    const upgraded = scene.children.find((child) => child.name === mesh.name) as InstancedMesh;
    expect(Math.abs(upgraded.instanceMatrix.array[0]!)).toBe(0);
    renderer.applyDamage({ t: 'vegetation', reset: true, chunks: [] });
    expect(upgraded.instanceMatrix.array[0]).not.toBe(0);
    renderer.dispose();
  });

  it('emits fire on occupied cells while burning and stops at the server expiry', () => {
    const { renderer, message } = fixture();
    renderer.applyDamage(message);
    const emit = vi.fn();
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    renderer.emitBurning(1000, emit);
    expect(emit).toHaveBeenCalledTimes(1);
    renderer.emitBurning(1010, emit);
    expect(emit).toHaveBeenCalledTimes(1);
    renderer.emitBurning(4000, emit);
    expect(emit).toHaveBeenCalledTimes(1);
    random.mockRestore();
    renderer.dispose();
  });
});
