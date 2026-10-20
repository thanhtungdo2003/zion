/**
 * Weapon inertia while aiming down the sights: turning the gun makes it lag behind the mouse and,
 * once the turn stops, swing past the mark and settle (an under-damped spring), and a scope picks up
 * a slow breathing drift. It moves the real aim (input yaw / pitch), so the reticle, the camera and
 * the authoritative shot agree, and flicking onto a target takes a moment to steady.
 */
export class AimSway {
  /** Spring stiffness (1/s²) and damping (1/s): about 1.2 Hz, a visible overshoot or two. */
  private static readonly STIFFNESS = 60;
  private static readonly DAMPING = 6;
  /** How far turning drags the gun: offset ≈ −GAIN · turn rate / STIFFNESS. */
  private static readonly GAIN = .7;
  private static readonly MAX_OFFSET = .045;
  private yaw = 0;
  private pitch = 0;
  private vYaw = 0;
  private vPitch = 0;
  private lastYaw: number | null = null;
  private lastPitch = 0;
  private time = 0;
  private breathYaw = 0;
  private breathPitch = 0;

  /**
   * One frame: `aim` is 0 (hip) … 1 (aiming), `breath` the breathing drift amplitude (rad, 0 off).
   * Returns the change to add to the view this frame.
   */
  step(yaw: number, pitch: number, dt: number, aim: number, breath: number): { yaw: number; pitch: number } {
    if (this.lastYaw === null || dt <= 0) { this.settle(yaw, pitch); return { yaw: 0, pitch: 0 }; }
    const h = Math.min(dt, 1 / 30);
    // Mouse turn since last frame (the sway's own nudges were already counted in `settle`).
    const turnYaw = Math.atan2(Math.sin(yaw - this.lastYaw), Math.cos(yaw - this.lastYaw)) / dt;
    const turnPitch = (pitch - this.lastPitch) / dt;
    const k = AimSway.STIFFNESS, c = AimSway.DAMPING, g = AimSway.GAIN * aim;
    const before = { yaw: this.yaw + this.breathYaw, pitch: this.pitch + this.breathPitch };
    this.vYaw += (-k * this.yaw - c * this.vYaw - g * turnYaw) * h;
    this.vPitch += (-k * this.pitch - c * this.vPitch - g * turnPitch) * h;
    this.yaw = clamp(this.yaw + this.vYaw * h, AimSway.MAX_OFFSET);
    this.pitch = clamp(this.pitch + this.vPitch * h, AimSway.MAX_OFFSET);
    // Breathing: a slow lazy figure-eight.
    this.time += dt;
    this.breathYaw = Math.sin(this.time * .8) * breath;
    this.breathPitch = Math.sin(this.time * 1.6 + .6) * breath * .7;
    return { yaw: this.yaw + this.breathYaw - before.yaw, pitch: this.pitch + this.breathPitch - before.pitch };
  }

  /** The view after everything else this frame (sway, recoil): next frame measures turns from it. */
  settle(yaw: number, pitch: number): void {
    this.lastYaw = yaw;
    this.lastPitch = pitch;
  }

  reset(): void {
    this.yaw = this.pitch = this.vYaw = this.vPitch = this.breathYaw = this.breathPitch = 0;
    this.lastYaw = null;
  }
}

function clamp(v: number, max: number): number {
  return Math.max(-max, Math.min(max, v));
}
