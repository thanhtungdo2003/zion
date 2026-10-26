/**
 * The held weapon as a rigid body on springs: the hands hold it with a fixed arm stiffness, and
 * the work of a reload (magazine pulled or slapped home, charging handle racked, bolt released)
 * reaches it as impulses at the point where the hand acts. Its response follows its own mass and
 * inertia: the same slap jolts a pistol far more than a machine gun, a pull on a side-mounted
 * handle rolls the gun, and a heavy gun swings slower and settles later.
 *
 * Frame (camera space, metres / radians, pivot at the firing grip): +X right, +Y up, -Z forward
 * along the barrel. Rotations: rx pitch (muzzle up +), ry yaw, rz roll.
 */

export interface WeaponBodySpec {
  /** kg (WEAPON_SPECS weight). */
  mass: number;
  /** Overall length and receiver height (m), for the inertia of a slender rod-like gun. */
  length: number;
  height: number;
  /** Centre of mass relative to the firing grip (m): forward of the hand on long guns. */
  com: [number, number, number];
}

/** How the arms hold the gun, and how strongly physics may move it for one action. */
export interface HoldSettings {
  /** N/m and N·m/rad: the same arms for every gun, so heavier guns sway slower. */
  linearStiffness: number;
  angularStiffness: number;
  /** Damping ratio (1 = critical): a little under, so a hard slap overshoots once. */
  damping: number;
  /** Displacement limits keeping the hands on the grips (m, rad). */
  maxOffset: number;
  maxAngle: number;
}

export const DEFAULT_HOLD: HoldSettings = { linearStiffness: 4200, angularStiffness: 70, damping: .45, maxOffset: .035, maxAngle: .12 };

/** Typical gun proportions by class when the model's own size is unknown. */
export function weaponBody(mass: number, kind: 'pistol' | 'rifle' | 'heavy'): WeaponBodySpec {
  if (kind === 'pistol') return { mass, length: .2, height: .14, com: [0, .03, -.04] };
  if (kind === 'heavy') return { mass, length: 1.2, height: .25, com: [0, .03, -.3] };
  return { mass, length: .9, height: .22, com: [0, .03, -.18] };
}

/** Principal moments (kg·m²) about the centre of mass: pitch and yaw as a rod, roll as the receiver. */
export function weaponInertia(b: WeaponBodySpec): [number, number, number] {
  const m = b.mass, l = b.length, h = b.height, w = .06;
  return [m * (l * l + h * h) / 12, m * (l * l + w * w) / 12, m * (h * h + w * w) / 12];
}

/** Where on the gun each kind of hand action lands (grip frame, m) and its direction. */
export type HandAction = 'magOut' | 'magIn' | 'rack' | 'release' | 'tap';

/**
 * Impulse (N·s) and contact point of a hand action. Magnitudes come from the moving part's mass
 * and hand speed (a 0.5 kg rifle magazine seated at about 3 m/s ≈ 1.5 N·s), scaled to the gun.
 * `side`: which side the charging handle is on (1 right, -1 left, 0 top).
 */
export function handImpulse(action: HandAction, b: WeaponBodySpec, side: number, strength = 1): { j: [number, number, number]; at: [number, number, number] } {
  // Moving parts scale with the gun: a pistol magazine weighs a fraction of a rifle's.
  const k = Math.sqrt(Math.min(2, Math.max(.25, b.mass / 3.5))) * strength;
  const magwell: [number, number, number] = [0, -.04, b.com[2] * .6];
  const handle: [number, number, number] = [side * .035, .05, b.com[2] * .2 + .05];
  switch (action) {
    case 'magOut': return { j: [0, -.9 * k, 0], at: magwell };
    case 'magIn': return { j: [0, 1.6 * k, -.2 * k], at: magwell };
    case 'rack': return { j: [side * .15 * k, 0, 1.3 * k], at: handle };
    case 'release': return { j: [0, 0, -1.1 * k], at: handle };
    default: return { j: [0, .3 * k, 0], at: magwell };
  }
}

const SUBSTEP = 1 / 240;

export class WeaponDynamics {
  /** Offset of the gun from its held pose (position m, rotation rad) and their rates. */
  readonly p = [0, 0, 0];
  readonly r = [0, 0, 0];
  private readonly v = [0, 0, 0];
  private readonly w = [0, 0, 0];
  private inertia: [number, number, number];
  private carry = 0;

  constructor(private body: WeaponBodySpec, readonly hold: HoldSettings = DEFAULT_HOLD) {
    this.inertia = weaponInertia(body);
  }

