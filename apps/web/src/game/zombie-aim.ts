import { EntityFlags, zombieVariant } from '@zion/shared';
import { zombieHitRig, type HitZone } from '@zion/physics';
import type { Vector3 } from 'three';

/** Point inside the selected hit capsule, shared by mouse hover and touch targeting. */
export function zombieAimPoint(weapon: number, flags: number, position: Vector3, yaw: number, zone: HitZone, out: Vector3): Vector3 {
  const rig = zombieHitRig(zombieVariant(weapon), weapon & 15, !!(flags & EntityFlags.Grounded));
  const part = rig.find((part) => part.zone === zone)!;
  const x = (part.a[0] + part.b[0]) / 2, z = (part.a[2] + part.b[2]) / 2;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return out.set(position.x + x * c + z * s, position.y + (part.a[1] + part.b[1]) / 2, position.z - x * s + z * c);
}
