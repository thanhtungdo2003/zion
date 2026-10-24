import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { EntityFlags, Limb, MUZZLE_HEIGHT, ZombieVariant } from '@zion/shared';
import { raycastRig, zombieHitRig } from '@zion/physics';
import { zombieAimPoint } from './zombie-aim';

describe('top-down zombie aim', () => {
  it.each([0, Math.PI / 2, Math.PI, -Math.PI / 3])('hits the low Crimson torso and head at yaw %s', (yaw) => {
    const weapon = ZombieVariant.Crimson << 4;
    const flags = EntityFlags.Grounded;
    const position = new Vector3(0, 0, -12);
    const rig = zombieHitRig(ZombieVariant.Crimson, 0, true);
    for (const zone of ['head', 'torso'] as const) {
      const point = zombieAimPoint(weapon, flags, position, yaw, zone, new Vector3());
      expect(point.y).toBeGreaterThan(.5);
      expect(point.y).toBeLessThan(.85);
      // The TOP camera can select the low capsule from above.
      const camera = new Vector3(0, 14, 8);
      const cursor = point.clone().sub(camera).normalize();
      expect(raycastRig(rig, 0, 0, -12, yaw, camera.x, camera.y, camera.z, cursor.x, cursor.y, cursor.z, 60)).not.toBeNull();
      // The actual shot from the player's muzzle also intersects that capsule.
      const muzzle = new Vector3(0, MUZZLE_HEIGHT, 0);
      const direction = point.clone().sub(muzzle).normalize();
      expect(raycastRig(rig, 0, 0, -12, yaw, 0, MUZZLE_HEIGHT, 0, direction.x, direction.y, direction.z, 60)).not.toBeNull();
    }
  });

  it('tracks the raised body in a leap and the low body again after landing', () => {
    const weapon = ZombieVariant.Crimson << 4;
    const out = new Vector3();
    zombieAimPoint(weapon, 0, new Vector3(0, 2, -12), 0, 'torso', out);
    expect(out.y).toBeCloseTo(2.62);
    zombieAimPoint(weapon, EntityFlags.Grounded, new Vector3(0, 0, -12), 0, 'torso', out);
    expect(out.y).toBeCloseTo(.62);
  });

  it('also uses the low target for ordinary zombies with a broken leg', () => {
    const point = zombieAimPoint(Limb.LegL, EntityFlags.Grounded, new Vector3(), 0, 'torso', new Vector3());
    expect(point.y).toBeLessThan(.4);
  });
});
