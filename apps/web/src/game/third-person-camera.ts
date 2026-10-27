import { Vector3, type PerspectiveCamera, type Ray } from 'three';
import { Mask, makeRayHit, type CollisionWorld } from '@zion/physics';

const CAMERA_SAMPLES = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [.7, .7], [-.7, .7], [.7, -.7], [-.7, -.7]] as const;

/** Aiming (a gun without an optic): this far behind the head and out over the right shoulder (m). */
const AIM_BACK = .6;
const AIM_SIDE = .32;
/** …and this far above the eyes. */
const AIM_UP = .1;

/** Shoulder camera with immediate inward collision response and a smooth return outwards. */
export class ThirdPersonCamera {
  distance = 0;
  private initialized = false;
  private aimBlend = 0;
  private readonly direction = new Vector3();
  private readonly right = new Vector3();
  private readonly up = new Vector3();
  private readonly origin = new Vector3();
  private readonly hit = makeRayHit();

  reset(): void { this.initialized = false; this.aimBlend = 0; }

  update(camera: PerspectiveCamera, focus: Vector3, yaw: number, pitch: number, dt: number, collision?: CollisionWorld, aiming = false, chase?: { distance: number; height: number }): void {
    this.aimBlend += ((aiming ? 1 : 0) - this.aimBlend) * (1 - Math.exp(-dt * 14));
    this.right.set(Math.cos(yaw), 0, -Math.sin(yaw));
    this.direction.set(Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch))
      .multiplyScalar(chase?.distance ?? (2.8 - this.aimBlend * (2.8 - AIM_BACK))).addScaledVector(this.right, chase ? 0 : .55 - this.aimBlend * (.55 - AIM_SIDE));
    // Aiming: over the firing shoulder, level with the head.
    this.direction.y += chase?.height ?? (.3 - this.aimBlend * (.3 - AIM_UP));
    const desired = this.direction.length();
    this.direction.divideScalar(desired);
    this.up.crossVectors(this.direction, this.right).normalize();
    let safe = desired;
    if (collision) {
      // Sample a small camera volume, rather than letting its near plane cut through corners.
      for (const [x, y] of CAMERA_SAMPLES) {
        this.origin.copy(focus).addScaledVector(this.right, x * .24).addScaledVector(this.up, y * .24);
        if (collision.raycast(this.origin.x, this.origin.y, this.origin.z, this.direction.x, this.direction.y, this.direction.z, desired, Mask.Camera, this.hit)) {
          safe = Math.min(safe, Math.max(0, this.hit.t - .12));
        }
      }
    }
    if (!this.initialized || safe < this.distance) this.distance = safe;
    else this.distance += (safe - this.distance) * (1 - Math.exp(-dt * 8));
    this.initialized = true;
    camera.position.copy(focus).addScaledVector(this.direction, this.distance);
    camera.rotation.set(pitch, yaw, 0, 'YXZ');
    camera.updateMatrixWorld(true);
  }
}

/** Aim from the authoritative muzzle to the camera's centre target (shoulder parallax). */
export function reticleAim(origin: Vector3, ray: Ray, distance: number): { yaw: number; pitch: number } {
  const target = ray.at(distance, new Vector3());
  // Camera-side obstacles must not turn ammunition backwards through the character.
  if (target.clone().sub(origin).dot(ray.direction) < .2) target.copy(origin).addScaledVector(ray.direction, 2);
  return thirdPersonAim(origin, target);
}

export function thirdPersonAim(origin: Vector3, target: Vector3): { yaw: number; pitch: number } {
  const dx = target.x - origin.x, dy = target.y - origin.y, dz = target.z - origin.z;
  return { yaw: Math.atan2(-dx, -dz), pitch: Math.max(-1.4, Math.min(1.4, Math.atan2(dy, Math.hypot(dx, dz)))) };
}
