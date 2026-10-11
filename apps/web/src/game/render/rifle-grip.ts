import { Matrix4, Quaternion, Vector3, type Object3D } from 'three';
import { BB_UNITS_PER_METER } from './character-model';
import type { WeaponVisual } from './weapons';

const PALM = new Vector3(0, 2 / BB_UNITS_PER_METER, -0.2 / BB_UNITS_PER_METER);

/** Keeps the trigger grip in the right palm and the handguard in the left palm. */
export class RifleGrip {
  private readonly right = new Vector3();
  private readonly left = new Vector3();
  private readonly shoulder = new Vector3();
  private readonly axis = new Vector3();
  private readonly tangent = new Vector3();
  private readonly target = new Vector3();
  private readonly from = new Vector3();
  private readonly to = new Vector3();
  private readonly side = new Vector3();
  private readonly up = new Vector3();
  private readonly scale = new Vector3();
  private readonly rotation = new Quaternion();
  private readonly parentRotation = new Quaternion();
  private readonly source = new Matrix4();
  private readonly destination = new Matrix4();
  private readonly world = new Matrix4();
  private readonly inverse = new Matrix4();

  pose(weapon: Object3D, visual: WeaponVisual, rightHand: Object3D, leftHand: Object3D, leftArm: Object3D, body: Object3D): void {
    const contacts = visual.twoHandGrip;
    if (!contacts) return;
    rightHand.updateWorldMatrix(true, false);
    leftHand.updateWorldMatrix(true, false);
    this.right.copy(PALM).applyMatrix4(rightHand.matrixWorld);
    this.left.copy(PALM).applyMatrix4(leftHand.matrixWorld);
    leftArm.getWorldPosition(this.shoulder);
    this.scale.setFromMatrixScale(visual.attach);
    const span = this.from.subVectors(contacts.support, contacts.grip).length() * this.scale.x;
    const reach = this.left.distanceTo(this.shoulder);
    const distance = this.axis.subVectors(this.shoulder, this.right).length();
    if (span < 1e-5 || distance < 1e-5) return;
    this.axis.divideScalar(distance);
    // Intersect the handguard's reach around the trigger grip with the left arm's reach.
    // Choose the solution closest to the authored pose, keeping the arm connected at its shoulder.
    const cosine = Math.max(-1, Math.min(1, (span * span + distance * distance - reach * reach) / (2 * span * distance)));
    this.tangent.subVectors(this.left, this.right);
    this.tangent.addScaledVector(this.axis, -this.tangent.dot(this.axis));
    if (this.tangent.lengthSq() < 1e-8) return;
    this.tangent.normalize();
    this.target.copy(this.right).addScaledVector(this.axis, span * cosine).addScaledVector(this.tangent, span * Math.sqrt(1 - cosine * cosine));
    this.from.subVectors(this.left, this.shoulder).normalize();
    this.to.subVectors(this.target, this.shoulder).normalize();
    this.rotation.setFromUnitVectors(this.from, this.to);
    leftArm.getWorldQuaternion(this.parentRotation);
    this.rotation.multiply(this.parentRotation);
    leftArm.parent!.getWorldQuaternion(this.parentRotation).invert();
    leftArm.quaternion.copy(this.parentRotation.multiply(this.rotation));
    leftArm.updateWorldMatrix(false, true);

    // Map the model's two grips to the palms, with the top of the gun facing up on the body.
    this.from.subVectors(contacts.support, contacts.grip).normalize();
    this.side.crossVectors(this.from, contacts.up).normalize();
    this.up.crossVectors(this.side, this.from).normalize();
    this.source.makeBasis(this.from, this.up, this.side).transpose();
    this.to.subVectors(this.target, this.right).normalize();
    body.updateWorldMatrix(true, false);
    this.up.set(0, 1, 0).transformDirection(body.matrixWorld);
    this.side.crossVectors(this.to, this.up).normalize();
    this.up.crossVectors(this.side, this.to).normalize();
    this.destination.makeBasis(this.to, this.up, this.side).multiply(this.source);
    this.world.makeTranslation(this.right.x, this.right.y, this.right.z)
      .multiply(this.destination)
      .scale(this.scale);
    this.destination.makeTranslation(-contacts.grip.x, -contacts.grip.y, -contacts.grip.z);
    this.world.multiply(this.destination);
    weapon.matrix.copy(this.inverse.copy(rightHand.matrixWorld).invert().multiply(this.world));
    weapon.matrixWorldNeedsUpdate = true;
  }
}
