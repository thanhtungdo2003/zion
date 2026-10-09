import { Box3, Group, Quaternion, Vector3, type Object3D, type Scene } from 'three';
import type { CollisionWorld } from '@zion/physics';

const GRAVITY = 18;
const RESTITUTION = 0.28;
/** Horizontal speed kept per second of ground contact (friction). */
const GROUND_FRICTION_PER_S = 0.02;
const ANGULAR_DAMP_PER_S = 0.08;
/** How strongly gravity tips a piece resting on one corner (toppling torque). */
const TOPPLE = 2.2;
const LIFETIME = 9;
const SINK_AFTER = 6.5;
const MAX_PIECES = 220;

interface Piece {
  /** Wrapper pivoting on the piece's centre of mass (bbox centre). */
  obj: Object3D;
  vel: Vector3;
  /** Angular velocity (rad/s, world axes). */
  spin: Vector3;
  /** Local bbox corners (relative to the pivot) for ground contact. */
  corners: Vector3[];
  inertia: number;
  /** Longest local axis (tall pieces) and the horizontal axis it falls over around. */
  long: Vector3;
  tipAxis: Vector3;
  age: number;
  rest: number;
  /** Seconds spent touching the ground. */
  grounded: number;
  sleeping: boolean;
  onLand: ((x: number, y: number, z: number) => void) | null;
}

const q = new Quaternion();
const axis = new Vector3();
const box = new Box3();
const center = new Vector3();
const corner = new Vector3();
const lowest = new Vector3();
const torque = new Vector3();
const patch = new Vector3();
const MAX_SPIN = 14;
/** Corners within this height of the lowest one count as touching (contact patch). */
const CONTACT_EPS = 0.03;

/**
 * Rigid-body debris: severed body parts flying apart under gravity, bouncing, toppling over and
 * sliding to rest on the terrain with friction, then sinking away. Each piece collides with the
 * ground through its oriented bounding-box corners, so tall chunks fall over instead of
 * standing frozen.
 */
export class DebrisSystem {
  private readonly pieces: Piece[] = [];

  constructor(private readonly scene: Scene) {}

