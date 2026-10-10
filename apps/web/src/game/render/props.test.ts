import { describe, expect, it, vi } from 'vitest';
import { BoxGeometry, MeshLambertMaterial, Scene, type InstancedMesh } from 'three';
import { createDefaultRegistry } from '@zion/assets';
import type { ChunkData } from '@zion/shared';
import { PropRenderer } from './props';
import type { AssetLibrary } from './asset-library';

function fixture() {
  const def = [...createDefaultRegistry().all()][0]!;
  const geometry = new BoxGeometry();
  const material = new MeshLambertMaterial();
  const visual = { def, parts: [{ geometry, material }] };
  const library = { get: vi.fn(() => visual), load: vi.fn() };
  const chunk = { cx: 0, cz: 0, lod: 0, props: [] } as unknown as ChunkData;
  const scene = new Scene();
  const renderer = new PropRenderer(scene, library as unknown as AssetLibrary, () => [chunk]);
  let now = 0;
  function render(count: number) {
    chunk.props = Array.from({ length: count }, () => ({ asset: def.numericId, lx: 0, lz: 0, yq: 0, rot: 0, scale: 100 }));
    renderer.markDirty();
    renderer.update(0, 0, now += 300);
    return scene.children[0] as InstancedMesh | undefined;
  }
  return { renderer, geometry, material, library, scene, render, def };
}

describe('streamed prop graphics lifetime', () => {
  it('owns fade buffers and disposes the old geometry when instance capacity grows', () => {
    const { renderer, geometry, material, render } = fixture();
    const sourceDispose = vi.spyOn(geometry, 'dispose');
    const materialDispose = vi.spyOn(material, 'dispose');
    const first = render(1)!;
    expect(first.geometry).not.toBe(geometry);
    expect(geometry.hasAttribute('aFade')).toBe(false);
    const release = vi.spyOn(first.geometry, 'dispose');
    const releaseInstances = vi.spyOn(first, 'dispose');
    const grown = render(65)!;
    expect(grown).not.toBe(first);
    expect(release).toHaveBeenCalledOnce();
    expect(releaseInstances).toHaveBeenCalledOnce();
    const releaseGrown = vi.spyOn(grown.geometry, 'dispose');
    renderer.dispose();
    expect(releaseGrown).toHaveBeenCalledOnce();
    expect(sourceDispose).not.toHaveBeenCalled();
    expect(materialDispose).not.toHaveBeenCalled();
  });

  it('returns to zero retained batches and instance buffers over 500 load/unload cycles', () => {
    const { renderer, scene, render } = fixture();
    let allocated = 0, released = 0, instancesReleased = 0;
    for (let i = 0; i < 500; i++) {
      const mesh = render(1 + i % 200)!;
      allocated++;
      mesh.geometry.addEventListener('dispose', () => released++);
      mesh.addEventListener('dispose', () => instancesReleased++);
      render(0);
      expect(scene.children).toHaveLength(0);
      expect(renderer.instanceCount).toBe(0);
    }
    expect(released).toBe(allocated);
    expect(instancesReleased).toBe(allocated);
    renderer.dispose();
  });

  it('registers one completion callback per missing asset instead of one per prop', async () => {
    const { renderer, library, render, def } = fixture();
    library.get.mockReturnValue(undefined as never);
    let finish!: () => void;
    library.load.mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
    render(500);
    render(500);
    expect(library.load).toHaveBeenCalledTimes(1);
    expect(library.load).toHaveBeenCalledWith(def.numericId);
    renderer.dispose();
    const markDirty = vi.spyOn(renderer, 'markDirty');
    finish();
    await Promise.resolve();
    expect(markDirty).not.toHaveBeenCalled();
  });
});
