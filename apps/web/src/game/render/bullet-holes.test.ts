import { describe, expect, it, vi } from 'vitest';
import { Scene, Vector3, type Mesh } from 'three';
import { BulletHoles } from './bullet-holes';

describe('bullet-hole texture overlays', () => {
  it('lies against the hit surface and expires after a wall-clock minute, including a suspended tab', () => {
    const scene = new Scene();
    let now = 0;
    const holes = new BulletHoles(scene, () => now);
    holes.add(2, 3, 4, [1, 0, 0]);
    const mark = scene.children[0]!;
    expect(mark.position.x).toBeCloseTo(2.002);
    expect(new Vector3(0, 0, 1).applyQuaternion(mark.quaternion).x).toBeCloseTo(1);
    now = 59_999; holes.update(); expect(mark.parent).toBe(scene);
    now = 60_000; holes.update(); expect(mark.parent).toBeNull();
    holes.add(1, 2, 3, [0, 1, 0]);
    now = 180_000; holes.update(); expect(scene.children).toHaveLength(0);
    holes.dispose();
  });

  it('bounds memory during automatic fire and releases its shared GPU resources on teardown', () => {
    const scene = new Scene();
    const holes = new BulletHoles(scene, () => 0);
    for (let i = 0; i < 1000; i++) holes.add(i, 0, 0, [0, 0, 1]);
    expect(scene.children).toHaveLength(512);
    const mark = scene.children[0] as Mesh;
    const geometry = vi.spyOn(mark.geometry, 'dispose');
    if (Array.isArray(mark.material)) throw new Error('expected one material');
    const material = vi.spyOn(mark.material, 'dispose');
    holes.dispose(); holes.dispose();
    expect(scene.children).toHaveLength(0);
    expect(geometry).toHaveBeenCalledOnce(); expect(material).toHaveBeenCalledOnce();
  });
});
