import { Matrix4, Quaternion, Vector3, type Object3D } from 'three';

/** The light and lens share the exact model transform, including all attack animations. */
export function offhandLightPose(model: Object3D | null, origin: Vector3, direction: Vector3): boolean {
  const lens = model?.getObjectByName('weapon-emitter');
  const aim = model?.getObjectByName('weapon-light-direction');
  if (!lens || !aim) return false;
  lens.getWorldPosition(origin);
  aim.getWorldPosition(direction).sub(origin).normalize();
  return true;
}

const lens = new Vector3(), current = new Vector3(), turn = new Quaternion();
const rotate = new Matrix4(), shift = new Matrix4(), back = new Matrix4(), parentInverse = new Matrix4();

/**
 * Turns held gear about its lens so the beam points along `look` (world space), whatever pose the
 * hand animation left it in. `base` is the item's unaimed local matrix; call after the rig updates.
 */
export function aimOffhandLight(model: Object3D | null, base: Matrix4, look: Vector3): void {
  if (!model?.parent) return;
  model.matrixAutoUpdate = false;
  model.parent.updateWorldMatrix(true, false);
  model.matrix.copy(base);
  model.updateMatrixWorld(true);
  if (!offhandLightPose(model, lens, current)) return;
  turn.setFromUnitVectors(current, look);
  // World transform: translate(lens) · rotate · translate(-lens) · current world matrix.
  rotate.makeRotationFromQuaternion(turn);
  shift.makeTranslation(lens.x, lens.y, lens.z).multiply(rotate).multiply(back.makeTranslation(-lens.x, -lens.y, -lens.z));
  parentInverse.copy(model.parent.matrixWorld).invert();
  model.matrix.copy(parentInverse.multiply(shift).multiply(model.matrixWorld));
  model.updateMatrixWorld(true);
}

/** World-space view direction for a yaw/pitch pair (yaw 0 looks along −Z). */
export function lookDirection(yaw: number, pitch: number, out: Vector3): Vector3 {
  return out.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
}
