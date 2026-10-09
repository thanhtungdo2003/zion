import { Matrix4, Quaternion, Vector3, type Object3D } from 'three';

/**
 * A connected ragdoll for a dying character: the body parts (torso, head, arms, legs) stay joined
 * while the body is thrown back by the killing hit, tumbles and comes to rest on the ground.
 *
 * Verlet particles sit at the joints (hips, neck, shoulders, hands, feet, top of the head); stiff
 * distance constraints keep the torso rigid and the limbs at length. Each frame the bones are
 * re-posed from the particles (world matrices written straight into the skeleton), so the gun in
 * hand and worn armour follow along.
 */
const ITER = 8;
const GRAVITY = -16;
const SETTLE_SEC = 5;

interface Particle { p: Vector3; o: Vector3; w: number }

export class Ragdoll {
  private readonly pts: Particle[] = [];
  private readonly links: Array<[number, number, number]> = [];
  private age = 0;
  private readonly scale = new Vector3();
  private readonly m = new Matrix4();
  private readonly inv = new Matrix4();
  private readonly q = new Quaternion();
  private readonly vx = new Vector3();
  private readonly vy = new Vector3();
  private readonly vz = new Vector3();

  private constructor(
    private readonly bones: Record<'body' | 'head' | 'arm_left' | 'arm_right' | 'leg_left' | 'leg_right', Object3D>,
    private readonly ground: (x: number, z: number) => number,
    private readonly px: number,
  ) {}

  /** Starts a ragdoll from the current pose; null when the rig lacks the needed bones. */
  static start(model: Object3D, find: (name: string) => Object3D | undefined, px: number, ground: (x: number, z: number) => number, kx: number, kz: number, force: number): Ragdoll | null {
    const names = ['body', 'head', 'arm_left', 'arm_right', 'leg_left', 'leg_right'] as const;
    const b = {} as Record<(typeof names)[number], Object3D>;
    for (const n of names) {
      const o = find(n);
      if (!o) return null;
      b[n] = o;
    }
    model.updateMatrixWorld(true);
    const r = new Ragdoll(b, ground, px);
    model.getWorldScale(r.scale);
    const at = (o: Object3D, y: number) => o.localToWorld(new Vector3(0, y * px, 0));
    // 0 hip, 1 neck, 2 head top, 3 L shoulder, 4 L hand, 5 R shoulder, 6 R hand, 7 L hip, 8 L foot, 9 R hip, 10 R foot
    const P = [
      at(b.body, -6), at(b.body, 6), at(b.head, 8),
      at(b.arm_left, 0), at(b.arm_left, -11), at(b.arm_right, 0), at(b.arm_right, -11),
      at(b.leg_left, 0), at(b.leg_left, -12), at(b.leg_right, 0), at(b.leg_right, -12),
    ];
    // Thrown back by the hit: the upper body takes more of it, so the body topples over.
    const len = Math.hypot(kx, kz) || 1;
    const dx = kx / len, dz = kz / len;
    const push = 1.6 + force * 0.9;
    P.forEach((p, i) => {
      const upper = i <= 6 ? 1.25 : 0.65;
      const v = new Vector3(dx * push * upper + (Math.random() - 0.5) * 0.4, 1.2 + force * 0.2, dz * push * upper + (Math.random() - 0.5) * 0.4);
      r.pts.push({ p: p.clone(), o: p.clone().addScaledVector(v, -1 / 60), w: 1 });
    });
    const link = (a: number, c: number) => r.links.push([a, c, P[a]!.distanceTo(P[c]!)]);
    // Rigid torso: hips, neck, shoulders, hip joints all braced to each other.
    const torso = [0, 1, 3, 5, 7, 9];
    for (let i = 0; i < torso.length; i++) for (let j = i + 1; j < torso.length; j++) link(torso[i]!, torso[j]!);
    link(1, 2); link(2, 3); link(2, 5);
    link(3, 4); link(5, 6); link(7, 8); link(9, 10);
    // Keep hands and feet from folding through the body.
    link(4, 0); link(6, 0); link(8, 1); link(10, 1);
    for (const l of r.links.slice(-4)) l[2] *= 0.75;
    return r;
  }

