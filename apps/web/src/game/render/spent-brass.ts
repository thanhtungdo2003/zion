import { Box3, CylinderGeometry, DynamicDrawUsage, Group, InstancedMesh, Matrix4, MeshStandardMaterial, Quaternion, Vector3, type Object3D, type Scene } from 'three';
import { Mask, makeRayHit, type CollisionWorld } from '@zion/physics';

/**
 * Spent cases and dropped magazines: small rigid bodies thrown out of the gun that fall under
 * gravity, bounce off the ground and walls (the collision world's rays), roll to a stop on their
 * side and stay a while. Cases are instanced from a fixed pool (one draw per kind); each shooter
 * keeps at most `PER_SHOOTER` and the oldest goes when a new one comes (the oldest overall when the
 * pool is full). Magazines are copies of the gun's own magazine, a handful at most.
 */

const GRAVITY = 9.81;
const CASES = 128;
const PER_SHOOTER = 24;
const MAGS = 6;
const CASE_LIFE = 45;
const MAG_LIFE = 35;
const UP = new Vector3(0, 1, 0);

interface Body {
  pos: Vector3; vel: Vector3; q: Quaternion; spin: Vector3;
  age: number; life: number; asleep: boolean; radius: number;
  /** Local axis that ends up pointing up when the body lies still (its thinnest side down). */
  restAxis: Vector3;
}
interface Case extends Body { owner: number; kind: 0 | 1; slot: number; born: number }
interface Mag extends Body { node: Object3D }

export type CaseKind = 'rifle' | 'shell';

export class SpentBrass {
  private readonly cases: Array<Case | null> = new Array(CASES).fill(null);
  /** Made on the first case (a scene nobody shoots in gets nothing). */
  private meshesMade: [InstancedMesh, InstancedMesh] | null = null;
  private readonly mags: Mag[] = [];
  private readonly hit = makeRayHit();
  private readonly m = new Matrix4();
  private readonly s = new Vector3();
  private readonly dq = new Quaternion();
  private serial = 0;

  /** A case hitting the ground (where, how hard 0…1): its clink is played by the owner. */
  onClink: ((at: Vector3, strength: number) => void) | null = null;

  constructor(private readonly scene: Scene) {}

  private get meshes(): [InstancedMesh, InstancedMesh] {
    if (this.meshesMade) return this.meshesMade;
    const scene = this.scene;
    // A brass rifle case (about 7.62×39) and a red 12-gauge shell with its brass head.
    const brass = new MeshStandardMaterial({ color: 0xc9a13b, metalness: 1, roughness: .32 });
    const shell = new MeshStandardMaterial({ color: 0xa3261e, metalness: .1, roughness: .55 });
    const make = (geo: CylinderGeometry, mat: MeshStandardMaterial) => {
      const mesh = new InstancedMesh(geo, mat, CASES);
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.count = CASES; mesh.frustumCulled = false; mesh.castShadow = true; mesh.name = 'spent-cases';
      for (let i = 0; i < CASES; i++) mesh.setMatrixAt(i, this.m.makeScale(0, 0, 0));
      scene.add(mesh);
      return mesh;
    };
    this.meshesMade = [make(new CylinderGeometry(.0058, .0058, .039, 8), brass), make(new CylinderGeometry(.0105, .0105, .066, 10), shell)];
    return this.meshesMade;
  }

  /** A case thrown out of the ejection port: to the gun's right, up and a little back, spinning. */
  eject(owner: number, at: Vector3, right: Vector3, forward: Vector3, kind: CaseKind = 'rifle'): void {
    const slot = this.freeSlot(owner);
    const r = () => Math.random() - .5;
    const vel = right.clone().setY(0).normalize().multiplyScalar(2 + Math.random() * .8)
      .addScaledVector(UP, 1.4 + Math.random() * .8).addScaledVector(forward, -.4 + r() * .3).add(new Vector3(r(), r(), r()).multiplyScalar(.4));
    const k = kind === 'shell' ? 1 : 0;
    this.cases[slot] = {
      owner, kind: k, slot, born: this.serial++, pos: at.clone(), vel, q: new Quaternion().setFromUnitVectors(UP, right.clone().normalize()),
      spin: new Vector3(r(), r(), r()).normalize().multiplyScalar(18 + Math.random() * 16), age: 0, life: CASE_LIFE, asleep: false,
      radius: k ? .0105 : .0058, restAxis: new Vector3(1, 0, 0),
    };
  }

