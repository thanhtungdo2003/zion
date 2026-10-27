import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Raycaster, Vector2, Vector3 } from 'three';
import { CollisionWorld, Layer, makeBox } from '@zion/physics';
import { ThirdPersonCamera, thirdPersonAim, reticleAim } from './third-person-camera';

function fixture() {
  return { camera: new PerspectiveCamera(75, 16 / 9, .05, 1000), boom: new ThirdPersonCamera(), focus: new Vector3(16, 1.62, 16), world: new CollisionWorld({ worldSize: 64, seaLevel: -50 }) };
}
describe('third-person shoulder camera', () => {
  it('centres the vehicle chase camera behind the vehicle and avoids walls', () => {
    const { camera, boom, world } = fixture(), focus = new Vector3(16, 2.8, 16);
    boom.update(camera, focus, 0, -.16, 1/60, world, false, { distance: 7, height: 1 });
    expect(camera.position.x).toBeCloseTo(16);
    expect(camera.position.z).toBeGreaterThan(22);
    expect(camera.position.y).toBeGreaterThan(4);
    world.setOwnerColliders(1, [{ shape: makeBox(16, 4, 20, 3, 4, .1), layer: Layer.Static }]);
    boom.update(camera, focus, 0, -.16, 1/60, world, false, { distance: 7, height: 1 });
    expect(camera.position.z).toBeLessThan(19.9);
  });
  it.each([false, true])('converges first-person shots on nearby reticle targets with prone=%s', prone => {
    const camera = new PerspectiveCamera(75, 16 / 9, .05, 1000);
    const muzzle = new Vector3(16, prone ? .4 : 1.35, 16);
    camera.position.set(16.03, prone ? .55 : 1.62, 15.88);
    camera.rotation.set(-.12, .4, .02, 'YXZ');
    camera.updateMatrixWorld(true);
    const ray = new Raycaster();
    ray.setFromCamera(new Vector2(0, 0), camera);
    for (const distance of [.5, 1, 2, 5, 100]) {
      const target = ray.ray.at(distance, new Vector3());
      const aim = reticleAim(muzzle, ray.ray, distance);
      const shot = new Vector3(-Math.sin(aim.yaw) * Math.cos(aim.pitch), Math.sin(aim.pitch), -Math.cos(aim.yaw) * Math.cos(aim.pitch));
      const travel = target.clone().sub(muzzle).dot(shot);
      const impact = muzzle.clone().addScaledVector(shot, travel);
      expect(impact.distanceTo(target)).toBeLessThan(1e-8);
      expect(impact.project(camera).x).toBeCloseTo(0, 8);
      expect(impact.y).toBeCloseTo(0, 8);
    }
  });
  it('keeps shots forward when a shoulder camera sees an obstruction behind the muzzle', () => {
    const { camera, boom, focus } = fixture();
    boom.update(camera, focus, 0, 0, 1 / 60);
    const ray = new Raycaster();
    ray.setFromCamera(new Vector2(0, 0), camera);
    const aim = reticleAim(focus, ray.ray, .1);
    expect(aim.yaw).toBeCloseTo(0);
    expect(aim.pitch).toBeCloseTo(0);
  });
  it.each([0, Math.PI / 2, -Math.PI / 2, Math.PI])('stays behind the player with shoulder clearance at yaw %s', yaw => {
    const { camera, boom, focus } = fixture();
    boom.update(camera, focus, yaw, -.12, 1 / 60);
    const direction = camera.getWorldDirection(new Vector3());
    expect(camera.position.clone().sub(focus).dot(direction)).toBeCloseTo(-2.8 + .3 * Math.sin(-.12), 8);
    expect(camera.position.clone().sub(focus).dot(new Vector3(Math.cos(yaw), 0, -Math.sin(yaw)))).toBeCloseTo(.55, 8);
    expect(camera.position.y).toBeGreaterThan(focus.y);
  });

  it('sits 2.8 metres behind the player and 30 cm above eye height when looking level', () => {
    const { camera, boom, focus } = fixture();
    boom.update(camera, focus, 0, 0, 1 / 60);
    expect(camera.position.z - focus.z).toBeCloseTo(2.8);
    expect(camera.position.y - focus.y).toBeCloseTo(.3);
  });

  it('smoothly moves to the shoulder while aiming and returns when released', () => {
    const { camera, boom, focus, world } = fixture();
    boom.update(camera, focus, 0, 0, 1 / 60, world);
    boom.update(camera, focus, 0, 0, 1 / 60, world, true);
    expect(camera.position.z - focus.z).toBeGreaterThan(.6);
    expect(camera.position.z - focus.z).toBeLessThan(2.8);
    for (let i = 0; i < 120; i++) boom.update(camera, focus, 0, 0, 1 / 60, world, true);
    // Close behind the head, out over the right shoulder, a little above the eyes.
    expect(camera.position.z - focus.z).toBeCloseTo(.6, 5);
    expect(camera.position.x - focus.x).toBeCloseTo(.32, 5);
    expect(camera.position.y - focus.y).toBeCloseTo(.1, 5);
    for (let i = 0; i < 150; i++) boom.update(camera, focus, 0, 0, 1 / 60, world);
    expect(camera.position.z - focus.z).toBeCloseTo(2.8, 5);
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
    world.setOwnerColliders(1, [{ shape: makeBox(16.63, 1.83, 18, .04, .2, .1), layer: Layer.Static }]);
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