  /**
   * Takes ownership of `obj` (already placed in world space), re-pivots it on its centre and
   * launches it.
   */
  add(obj: Object3D, vel: Vector3, spin: Vector3, onLand: Piece['onLand'] = null): void {
    obj.removeFromParent();
    obj.updateMatrixWorld(true);
    box.setFromObject(obj);
    if (box.isEmpty()) return;
    box.getCenter(center);
    // Wrapper at the centre with identity rotation; the object keeps its world transform inside.
    const pivot = new Group();
    pivot.position.copy(center);
    obj.position.sub(center);
    pivot.add(obj);
    const corners: Vector3[] = [];
    for (let i = 0; i < 8; i++) {
      corners.push(new Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).sub(center));
    }
    const size = box.getSize(corner);
    const inertia = Math.max(0.02, (size.x * size.x + size.y * size.y + size.z * size.z) / 12);
    const long = size.y >= size.x && size.y >= size.z ? new Vector3(0, 1, 0) : size.x >= size.z ? new Vector3(1, 0, 0) : new Vector3(0, 0, 1);
    // Fall over along the push (or a random way if there was none).
    const tipAxis = new Vector3(vel.z, 0, -vel.x);
    if (tipAxis.lengthSq() < 1e-4) tipAxis.set(Math.random() - 0.5, 0, Math.random() - 0.5);
    tipAxis.normalize();
    this.scene.add(pivot);
    this.pieces.push({ obj: pivot, vel: vel.clone(), spin: spin.clone(), corners, inertia, long, tipAxis, age: 0, rest: 0, grounded: 0, sleeping: false, onLand });
    while (this.pieces.length > MAX_PIECES) this.remove(0);
  }

  private remove(i: number): void {
    this.scene.remove(this.pieces[i]!.obj);
    this.pieces.splice(i, 1);
  }

  update(dt: number, world: CollisionWorld | null | undefined): void {
    const step = Math.min(dt, 1 / 30);
    for (let i = this.pieces.length - 1; i >= 0; i--) {
      const p = this.pieces[i]!;
      p.age += dt;
      if (p.age > LIFETIME) {
        this.remove(i);
        continue;
      }
      const o = p.obj;
      if (p.age > SINK_AFTER) {
        o.position.y -= dt * 0.25;
        continue;
      }
      if (p.sleeping) continue;

      if (p.spin.lengthSq() > MAX_SPIN * MAX_SPIN) p.spin.setLength(MAX_SPIN);
      p.vel.y -= GRAVITY * step;
      o.position.addScaledVector(p.vel, step);
      const w = p.spin.length();
      if (w > 1e-4) {
        q.setFromAxisAngle(axis.copy(p.spin).divideScalar(w), w * step);
        o.quaternion.premultiply(q).normalize();
      }

      // Lowest oriented corner vs terrain; the contact patch is the centroid of every corner
      // touching the ground, so a piece lying on a face has no lever arm and stays put.
      let minY = Infinity;
      for (const c of p.corners) {
        corner.copy(c).applyQuaternion(o.quaternion);
        if (corner.y < minY) {
          minY = corner.y;
          lowest.copy(corner);
        }
      }
      let n = 0;
      patch.set(0, 0, 0);
      for (const c of p.corners) {
        corner.copy(c).applyQuaternion(o.quaternion);
        if (corner.y < minY + CONTACT_EPS) {
          patch.add(corner);
          n++;
        }
      }
      patch.divideScalar(n);
      const ground = world?.terrainHeight(o.position.x + lowest.x, o.position.z + lowest.z) ?? Number.NaN;
      if (ground !== ground) continue;
      const pen = ground - (o.position.y + minY);
      if (pen <= -0.02) {
        p.rest = 0;
        continue;
      }
      if (pen > 0) o.position.y += pen;
      p.grounded += dt;
      if (p.vel.y < -1.5 && p.onLand) {
        p.onLand(o.position.x + lowest.x, ground + 0.05, o.position.z + lowest.z);
        p.onLand = null;
      }
      // Real bounce only on hard impacts; otherwise resting contact (no micro-hopping).
      if (p.vel.y < -2) p.vel.y = -p.vel.y * RESTITUTION;
      else if (p.vel.y < 0) p.vel.y = 0;
      const fr = Math.pow(GROUND_FRICTION_PER_S, step);
      p.vel.x *= fr;
      p.vel.z *= fr;
      // Gravity acting on the centre around the contact patch tips the piece over.
      if (p.grounded < 0.6 && Math.hypot(patch.x, patch.z) > 0.03) {
        torque.crossVectors(patch, corner.set(0, 1, 0)).multiplyScalar((TOPPLE * GRAVITY * step) / p.inertia);
        p.spin.add(torque);
      }
      // A body part resting upright on its end can't balance: tip it over.
      const upright = Math.abs(corner.copy(p.long).applyQuaternion(o.quaternion).y);
      if (upright > 0.7 && p.grounded < 0.6) p.spin.addScaledVector(p.tipAxis, (TOPPLE * GRAVITY * step * upright * 0.35) / p.inertia);
      // Ground friction kills spinning around the vertical axis fast, and rolling more gently.
      p.spin.y *= Math.pow(0.0005, step);
      p.spin.multiplyScalar(Math.pow(p.grounded > 0.3 ? 0.002 : ANGULAR_DAMP_PER_S, step));
      // Settled: slow and resting on a face, or simply on the ground long enough.
      const flat = n >= 3 || Math.hypot(patch.x, patch.z) < 0.04;
      p.rest = p.vel.lengthSq() < 0.3 && (flat || p.spin.lengthSq() < 0.6) ? p.rest + dt : 0;
      if (p.rest > 0.15 || p.grounded > 1.2) {
        p.sleeping = true;
        p.vel.set(0, 0, 0);
        p.spin.set(0, 0, 0);
      }
    }
  }

  dispose(): void {
    for (const p of this.pieces) this.scene.remove(p.obj);
    this.pieces.length = 0;
  }
}

