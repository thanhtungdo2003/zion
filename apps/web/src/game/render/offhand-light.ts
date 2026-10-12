import type { Vector3, Object3D } from 'three';

/** The light and lens share the exact model transform, including all attack animations. */
export function offhandLightPose(model: Object3D | null, origin: Vector3, direction: Vector3): boolean {
  const lens = model?.getObjectByName('weapon-emitter');
  const aim = model?.getObjectByName('weapon-light-direction');
  if (!lens || !aim) return false;
  lens.getWorldPosition(origin);
  aim.getWorldPosition(direction).sub(origin).normalize();
  return true;
}
