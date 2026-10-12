import { describe, expect, it, vi } from 'vitest';
import { Mesh, Scene, Vector3, type BufferGeometry, type Material } from 'three';
import { CombatEffects } from './effects';
import { WeaponId } from '@zion/shared';
import type { SoundBank } from '../audio';

describe('combat visual resources', () => {
  it('keeps one PKM audio channel per shooter and stops when firing ends or the scene closes', () => {
    let now = 1000;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
    const sounds = { loopAt: vi.fn(), stopLoop: vi.fn(), play: vi.fn(), stop: vi.fn() };
    const effects = new CombatEffects(new Scene(), null, sounds as unknown as SoundBank, () => new Vector3());
    const shot = { weapon: WeaponId.PKM, muzzle: new Vector3(), dir: new Vector3(1, 0, 0), eject: null, right: null, ends: [] };
    try {
      effects.shot(1, shot); now += 100; effects.shot(1, shot); effects.shot(2, shot);
      const channel = sounds.loopAt.mock.calls[0]![0];
      expect(sounds.loopAt.mock.calls[1]![0]).toBe(channel);
      expect(sounds.loopAt.mock.calls[2]![0]).not.toBe(channel);
      expect(sounds.loopAt.mock.calls[0]![1]).toBe('pkmShot');
      expect(sounds.play).not.toHaveBeenCalled();
      now += 161; effects.update(.161, null);
      expect(sounds.stopLoop).toHaveBeenCalledTimes(2);
      effects.shot(1, shot); effects.dispose();
      expect(sounds.stopLoop).toHaveBeenCalledTimes(3);
    } finally { effects.dispose(); clock.mockRestore(); }
  });
  it('keeps planted C4 until removed by authoritative state and cleans up on detonation', () => {
    const scene = new Scene();
    const effects = new CombatEffects(scene, null, null, () => new Vector3());
    const pose = { id: 42, x: 1, y: 1, z: 1, nx: 1, ny: 0, nz: 0, stuck: true };
    effects.syncC4([pose]);
    const mesh = scene.children.find(n => n instanceof Mesh)!;
    expect(new Vector3(0, 1, 0).applyQuaternion(mesh.quaternion).x).toBeCloseTo(1);
    effects.update(30, null);
    expect(mesh.parent).toBe(scene);
    effects.syncC4([{ ...pose, x: 5 }]); effects.update(.1, null);
    expect(mesh.position.x).toBeGreaterThan(1);
    effects.syncC4([]);
    expect(mesh.parent).toBeNull();
    effects.syncC4([pose]);
    const replacement = scene.children.find(n => n instanceof Mesh)!;
    effects.explode(42, 1, 1, 1, 8);
    expect(replacement.parent).toBeNull();
    effects.dispose();
    expect(scene.children).toHaveLength(0);
  });
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
