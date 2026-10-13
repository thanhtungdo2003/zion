import { describe, expect, it, vi } from 'vitest';
import { Mesh, Scene, Vector3, type BufferGeometry, type Material } from 'three';
import { CombatEffects } from './effects';
import { WeaponId } from '@zion/shared';
import type { SoundBank } from '../audio';

describe('combat visual resources', () => {
  it('renders a glowing round without a line trail and replays gravity and drag', () => {
    const scene = new Scene();
    const effects = new CombatEffects(scene, null, null, () => new Vector3());
    effects.launch({ t: 'proj', id: 1, ownerId: 2, w: WeaponId.AK47, kind: 'bullet', x: 0, y: 10, z: 0, vx: 100, vy: 0, vz: 0, gravity: 9.81, drag: .12, maxFlightSec: 1 });
    const mesh = scene.children.find((node): node is Mesh => node instanceof Mesh)!;
    expect(mesh.children).toHaveLength(1);
    expect(scene.children.some(node => node.type === 'LineSegments')).toBe(false);
    effects.update(.1, null);
    expect(mesh.position.x).toBeGreaterThan(0); expect(mesh.position.x).toBeLessThan(10);
    expect(mesh.position.y).toBeLessThan(10);
    effects.endRound(1, 9, 9, 0, false);
    expect(mesh.parent).toBeNull();
    effects.dispose();
    expect(scene.children).toHaveLength(0);
  });
  it('plays one PKM report per round across the full magazine without an audio loop', () => {
    const sounds = { loopAt: vi.fn(), stopLoop: vi.fn(), play: vi.fn(), stop: vi.fn() };
    const effects = new CombatEffects(new Scene(), null, sounds as unknown as SoundBank, () => new Vector3());
    const shot = { weapon: WeaponId.PKM, muzzle: new Vector3(), dir: new Vector3(1, 0, 0), eject: null, right: null, ends: [] };
    for (let i = 0; i < 100; i++) {
      effects.shot(1, shot);
      effects.update(.1, null);
      expect(sounds.play).toHaveBeenCalledTimes(i + 1);
    }
    effects.update(2, null);
    expect(sounds.play).toHaveBeenCalledTimes(100);
    expect(sounds.play).toHaveBeenLastCalledWith('pkmShot', expect.objectContaining({ at: shot.muzzle }));
    expect(sounds.loopAt).not.toHaveBeenCalled();
    effects.dispose();
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
