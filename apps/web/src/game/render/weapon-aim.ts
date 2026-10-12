import { Matrix4, Vector3, type Object3D } from 'three';
import type { WeaponVisual } from './weapons';

/** Keeps the bore on target without moving the grip out of the animated hand. */
export class WeaponAim {
  private readonly grip = new Vector3();
  private readonly scale = new Vector3();
  private readonly forward = new Vector3();
  private readonly side = new Vector3();
  private readonly up = new Vector3();
  private readonly localFrame = new Matrix4();
  private readonly world = new Matrix4();
  private readonly scratch = new Matrix4();

  pose(gun: Object3D, aim: NonNullable<WeaponVisual['aim']>, yaw: number, pitch: number): void {
    if (!gun.parent) return;
    gun.updateWorldMatrix(true, false);
    this.grip.copy(aim.grip).applyMatrix4(gun.matrixWorld);
    this.scale.setFromMatrixScale(gun.matrixWorld);
    this.forward.copy(aim.barrel).normalize();
    this.side.crossVectors(this.forward, aim.up).normalize();
    this.up.crossVectors(this.side, this.forward).normalize();
    this.localFrame.makeBasis(this.forward, this.up, this.side).transpose();
    const cp = Math.cos(pitch);
    this.forward.set(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
    // Explicit yaw keeps the frame stable even when aiming vertically.
    this.side.set(Math.cos(yaw), 0, -Math.sin(yaw));
    this.up.crossVectors(this.side, this.forward).normalize();
    this.world.makeBasis(this.forward, this.up, this.side).multiply(this.localFrame);
    this.world.scale(this.scale).setPosition(this.grip);
    this.world.multiply(this.scratch.makeTranslation(-aim.grip.x, -aim.grip.y, -aim.grip.z));
    gun.matrix.copy(this.scratch.copy(gun.parent.matrixWorld).invert()).multiply(this.world);
    gun.matrixWorldNeedsUpdate = true;
  }
}
