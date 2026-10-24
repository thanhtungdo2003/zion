import { Bone, Quaternion, Vector3, type Object3D } from 'three';
import { EntityFlags, Limb } from '@zion/shared';

const UP = new Vector3(0, 1, 0), RIGHT = new Vector3(1, 0, 0), FORWARD = new Vector3(0, 0, -1);
const TAU = Math.PI * 2;
const ease = (t: number) => t * t * (3 - 2 * t);
interface Rest { node: Object3D; position: Vector3; rotation: Quaternion; point: Vector3; orientation: Quaternion }
interface Chain { upper: Rest; lower: Rest; end: Rest; a: number; b: number }

/** Distance-driven gait shared by all imported zombie skins. No authored actions or foot locks.
 * Targets live in actor space, so centimetre rigs and metre rigs use the same anatomical solver. */
export class CreatureLocomotion {
  private readonly rest = new Map<Object3D, Rest>();
  private readonly joints = new Map<string, Rest>();
  private readonly chains = new Map<string, Chain>();
  private phase = 0;
  private clock = 0;
  private movement = 0;
  private running = 0;
  private stride = 1.2;
  private look = 0;
  private crawl = 0;
  private readonly style: number;
  private readonly height: number;

  constructor(private readonly model: Object3D, private readonly actor: Object3D,
    aliases: Record<string, string>, private readonly dog: boolean, seed: number) {
    actor.updateWorldMatrix(true, true);
    const inverse = actor.getWorldQuaternion(new Quaternion()).invert();
    model.traverse(node => {
      if (!(node instanceof Bone)) return;
      this.rest.set(node, { node, position: node.position.clone(), rotation: node.quaternion.clone(),
        point: actor.worldToLocal(node.getWorldPosition(new Vector3())), orientation: inverse.clone().multiply(node.getWorldQuaternion(new Quaternion())) });
    });
    for (const [role, name] of Object.entries(aliases)) {
      const node = model.getObjectByName(name), rest = node && this.rest.get(node);
      if (rest) this.joints.set(role, rest);
    }
    for (const side of ['left', 'right']) for (const limb of ['leg', 'arm']) {
      const upper = this.joints.get(`${limb}_${side}`), lower = this.joints.get(`${limb === 'leg' ? 'shin' : 'forearm'}_${side}`);
      const end = this.joints.get(`${limb === 'leg' ? 'foot' : 'hand'}_${side}`);
      if (upper && lower && end) this.chains.set(`${limb}_${side}`, { upper, lower, end, a: upper.point.distanceTo(lower.point), b: lower.point.distanceTo(end.point) });
    }
    this.height = Math.max(.5, this.joints.get('head')?.point.y ?? (dog ? .8 : 1.7));
    this.style = (Math.imul(seed + 1, 1664525) >>> 0) % 4;
    this.stride = this.height * (dog ? 1.25 : .7);
  }

  update(speed: number, flags: number, limbs: number, dt: number, pitch: number, attack: number, flinch: number): void {
    const elapsed = Math.max(0, dt), blend = 1 - Math.exp(-elapsed * 12);
    this.clock += elapsed;
    const scale = Math.max(.01, this.actor.getWorldScale(new Vector3()).x);
    const localSpeed = Math.max(0, speed / scale);
    this.movement += ((localSpeed > .025 ? 1 : 0) - this.movement) * blend;
    this.running += (Math.max(0, Math.min(1, (localSpeed - 1.5) / 3)) - this.running) * blend;
    const stride = this.height * (this.dog ? 1.25 + .8 * this.running : .7 + .7 * this.running);
    this.stride += (stride - this.stride) * blend;
    // A teleport is a new location, not a sprint through every intermediate stride.
    if (localSpeed * elapsed < this.height * 3) this.phase = (this.phase + localSpeed * elapsed / this.stride * TAU) % TAU;
    this.look += (Math.max(-.55, Math.min(.55, pitch)) - this.look) * (1 - Math.exp(-elapsed * 10));
    for (const rest of this.rest.values()) { rest.node.position.copy(rest.position); rest.node.quaternion.copy(rest.rotation); }
    this.model.updateWorldMatrix(true, true);
    const leaping = !!(flags & EntityFlags.Leaping), crawl = !!(limbs & (Limb.LegL | Limb.LegR));
    this.crawl += ((crawl ? 1 : 0) - this.crawl) * (1 - Math.exp(-elapsed * 9));
    const hips = this.joints.get('hips');
    if (hips) {
      const bob = (this.dog ? .014 : .011) * this.height * this.movement * Math.cos(this.phase * 2);
      const p = this.actor.localToWorld(hips.point.clone().add(new Vector3(0, bob - (this.dog ? .04 : .32) * this.height * this.crawl, 0)));
      hips.node.position.copy(hips.node.parent!.worldToLocal(p)); hips.node.updateWorldMatrix(false, true);
    }
    this.rotate('body', RIGHT, this.dog ? -.025 * this.movement : -.10 - .12 * this.running - .12 * attack - .18 * flinch - .85 * this.crawl);
    this.rotate('body', UP, Math.sin(this.phase) * .035 * this.movement);
    this.rotate('head', RIGHT, this.look * .65 + (this.dog ? 0 : .06));
    for (const side of ['left', 'right'] as const) {
      const left = side === 'left', phase = this.phase + (left ? 0 : Math.PI);
      this.step(`leg_${side}`, phase, false, leaping, crawl);
      if (this.dog) this.step(`arm_${side}`, phase + Math.PI, true, leaping, crawl);
      else {
        const chain = this.chains.get(`arm_${side}`); if (!chain) continue;
        const broken = !!(limbs & (left ? Limb.ArmL : Limb.ArmR));
        const raised = this.style === 0 || this.style === (left ? 1 : 2) || attack > .05;
        const reach = broken ? .04 : raised ? .34 + .13 * attack : .12;
        const shoulder = this.actor.worldToLocal(chain.upper.node.getWorldPosition(new Vector3()));
        const target = shoulder.clone().add(new Vector3((left ? -1 : 1) * .045 * this.height,
          -(broken ? .34 : raised ? .09 : .3) * this.height, -reach * this.height));
        target.y += Math.sin(phase + .35) * .025 * this.height * this.movement;
        if (crawl) { target.y -= .1 * this.height; target.z += Math.sin(phase) * .14 * this.height; }
        this.solve(chain, target, new Vector3(left ? -.4 : .4, -.5, -.2));
      }
    }
    this.rotate('tail', UP, Math.sin(this.clock * 2.5 + this.phase) * .14);
    this.model.updateWorldMatrix(true, true);
  }

