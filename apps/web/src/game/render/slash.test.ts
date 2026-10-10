import { describe, expect, it } from 'vitest';
import { type Mesh, Scene, type ShaderMaterial } from 'three';
import { SlashEffects, type SlashPose } from './slash';

describe('sword slash following', () => {
  it.each([0, 1, 2])('follows movement and turning during delay and display for variant %i', (variant) => {
    const scene = new Scene();
    const effects = new SlashEffects(scene);
    const pose = { x: 0, y: 0, z: 0, yaw: 0 };
    effects.spawn(() => pose, 2, variant);
    const cut = scene.children[0] as Mesh;
    const height = variant === 0 ? 1.4 : 1.15;
    effects.update(0.2);
    expect(cut.visible).toBe(false);
    Object.assign(pose, { x: 5, y: 2, z: -3, yaw: 1 });
    effects.update(0.21);
    expect(cut.visible).toBe(true);
    expect(cut.position.toArray()).toEqual([5, 2 + height, -3]);
    expect(cut.rotation.y).toBe(1);
    const roll = cut.rotation.z;
    Object.assign(pose, { x: 8, y: 4, z: 7, yaw: -1 });
    effects.update(0.05);
    expect(cut.position.toArray()).toEqual([8, 4 + height, 7]);
    expect(cut.rotation.y).toBe(-1);
    expect(cut.rotation.z).toBe(roll);
    effects.dispose();
  });

  it('counts each frame once when crossing the delay and expires the effect', () => {
    const scene = new Scene();
    const effects = new SlashEffects(scene);
    effects.spawn(() => ({ x: 0, y: 0, z: 0, yaw: 0 }), 2);
    const cut = scene.children[0] as Mesh;
    effects.update(0.41);
    expect(cut.visible).toBe(true);
    expect((cut.material as ShaderMaterial).uniforms.uProgress!.value).toBeCloseTo(0.01 / 0.24);
    effects.update(0.24);
    expect(cut.visible).toBe(false);
    effects.dispose();
  });

  it('cancels the pending trail when its wielder is removed', () => {
    const scene = new Scene();
    const effects = new SlashEffects(scene);
    let pose: SlashPose | null = { x: 0, y: 0, z: 0, yaw: 0 };
    effects.spawn(() => pose, 2);
    effects.update(0.2);
    pose = null;
    effects.update(0.21);
    expect(scene.children.every((cut) => !cut.visible)).toBe(true);
    effects.dispose();
  });
});