  /**
   * A magazine let go of: a copy of the gun's magazine as it is now in the world (its place,
   * turn and size), dropping from there.
   */
  dropMagazine(source: Object3D, push = new Vector3()): void {
    source.updateWorldMatrix(true, true);
    const node = source.clone(true);
    node.visible = true;
    node.traverse((o) => { o.visible = true; o.frustumCulled = false; (o as { castShadow?: boolean }).castShadow = true; });
    const pos = new Vector3(), q = new Quaternion(), scale = new Vector3();
    source.matrixWorld.decompose(pos, q, scale);
    node.position.set(0, 0, 0); node.quaternion.identity(); node.scale.copy(scale);
    node.updateMatrixWorld(true);
    // Its thinnest side lies on the ground at rest; its centre is the body's centre.
    const box = new Box3().setFromObject(node), size = box.getSize(new Vector3()), centre = box.getCenter(new Vector3());
    const wrapper = new Group();
    wrapper.add(node); node.position.copy(centre).negate();
    const thin = size.x <= size.y && size.x <= size.z ? new Vector3(1, 0, 0) : size.y <= size.z ? new Vector3(0, 1, 0) : new Vector3(0, 0, 1);
    const startPos = pos.clone().add(centre.clone().applyQuaternion(q));
    if (this.mags.length >= MAGS) this.removeMag(0);
    this.scene.add(wrapper);
    this.mags.push({
      node: wrapper, pos: startPos, vel: push.clone().add(new Vector3(0, -.4, 0)), q: q.clone(), spin: new Vector3(Math.random() - .5, Math.random() - .5, Math.random() - .5).multiplyScalar(4),
      age: 0, life: MAG_LIFE, asleep: false, radius: Math.max(.006, Math.min(size.x, size.y, size.z) / 2), restAxis: thin,
    });
    this.place(this.mags[this.mags.length - 1]!, wrapper);
  }

  update(dt: number, world: CollisionWorld | null | undefined): void {
    const h = Math.min(dt, 1 / 30);
    for (const c of this.cases) {
      if (!c) continue;
      c.age += dt;
      if (c.age > c.life) { this.cases[c.slot] = null; this.meshes[c.kind].setMatrixAt(c.slot, this.m.makeScale(0, 0, 0)); continue; }
      if (!c.asleep) this.step(c, h, world);
      // Shrinks away over its last second.
      const k = Math.min(1, c.life - c.age);
      this.meshes[c.kind].setMatrixAt(c.slot, this.m.compose(c.pos, c.q, this.s.set(k, k, k)));
    }
    if (this.meshesMade) { this.meshesMade[0].instanceMatrix.needsUpdate = true; this.meshesMade[1].instanceMatrix.needsUpdate = true; }
    for (let i = this.mags.length - 1; i >= 0; i--) {
      const g = this.mags[i]!;
      g.age += dt;
      if (g.age > g.life) { this.removeMag(i); continue; }
      if (!g.asleep) { this.step(g, h, world); this.place(g, g.node); }
    }
  }

  dispose(): void {
    for (const mesh of this.meshesMade ?? []) { this.scene.remove(mesh); mesh.geometry.dispose(); (mesh.material as MeshStandardMaterial).dispose(); mesh.dispose(); }
    while (this.mags.length) this.removeMag(0);
  }

