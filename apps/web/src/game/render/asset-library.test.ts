import { describe, expect, it, vi } from 'vitest';
import { BoxGeometry, MeshBasicMaterial, Texture } from 'three';
import { createDefaultRegistry } from '@zion/assets';
import { AssetLibrary, type AssetVisual } from './asset-library';

describe('asset library teardown', () => {
  it('releases late async results without repopulating a disposed world', async () => {
    const registry = createDefaultRegistry();
    const def = [...registry.all()][0]!;
    const library = new AssetLibrary(registry);
    const texture = new Texture();
    const geometry = new BoxGeometry();
    const material = new MeshBasicMaterial({ map: texture });
    const releases = [geometry, material, texture].map((r) => vi.spyOn(r, 'dispose'));
    let finish!: (visual: AssetVisual) => void;
    vi.spyOn(library as unknown as { build(): Promise<AssetVisual> }, 'build')
      .mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const pending = library.load(def.numericId);
    library.dispose();
    finish({ def, parts: [{ geometry, material }] });
    await pending;
    expect(library.get(def.numericId)).toBeUndefined();
    expect(library.load(def.numericId)).toBeUndefined();
    library.dispose();
    for (const release of releases) expect(release).toHaveBeenCalledOnce();
  });
});
