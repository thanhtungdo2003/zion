import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Raycaster, Vector2, Vector3 } from 'three';
import { CollisionWorld, Layer, makeBox } from '@zion/physics';
import { ThirdPersonCamera, thirdPersonAim } from './third-person-camera';

function fixture() {
  return { camera: new PerspectiveCamera(75, 16 / 9, .05, 1000), boom: new ThirdPersonCamera(), focus: new Vector3(16, 1.62, 16), world: new CollisionWorld({ worldSize: 64, seaLevel: -50 }) };
}
describe('third-person shoulder camera', () => {
  it.each([0, Math.PI / 2, -Math.PI / 2, Math.PI])('stays behind the player with shoulder clearance at yaw %s', yaw => {
    const { camera, boom, focus } = fixture();
    boom.update(camera, focus, yaw, -.12, 1 / 60);
    const direction = camera.getWorldDirection(new Vector3());
    expect(camera.position.clone().sub(focus).dot(direction)).toBeCloseTo(-3.8, 8);
    expect(camera.position.clone().sub(focus).dot(new Vector3(Math.cos(yaw), 0, -Math.sin(yaw)))).toBeCloseTo(.55, 8);
    expect(camera.position.y).toBeGreaterThan(focus.y);
  });

  it('pulls in immediately before a wall and eases back after the obstruction clears', () => {
    const { camera, boom, focus, world } = fixture();
    boom.update(camera, focus, 0, 0, 1 / 60, world);
    const full = boom.distance;
    world.setOwnerColliders(1, [{ shape: makeBox(16, 2, 18, 3, 3, .1), layer: Layer.Static }]);
    boom.update(camera, focus, 0, 0, 1 / 60, world);
    expect(camera.position.z).toBeLessThan(17.9);
    const compressed = boom.distance;
    world.removeOwnerColliders(1);
    boom.update(camera, focus, 0, 0, 1 / 60, world);
    expect(boom.distance).toBeGreaterThan(compressed);
    expect(boom.distance).toBeLessThan(full);
    for (let i = 0; i < 120; i++) boom.update(camera, focus, 0, 0, 1 / 60, world);
    expect(boom.distance).toBeCloseTo(full, 5);
  });

  it('protects the camera volume when a corner misses the centre ray', () => {
    const { camera, boom, focus, world } = fixture();
    world.setOwnerColliders(1, [{ shape: makeBox(16.49, 1.62, 18, .04, .2, .1), layer: Layer.Static }]);
    boom.update(camera, focus, 0, 0, 1 / 60, world);
    expect(camera.position.z).toBeLessThan(18);
  });

  it('converges a shot from the player muzzle on the centre reticle at close and long ranges', () => {
    const { camera, boom, focus } = fixture();
    boom.update(camera, focus, 1.2, -.12, 1 / 60);
    const ray = new Raycaster();
    ray.setFromCamera(new Vector2(0, 0), camera);
    for (const distance of [5, 12, 100]) {
      const target = ray.ray.at(distance, new Vector3());
      const muzzle = focus.clone().add(new Vector3(0, -.27, 0));
      const aim = thirdPersonAim(muzzle, target);
      const shot = new Vector3(-Math.sin(aim.yaw) * Math.cos(aim.pitch), Math.sin(aim.pitch), -Math.cos(aim.yaw) * Math.cos(aim.pitch));
      expect(shot.dot(target.sub(muzzle).normalize())).toBeCloseTo(1, 10);
    }
  });

  it('recovers at the same rate across different frame rates', () => {
    const distances = [30, 60, 144].map(fps => {
      const { camera, boom, focus, world } = fixture();
      world.setOwnerColliders(1, [{ shape: makeBox(16, 2, 18, 3, 3, .1), layer: Layer.Static }]);
      boom.update(camera, focus, 0, 0, 1 / fps, world);
      world.removeOwnerColliders(1);
      for (let i = 0; i < fps / 2; i++) boom.update(camera, focus, 0, 0, 1 / fps, world);
      return boom.distance;
    });
    for (const d of distances) expect(d).toBeCloseTo(distances[0]!, 10);
  });
});
