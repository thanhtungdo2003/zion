import { describe, expect, it, vi } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, ShaderMaterial, Texture } from 'three';
import { ResourceDisposer } from './resources';

describe('owned graphics resources', () => {
  it('releases shared geometry, materials and all texture slots exactly once across template roots', () => {
    const texture = new Texture();
    const geometry = new BoxGeometry();
    const material = new MeshBasicMaterial({ map: texture, alphaMap: texture });
    const root = new Group().add(new Mesh(geometry, material), new Mesh(geometry, material));
    const disposed = [geometry, material, texture].map((r) => vi.spyOn(r, 'dispose'));
    const resources = new ResourceDisposer();
    resources.object(root);
    resources.object(root.clone(true));
    for (const spy of disposed) expect(spy).toHaveBeenCalledTimes(1);
  });

  it('releases shader textures as well as regular material maps', () => {
    const texture = new Texture();
    const material = new ShaderMaterial({ uniforms: { uTexture: { value: texture } } });
    const dispose = vi.spyOn(texture, 'dispose');
    new ResourceDisposer().release(material);
    expect(dispose).toHaveBeenCalledOnce();
  });
});
