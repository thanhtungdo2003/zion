import type { EntityKind, EntityState } from '@zion/shared';

interface Sample {
  t: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  flags: number;
  health: number;
}

export interface InterpolatedPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  flags: number;
  health: number;
}

const MAX_SAMPLES = 32;
const MAX_EXTRAPOLATION_MS = 150;

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  if (d > Math.PI) d -= Math.PI * 2;
  else if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/** Snapshot buffer for one remote entity, rendered slightly in the past for smooth motion. */
export class RemoteEntity {
  private readonly samples: Sample[] = [];
  readonly pose: InterpolatedPose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, flags: 0, health: 100 };

  constructor(
    readonly id: number,
    readonly kind: EntityKind,
  ) {}

  push(t: number, e: EntityState): void {
    const last = this.samples[this.samples.length - 1];
    if (last && t <= last.t) return;
    this.samples.push({ t, x: e.x, y: e.y, z: e.z, yaw: e.yaw, pitch: e.pitch, flags: e.flags, health: e.health });
    if (this.samples.length > MAX_SAMPLES) this.samples.shift();
  }

  sample(renderTime: number): InterpolatedPose {
    const s = this.samples;
    const p = this.pose;
    if (s.length === 0) return p;
    if (renderTime <= s[0]!.t || s.length === 1) {
      Object.assign(p, s[0]);
      return p;
    }
    for (let i = s.length - 1; i > 0; i--) {
      const a = s[i - 1]!;
      const b = s[i]!;
      if (renderTime >= a.t && renderTime <= b.t) {
        const k = (renderTime - a.t) / (b.t - a.t || 1);
        p.x = a.x + (b.x - a.x) * k;
        p.y = a.y + (b.y - a.y) * k;
        p.z = a.z + (b.z - a.z) * k;
        p.yaw = lerpAngle(a.yaw, b.yaw, k);
        p.pitch = a.pitch + (b.pitch - a.pitch) * k;
        p.flags = b.flags;
        p.health = b.health;
        return p;
      }
    }
    // Past the newest sample: short, bounded extrapolation along the last velocity.
    const a = s[s.length - 2]!;
    const b = s[s.length - 1]!;
    const over = Math.min(MAX_EXTRAPOLATION_MS, renderTime - b.t);
    const span = b.t - a.t || 1;
    p.x = b.x + ((b.x - a.x) / span) * over;
    p.y = b.y + ((b.y - a.y) / span) * over;
    p.z = b.z + ((b.z - a.z) / span) * over;
    p.yaw = b.yaw;
    p.pitch = b.pitch;
    p.flags = b.flags;
    p.health = b.health;
    return p;
  }
}