  get settled(): boolean {
    return this.age > SETTLE_SEC;
  }

  /** Seconds since the body went limp. */
  get time(): number {
    return this.age;
  }

  step(dt: number): void {
    if (this.settled) return;
    this.age += dt;
    const h = Math.min(dt, 1 / 30);
    for (const pt of this.pts) {
      const vx = (pt.p.x - pt.o.x) * 0.99, vy = (pt.p.y - pt.o.y) * 0.99, vz = (pt.p.z - pt.o.z) * 0.99;
      pt.o.copy(pt.p);
      pt.p.x += vx;
      pt.p.y += vy + GRAVITY * h * h;
      pt.p.z += vz;
    }
    for (let it = 0; it < ITER; it++) {
      for (const [a, b, rest] of this.links) {
        const A = this.pts[a]!.p, B = this.pts[b]!.p;
        const ddx = B.x - A.x, ddy = B.y - A.y, ddz = B.z - A.z;
        const d = Math.hypot(ddx, ddy, ddz) || 1e-6;
        // Limb braces only push apart (minimum distance); the rest are exact.
        const brace = (a === 4 || a === 6) && b === 0 || (a === 8 || a === 10) && b === 1;
        if (brace && d >= rest) continue;
        const k = ((d - rest) / d) * 0.5;
        A.x += ddx * k; A.y += ddy * k; A.z += ddz * k;
        B.x -= ddx * k; B.y -= ddy * k; B.z -= ddz * k;
      }
      for (const pt of this.pts) {
        const g = this.ground(pt.p.x, pt.p.z) + 0.07;
        if (pt.p.y < g) {
          pt.p.y = g;
          // Ground friction: slide to a stop.
          pt.o.x += (pt.p.x - pt.o.x) * 0.35;
          pt.o.z += (pt.p.z - pt.o.z) * 0.35;
          if (pt.o.y < g) pt.o.y = g + (g - pt.o.y) * 0.2;
        }
      }
    }
    this.apply();
  }

  /** Writes the bone transforms from the particles. */
  private apply(): void {
    const P = (i: number) => this.pts[i]!.p;
    // Torso frame: X towards the left shoulder, Y up the spine.
    this.vy.subVectors(P(1), P(0)).normalize();
    this.vx.subVectors(P(3), P(5));
    const side = this.vx.clone();
    this.place(this.bones.body, P(0), side, this.vy.clone(), 6);
    this.place(this.bones.head, P(1), side, this.vy.subVectors(P(2), P(1)).normalize().clone(), 0);
    this.place(this.bones.arm_left, P(3), side, this.vy.subVectors(P(3), P(4)).normalize().clone(), 0);
    this.place(this.bones.arm_right, P(5), side, this.vy.subVectors(P(5), P(6)).normalize().clone(), 0);
    this.place(this.bones.leg_left, P(7), side, this.vy.subVectors(P(7), P(8)).normalize().clone(), 0);
    this.place(this.bones.leg_right, P(9), side, this.vy.subVectors(P(9), P(10)).normalize().clone(), 0);
  }

  /** Puts a bone at `origin` (+ `up × lift` px) with its Y along `up` and X as close to `side`. */
  private place(bone: Object3D, origin: Vector3, side: Vector3, up: Vector3, lift: number): void {
    const x = this.vx.copy(side).addScaledVector(up, -side.dot(up)).normalize();
    const z = this.vz.crossVectors(x, up).normalize();
    this.m.makeBasis(x, up, z);
    this.q.setFromRotationMatrix(this.m);
    const pos = origin.clone().addScaledVector(up, lift * this.px * this.scale.y);
    this.m.compose(pos, this.q, this.scale);
    const parent = bone.parent!;
    parent.updateMatrixWorld(true);
    this.inv.copy(parent.matrixWorld).invert();
    bone.matrixAutoUpdate = false;
    bone.matrix.multiplyMatrices(this.inv, this.m);
    bone.updateMatrixWorld(true);
  }

  /** Back to normal animation (respawn). */
  release(): void {
    for (const b of Object.values(this.bones)) b.matrixAutoUpdate = true;
  }
}