  private step(role: string, phase: number, front: boolean, leaping: boolean, crawl: boolean): void {
    const chain = this.chains.get(role); if (!chain) return;
    const cycle = ((phase / TAU) % 1 + 1) % 1;
    const stance = .62 - this.running * .14;
    const swing = cycle > stance ? (cycle - stance) / (1 - stance) : 0;
    const reach = this.stride * .23 * this.movement * (crawl ? .4 : 1);
    const forward = cycle <= stance ? reach * (1 - 2 * cycle / stance) : reach * (-1 + 2 * ease(swing) - 2 * (1 - stance) / stance * swing * (1 - swing) * (1 - 2 * swing));
    const target = chain.end.point.clone();
    target.z -= forward;
    target.y += Math.sin(swing * Math.PI) ** 2 * this.height * (.055 + .065 * this.running) * this.movement;
    if (leaping) { target.y += .12 * this.height; target.z += (front ? -.12 : .12) * this.height; }
    this.solve(chain, target, front && this.dog ? new Vector3(0, -.1, 1) : FORWARD);
  }

  /** Fixed-length two-bone IK with bind-relative roll; endpoints follow a moving trajectory. */
  private solve(chain: Chain, target: Vector3, pole: Vector3): void {
    const start = this.actor.worldToLocal(chain.upper.node.getWorldPosition(new Vector3()));
    const line = target.clone().sub(start), distance = Math.max(Math.abs(chain.a - chain.b) + 1e-5, Math.min(chain.a + chain.b - 1e-5, line.length()));
    if (line.lengthSq() < 1e-10) return;
    const direction = line.normalize(), bend = pole.clone().addScaledVector(direction, -pole.dot(direction));
    if (bend.lengthSq() < 1e-8) bend.copy(RIGHT).addScaledVector(direction, -direction.x);
    bend.normalize();
    const cosine = Math.max(-1, Math.min(1, (chain.a ** 2 + distance ** 2 - chain.b ** 2) / (2 * chain.a * distance)));
    const knee = start.clone().addScaledVector(direction, chain.a * cosine).addScaledVector(bend, chain.a * Math.sqrt(1 - cosine ** 2));
    const end = start.clone().addScaledVector(direction, distance);
    this.orient(chain.upper, chain.lower.point.clone().sub(chain.upper.point), knee.clone().sub(start));
    this.orient(chain.lower, chain.end.point.clone().sub(chain.lower.point), end.clone().sub(knee));
    this.setWorld(chain.end.node, this.actor.getWorldQuaternion(new Quaternion()).multiply(chain.end.orientation));
  }

  private orient(rest: Rest, from: Vector3, to: Vector3): void {
    if (from.lengthSq() < 1e-10 || to.lengthSq() < 1e-10) return;
    const rotation = new Quaternion().setFromUnitVectors(from.normalize(), to.normalize()).multiply(rest.orientation);
    this.setWorld(rest.node, this.actor.getWorldQuaternion(new Quaternion()).multiply(rotation));
  }
  private setWorld(node: Object3D, rotation: Quaternion): void {
    node.quaternion.copy(node.parent!.getWorldQuaternion(new Quaternion()).invert().multiply(rotation)).normalize();
    node.updateWorldMatrix(false, true);
  }
  private rotate(role: string, axis: Vector3, angle: number): void {
    const rest = this.joints.get(role); if (!rest) return;
    const worldAxis = axis.clone().applyQuaternion(this.actor.getWorldQuaternion(new Quaternion()));
    this.setWorld(rest.node, new Quaternion().setFromAxisAngle(worldAxis, angle).multiply(rest.node.getWorldQuaternion(new Quaternion())));
  }
}