  /** One rigid step: gravity, a ray along the move (bounce, friction), tumbling; asleep once still on the ground. */
  private step(b: Body, dt: number, world: CollisionWorld | null | undefined): void {
    b.vel.y -= GRAVITY * dt;
    const move = b.vel.clone().multiplyScalar(dt), len = move.length();
    let landed = false;
    if (world && len > 1e-6) {
      const d = move.clone().divideScalar(len);
      if (world.raycast(b.pos.x, b.pos.y, b.pos.z, d.x, d.y, d.z, len + b.radius, Mask.CharacterMovement, this.hit)) {
        const n = new Vector3(this.hit.nx, this.hit.ny, this.hit.nz);
        b.pos.set(this.hit.x, this.hit.y, this.hit.z).addScaledVector(n, b.radius);
        const vn = b.vel.dot(n);
        // A small bounce off the surface; brass on the ground grips: most of the sliding is lost
        // in the hit (and the rest to friction below), so it settles near where it fell.
        const tangent = b.vel.clone().addScaledVector(n, -vn);
        b.vel.copy(tangent.multiplyScalar(n.y > .55 ? .3 : .6)).addScaledVector(n, -vn * .32);
        b.spin.multiplyScalar(.45);
        landed = n.y > .55;
        // The clink of brass on the ground (only a real hit, not the resting contact).
        if (vn < -.6 && 'owner' in b) this.onClink?.(b.pos, Math.min(1, -vn / 4));
      } else b.pos.add(move);
    } else b.pos.add(move);
    // Never through the ground below (lost rays, no world).
    if (world && !landed && world.raycast(b.pos.x, b.pos.y + .3, b.pos.z, 0, -1, 0, .3 + b.radius, Mask.CharacterMovement, this.hit) && this.hit.y > b.pos.y - b.radius) {
      b.pos.y = this.hit.y + b.radius; if (b.vel.y < 0) b.vel.y *= -.25; landed = true;
    }
    // Lying on the ground: sliding and spinning die away quickly.
    if (landed) { const k = Math.max(0, 1 - 9 * dt); b.vel.x *= k; b.vel.z *= k; b.spin.multiplyScalar(Math.max(0, 1 - 6 * dt)); if (Math.abs(b.vel.y) < .6) b.vel.y = 0; }
    const w = b.spin.length();
    if (w > 1e-4) b.q.premultiply(this.dq.setFromAxisAngle(this.s.copy(b.spin).divideScalar(w), w * dt)).normalize();
    if (landed && b.vel.lengthSq() < .04) {
      // Still: on its side (its thin axis up), kept turned as it fell about the vertical.
      b.asleep = true; b.vel.set(0, 0, 0); b.spin.set(0, 0, 0);
      const axisNow = b.restAxis.clone().applyQuaternion(b.q);
      b.q.premultiply(new Quaternion().setFromUnitVectors(axisNow.normalize(), this.hit.ny > .55 ? new Vector3(this.hit.nx, this.hit.ny, this.hit.nz) : UP));
    }
    if (b.pos.y < -200) b.age = b.life;
  }

  private place(b: Body, node: Object3D): void {
    node.position.copy(b.pos); node.quaternion.copy(b.q); node.updateMatrixWorld(true);
  }

  /** A slot for this shooter's new case: their oldest when they have too many, else a free one, else the oldest of all. */
  private freeSlot(owner: number): number {
    let mine = 0, oldestMine = -1, oldestAll = -1;
    for (let i = 0; i < CASES; i++) {
      const c = this.cases[i];
      if (!c) continue;
      if (c.owner === owner) { mine++; if (oldestMine < 0 || c.born < this.cases[oldestMine]!.born) oldestMine = i; }
      if (oldestAll < 0 || c.born < this.cases[oldestAll]!.born) oldestAll = i;
    }
    const pick = mine >= PER_SHOOTER ? oldestMine : this.cases.indexOf(null) >= 0 ? this.cases.indexOf(null) : oldestAll;
    const old = this.cases[pick];
    if (old) this.meshes[old.kind].setMatrixAt(pick, this.m.makeScale(0, 0, 0));
    return pick;
  }

  private removeMag(i: number): void {
    const [g] = this.mags.splice(i, 1);
    g?.node.removeFromParent();
  }

  /** Live counts (tests, debugging). */
  get counts(): { cases: number; mags: number } { return { cases: this.cases.filter(Boolean).length, mags: this.mags.length }; }
  casesOf(owner: number): number { return this.cases.filter((c) => c?.owner === owner).length; }
}
