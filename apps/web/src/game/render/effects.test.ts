import { describe, expect, it, vi } from 'vitest';
import { Mesh, Scene, Vector3, type BufferGeometry, type Material } from 'three';
import { CombatEffects } from './effects';

describe('combat visual resources', () => {
  it('reuses fallback geometry across hundreds of grenades and expires missing end events', () => {
    const scene = new Scene();
    const effects = new CombatEffects(scene, null, null, () => new Vector3());
    for (let id = 0; id < 200; id++) effects.throwGrenade(id, { x: 0, y: 1, z: 0, vx: 0, vy: 0, vz: 0, resting: true });
    const meshes = scene.children.filter((node): node is Mesh => node instanceof Mesh);
    expect(meshes).toHaveLength(200);
    expect(new Set(meshes.map((mesh) => mesh.geometry)).size).toBe(1);
    const dispose = vi.spyOn(meshes[0]!.geometry, 'dispose');
    effects.update(13, null);
    expect(scene.children.some((node) => node instanceof Mesh)).toBe(false);
    expect(dispose).not.toHaveBeenCalled();
    effects.dispose();
    expect(dispose).toHaveBeenCalledOnce();
    expect(scene.children).toHaveLength(0);
  });

  it('releases the bullet and particle buffers at teardown', () => {
    const scene = new Scene();
    const effects = new CombatEffects(scene, null, null, () => new Vector3());
    const owned = scene.children.filter((node) => 'geometry' in node) as unknown as Array<{ geometry: BufferGeometry; material: Material }>;
    const releases = owned.flatMap((node) => [vi.spyOn(node.geometry, 'dispose'), vi.spyOn(node.material, 'dispose')]);
    effects.dispose();
    for (const release of releases) expect(release).toHaveBeenCalledOnce();
  });
});