  setBody(body: WeaponBodySpec): void { this.body = body; this.inertia = weaponInertia(body); }
  get spec(): WeaponBodySpec { return this.body; }

  /** An impulse `j` (N·s) at grip-frame point `at`: linear Δv = J/m, angular Δω = I⁻¹ (r × J) about the centre of mass. */
  impulse(j: readonly number[], at: readonly number[]): void {
    const m = this.body.mass, c = this.body.com;
    for (let i = 0; i < 3; i++) this.v[i]! += j[i]! / m;
    const rx = at[0]! - c[0], ry = at[1]! - c[1], rz = at[2]! - c[2];
    const tx = ry * j[2]! - rz * j[1]!, ty = rz * j[0]! - rx * j[2]!, tz = rx * j[1]! - ry * j[0]!;
    this.w[0]! += tx / this.inertia[0]; this.w[1]! += ty / this.inertia[1]; this.w[2]! += tz / this.inertia[2];
  }

  /** Advances with fixed substeps (frame-rate independent), semi-implicit Euler on spring-dampers. */
  step(dt: number): void {
    this.carry = Math.min(this.carry + Math.max(0, dt), .1);
    const h = this.hold, m = this.body.mass;
    const cl = 2 * h.damping * Math.sqrt(h.linearStiffness * m);
    const ca = this.inertia.map((i) => 2 * h.damping * Math.sqrt(h.angularStiffness * i));
    while (this.carry >= SUBSTEP) {
      this.carry -= SUBSTEP;
      for (let i = 0; i < 3; i++) {
        this.v[i]! += (-h.linearStiffness * this.p[i]! - cl * this.v[i]!) / m * SUBSTEP;
        this.p[i]! += this.v[i]! * SUBSTEP;
        this.w[i]! += (-h.angularStiffness * this.r[i]! - ca[i]! * this.w[i]!) / this.inertia[i]! * SUBSTEP;
        this.r[i]! += this.w[i]! * SUBSTEP;
        // The hands are a hard stop: past the limit the gun is held, its motion that way absorbed.
        if (Math.abs(this.p[i]!) > h.maxOffset) { this.p[i] = Math.sign(this.p[i]!) * h.maxOffset; if (this.v[i]! * this.p[i]! > 0) this.v[i] = 0; }
        if (Math.abs(this.r[i]!) > h.maxAngle) { this.r[i] = Math.sign(this.r[i]!) * h.maxAngle; if (this.w[i]! * this.r[i]! > 0) this.w[i] = 0; }
      }
    }
  }

  /**
   * The motion as the viewmodel applies it, pivoting at the grip: the same turn `r`, with the grip
   * shifted by -r × com so the gun turns about its centre of mass, not about the hand.
   */
  gripOffset(out: { x: number; y: number; z: number; rx: number; ry: number; rz: number }): typeof out {
    const c = this.body.com, [rx, ry, rz] = this.r as [number, number, number];
    out.x = this.p[0]! - (ry * c[2] - rz * c[1]); out.y = this.p[1]! - (rz * c[0] - rx * c[2]); out.z = this.p[2]! - (rx * c[1] - ry * c[0]);
    out.rx = rx; out.ry = ry; out.rz = rz;
    return out;
  }

  /** Kinetic plus spring energy (J): only ever falls between impulses. */
  energy(): number {
    const h = this.hold;
    let e = 0;
    for (let i = 0; i < 3; i++) {
      e += .5 * this.body.mass * this.v[i]! ** 2 + .5 * h.linearStiffness * this.p[i]! ** 2;
      e += .5 * this.inertia[i]! * this.w[i]! ** 2 + .5 * h.angularStiffness * this.r[i]! ** 2;
    }
    return e;
  }

  reset(): void { this.p.fill(0); this.r.fill(0); this.v.fill(0); this.w.fill(0); this.carry = 0; }
}

/** Reload-script sound names to the hand action that makes them (none: no force on the gun). */
export function actionForSound(name: string): HandAction | null {
  const n = name.toLowerCase();
  if (/casing|shelldrop|button|selector|aim|dry/.test(n)) return null;
  if (/magout|shellout|open|eject|clipout/.test(n)) return 'magOut';
  if (/slap|magin|clipin|close|insert/.test(n)) return 'magIn';
  if (/rack|pull|back/.test(n)) return 'rack';
  if (/release|forward/.test(n)) return 'release';
  return 'tap';
}
