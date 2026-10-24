import { Matrix4, Quaternion, Vector3, type Bone, type Group } from 'three';

/** World-space joint constraints for imported skeletons with arbitrary bind axes and units. */
export class SkinnedRagdoll {
  private age = 0;
  private readonly points: Array<{ p: Vector3; old: Vector3; q: Quaternion; direction: Vector3; scale: Vector3; parent: number; child: number; length: number }>;
  private readonly braces: Array<[number, number, number]> = [];
  private readonly scratch = new Matrix4();
  constructor(root: Group, private readonly bones: Bone[], private readonly ground: (x: number, z: number) => number, kx: number, kz: number, force: number) {
    root.updateWorldMatrix(true, true);
    const speed = Math.min(12, 1.6 + force * .9), length = Math.hypot(kx, kz) || 1;
    this.points = bones.map(b => {
      const p = b.getWorldPosition(new Vector3());
      return { p, old: p.clone().add(new Vector3(-kx / length * speed / 60, -.025, -kz / length * speed / 60)), q: b.getWorldQuaternion(new Quaternion()), direction: new Vector3(), scale: b.getWorldScale(new Vector3()), parent: bones.indexOf(b.parent as Bone), child: -1, length: 0 };
    });
    this.points.forEach((p, i) => {
      if (p.parent < 0) return;
      p.length = p.p.distanceTo(this.points[p.parent]!.p);
      if (p.length > .015 && this.points[p.parent]!.child < 0) this.points[p.parent]!.child = i;
    });
    for (const p of this.points) if (p.child >= 0) p.direction.subVectors(this.points[p.child]!.p, p.p).normalize();
    // Brace shoulders/hips/chest, so the spine does not fold like a loose rope.
    const torso = bones.flatMap((b, i) => /spine|pelvis|hips|body|clavicle|^arm_|^leg_/i.test(b.name) ? [i] : []);
    for (let a = 0; a < torso.length; a++) for (let b = a + 1; b < torso.length; b++) {
      const i = torso[a]!, j = torso[b]!; this.braces.push([i, j, this.points[i]!.p.distanceTo(this.points[j]!.p)]);
    }
    for (const b of bones) { b.updateMatrix(); b.matrixAutoUpdate = false; }
  }
  get settled(): boolean { return this.age >= 5; }
  step(dt: number): void {
    if (this.settled) return;
    let remaining = Math.min(.2, dt);
    while (remaining > 0) {
      const h = Math.min(1 / 60, remaining); remaining -= h; this.age += h;
      for (const p of this.points) {
        const velocity = p.p.clone().sub(p.old).multiplyScalar(.985); p.old.copy(p.p); p.p.add(velocity); p.p.y -= 16 * h * h;
      }
      const constrain = (i: number, j: number, length: number) => {
        const a = this.points[i]!, b = this.points[j]!, delta = b.p.clone().sub(a.p), d = delta.length();
        if (d < 1e-8) return; delta.multiplyScalar((d - length) / d * .5); a.p.add(delta); b.p.sub(delta);
      };
      for (let k = 0; k < 8; k++) {
        this.points.forEach((p, i) => { if (p.parent >= 0) constrain(p.parent, i, p.length); });
        for (const [i, j, length] of this.braces) constrain(i, j, length);
        for (const p of this.points) {
          const floor = this.ground(p.p.x, p.p.z) + .06;
          if (p.p.y < floor) { p.p.y = floor; p.old.x += (p.p.x - p.old.x) * .5; p.old.z += (p.p.z - p.old.z) * .5; p.old.y = Math.max(p.old.y, floor); }
        }
      }
    }
    this.points.forEach((p, i) => {
      const b = this.bones[i]!, q = p.q.clone();
      if (p.child >= 0) {
        const from = p.direction, to = this.points[p.child]!.p.clone().sub(p.p).normalize();
        if (from.lengthSq() > .5 && to.lengthSq() > .5) q.premultiply(new Quaternion().setFromUnitVectors(from, to));
      }
      this.scratch.compose(p.p, q, p.scale);
      b.matrix.copy(b.parent!.matrixWorld).invert().multiply(this.scratch);
      b.matrixWorldNeedsUpdate = true; b.updateWorldMatrix(false, false);
    });
  }
  release(): void { /* Buffers are shared by the model library. */ }
}
