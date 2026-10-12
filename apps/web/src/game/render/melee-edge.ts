import { Matrix4, Quaternion, Vector3, type Object3D } from 'three';

export interface StrikeAxes { axis: Vector3; edge: Vector3; grip: Vector3; tip: Vector3 }

/** Rolls the blade about its handle so its cutting/striking face leads the swing. */
export class MeleeEdge {
  private previous = new Vector3();
  private ready = false;
  private point = new Vector3();
  private velocity = new Vector3();
  private axis = new Vector3();
  private edge = new Vector3();
  private cross = new Vector3();
  private grip = new Vector3();
  private rotation = new Quaternion();
  private world = new Matrix4();
  private inverse = new Matrix4();

  reset(): void { this.ready = false; }

  pose(gun: Object3D, axes: StrikeAxes, reference: Object3D): void {
    if (!gun.parent) return;
    gun.updateWorldMatrix(true, false);
    this.point.copy(axes.tip).applyMatrix4(gun.matrixWorld);
    reference.worldToLocal(this.point);
    this.velocity.subVectors(this.point, this.previous);
    this.previous.copy(this.point);
    if (!this.ready) { this.ready = true; return; }
    // Measure only animation motion, excluding character/camera translation and yaw.
    this.velocity.transformDirection(reference.matrixWorld);
    this.axis.copy(axes.axis).transformDirection(gun.matrixWorld);
    this.velocity.addScaledVector(this.axis, -this.velocity.dot(this.axis));
    if (this.velocity.lengthSq() < 1e-6) return;
    this.velocity.normalize();
    this.edge.copy(axes.edge).transformDirection(gun.matrixWorld);
    this.edge.addScaledVector(this.axis, -this.edge.dot(this.axis)).normalize();
    const angle = Math.atan2(this.axis.dot(this.cross.crossVectors(this.edge, this.velocity)), this.edge.dot(this.velocity));
    this.rotation.setFromAxisAngle(this.axis, angle);
    this.grip.copy(axes.grip).applyMatrix4(gun.matrixWorld);
    this.world.makeTranslation(this.grip.x, this.grip.y, this.grip.z)
      .multiply(this.inverse.makeRotationFromQuaternion(this.rotation))
      .multiply(this.inverse.makeTranslation(-this.grip.x, -this.grip.y, -this.grip.z))
      .multiply(gun.matrixWorld);
    gun.matrix.copy(this.inverse.copy(gun.parent.matrixWorld).invert()).multiply(this.world);
    if (gun.matrixAutoUpdate) gun.matrix.decompose(gun.position, gun.quaternion, gun.scale);
    gun.matrixWorldNeedsUpdate = true;
  }
}
