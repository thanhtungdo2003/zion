import { Bone, Box3, BufferGeometry, Float32BufferAttribute, Group, Mesh, Quaternion, SkinnedMesh, Vector3, type Object3D } from 'three';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { EntityFlags, Limb, ZombieVariant } from '@zion/shared';
import type { CharacterTemplate } from './character-model';
import type { GoreCallback } from './zombie-avatar';
import { SkinnedRagdoll } from './skinned-ragdoll';
import { CreatureLocomotion } from './creature-locomotion';
import { ZombieClips } from './zombie-clips';

const LOWER = [[Limb.ArmL, 'forearm_left'], [Limb.ArmR, 'forearm_right'], [Limb.LegL, 'shin_left'], [Limb.LegR, 'shin_right']] as const;

/** Independent skeleton and distance-driven gait per creature; geometry and materials remain shared. */
export class AnimatedZombie {
  readonly model: Group;
  readonly sockets = new Map<string, Group>();
  readonly restSockets = new Map<string, Vector3>();
  private readonly socketRotations = new Map<string, Quaternion>();
  private readonly motion: CreatureLocomotion;
  /** Ordinary zombies walk, run and scream with motion capture (null: the procedural gait only). */
  private readonly clips: ZombieClips | null;
  private clipName = 'walk';
  private clipTime = 0;
  private clipWeight = 0;
  private screamFor = -1;
  /** Seconds into the recorded hit reaction (heavy blows), −1 when none. */
  private hitFor = -1;
  /** The recorded death being played (instead of the limp body), with its time. */
  private dying: { name: string; t: number } | null = null;
  private readonly seed: number;
  private readonly bones = new Map<string, Object3D>();
  private attack = 0;
  private wasAttacking = false;
  private limbs = 0;
  private ragdoll: SkinnedRagdoll | null = null;
  private dead = false;
  private head: { root: Group; position: Vector3; velocity: Vector3; age: number } | null = null;
  constructor(template: CharacterTemplate, private readonly root: Group, private readonly variant: ZombieVariant, private readonly gore: GoreCallback, seed = root.id) {
    this.model = clone(template.root) as Group; root.add(this.model);
    this.seed = seed;
    const meta = template.zombie!;
    for (const [key, name] of Object.entries(meta.aliases)) {
      const node = this.model.getObjectByName(name); if (node) this.bones.set(key, node);
    }
    this.motion = new CreatureLocomotion(this.model, root, meta.aliases, meta.kind === 'dog', seed);
    this.clips = meta.kind === 'human' && variant !== ZombieVariant.Crimson ? ZombieClips.create(this.model, root) : null;
    // Each zombie starts its walk somewhere else in the loop: a crowd never steps in time.
    this.clipTime = ((Math.imul(seed + 7, 2654435761) >>> 0) % 1000) / 1000 * 4;
    this.root.updateMatrixWorld(true);
    // Armour uses metre-space sockets, even when an imported skeleton is in centimetres.
    for (const name of ['head', 'body', 'arm_left', 'arm_right', 'leg_left', 'leg_right']) {
      if (!this.bones.has(name)) continue;
      const socket = new Group(); socket.name = `zombie-socket-${name}`; root.add(socket); this.sockets.set(name, socket);
      this.socketRotations.set(name, root.getWorldQuaternion(new Quaternion()).invert().multiply(this.bones.get(name)!.getWorldQuaternion(new Quaternion())).invert());
    }
    this.updateSockets();
    for (const [name, socket] of this.sockets) this.restSockets.set(name, socket.position.clone());
  }
  update(speed: number, flags: number, limbs: number, dt: number, pitch: number, flinch: number, ground: (x: number, z: number) => number): void {
    this.stepHead(dt, ground);
    if (this.dying && this.clips) {
      // Recorded fall, held on its last frame once down.
      this.dying.t = Math.min(this.clips.duration(this.dying.name), this.dying.t + dt);
      this.clips.pose(this.dying.name, this.dying.t, 1);
      this.root.updateMatrixWorld(true);
      this.model.traverse(o => { if (o instanceof SkinnedMesh) o.skeleton.update(); });
      this.updateSockets();
      return;
    }
    if (this.dead) { this.ragdoll?.step(dt); this.updateSockets(); return; }
    const fresh = limbs & ~this.limbs;
    for (const [bit, zone] of LOWER) if (fresh & bit) {
      this.model.traverse(o => { if (o.userData.zombieZone === zone) o.visible = false; });
      const p = this.bones.get(zone)?.getWorldPosition(new Vector3()) ?? this.root.position;
      this.gore(p.x, p.y, p.z, 1);
    }
    this.limbs = limbs;
    const attacking = !!(flags & EntityFlags.Attacking);
    if (attacking && !this.wasAttacking) { this.attack = .7; }
    this.wasAttacking = attacking;
    const attack = this.attack > 0 ? Math.sin(Math.PI * (1 - this.attack / .7)) : 0;
    this.motion.update(speed, flags, limbs, dt, pitch, attack, flinch);
    if (this.clips) this.playClips(speed, flags, limbs, dt, attack);
    this.attack = Math.max(0, this.attack - dt);
    this.root.updateMatrixWorld(true);
    this.model.traverse(o => { if (o instanceof SkinnedMesh) o.skeleton.update(); });
    this.updateSockets();
  }
  /**
   * Over the procedural pose: the scream (standing still), else walking or running, played one
   * loop per stride of ground covered so each foot plants and pushes off like the recording. The
   * procedural gait stays for standing idle, attacks and crawling on lost legs (blended).
   */
  private playClips(speed: number, flags: number, limbs: number, dt: number, attack: number): void {
    const clips = this.clips!, legless = !!(limbs & (Limb.LegL | Limb.LegR));
    let want = 0;
    if (this.hitFor >= 0 && !legless) {
      // A heavy blow: the recorded stagger, then back to walking.
      this.hitFor += dt;
      if (this.hitFor < clips.duration('hit')) { this.clipName = 'hit'; this.clipTime = this.hitFor; want = 1; }
      else { this.hitFor = -1; this.clipName = 'walk'; this.clipTime = 0; }
    }
    if (want) { /* stagger playing */ } else if (flags & EntityFlags.Screaming) {
      if (this.screamFor < 0) { this.screamFor = 0; this.clipName = 'scream'; this.clipTime = 0; }
      this.screamFor += dt;
      this.clipTime = this.screamFor;
      want = 1;
    } else {
      this.screamFor = -1;
      if (!legless && attack <= 0 && speed > .08) {
        const name = speed > 2 ? 'run' : 'walk';
        if (name !== this.clipName) {
          // Same point of the stride in the new loop (left foot stays left foot).
          const phase = this.clipName === 'scream' || this.clipName === 'hit' ? 0 : this.clipTime / clips.duration(this.clipName);
          this.clipName = name; this.clipTime = phase * clips.duration(name);
        }
        this.clipTime += speed * dt / clips.stride(name) * clips.duration(name);
        want = 1;
      }
    }
    this.clipWeight += (want - this.clipWeight) * (1 - Math.exp(-dt * 10));
    if (this.clipWeight > .01) clips.pose(this.clipName, this.clipTime, this.clipWeight);
  }

  private updateSockets(): void {
    this.root.updateWorldMatrix(true, false);
    const rotation = this.root.getWorldQuaternion(new Quaternion()).invert();
    for (const [name, socket] of this.sockets) {
      const b = this.bones.get(name)!;
      socket.position.copy(this.root.worldToLocal(b.getWorldPosition(new Vector3())));
      socket.quaternion.copy(rotation).multiply(b.getWorldQuaternion(new Quaternion())).multiply(this.socketRotations.get(name)!);
    }
  }
  /** Struck hard (a heavy blade cut or a hammer blow): plays the recorded hit reaction. */
  staggered(): void {
    if (this.clips && !this.dead) this.hitFor = 0;
  }

  startRagdoll(kx: number, kz: number, force: number, ground: (x: number, z: number) => number): SkinnedRagdoll | null {
    if (this.dead) return this.ragdoll;
    this.dead = true;
    // Ordinary deaths fall as recorded (one of two); blasts and legless bodies go limp.
    if (this.clips && force < 7 && !(this.limbs & (Limb.LegL | Limb.LegR))) {
      this.dying = { name: (this.seed & 1) ? 'dying' : 'death', t: 0 };
      return null;
    }
    if (this.variant === ZombieVariant.Brute) kx = kz = force = 0;
    const bones: Bone[] = []; this.model.traverse(o => { if (o instanceof Bone) bones.push(o); });
    this.ragdoll = new SkinnedRagdoll(this.model, bones, ground, kx, kz, force);
    return this.ragdoll;
  }
  severHead(kx: number, kz: number, force: number): void {
    if (this.variant === ZombieVariant.Brute || this.head) return;
    this.model.updateWorldMatrix(true, true);
    const holder = new Group(), pieces: SkinnedMesh[] = [];
    this.model.traverse(o => { if (o instanceof SkinnedMesh && o.userData.zombieZone === 'head') pieces.push(o); });
    if (!pieces.length) return;
    for (const piece of pieces) {
      piece.skeleton.update();
      const source = piece.geometry, pos = source.getAttribute('position'), points = new Float32Array(pos.count * 3), v = new Vector3();
      for (let i = 0; i < pos.count; i++) {
        piece.applyBoneTransform(i, v.fromBufferAttribute(pos, i)); v.applyMatrix4(piece.matrixWorld); this.root.worldToLocal(v); v.toArray(points, i * 3);
      }
      const geometry = new BufferGeometry(); geometry.setAttribute('position', new Float32BufferAttribute(points, 3)); geometry.setIndex(source.index!.clone());
      if (source.getAttribute('uv')) geometry.setAttribute('uv', source.getAttribute('uv')); geometry.computeVertexNormals();
      holder.add(new Mesh(geometry, piece.material)); piece.visible = false;
    }
    this.root.add(holder); this.root.updateMatrixWorld(true);
    const center = new Box3().setFromObject(holder).getCenter(new Vector3()), local = this.root.worldToLocal(center.clone());
    for (const piece of holder.children) piece.position.sub(local); holder.position.copy(local);
    const length = Math.hypot(kx, kz) || 1, speed = Math.min(8, 2 + force * .45);
    this.head = { root: holder, position: center, velocity: new Vector3(kx / length * speed, 3.5, kz / length * speed), age: 0 };
    this.gore(center.x, center.y, center.z, 1.5);
  }
  private stepHead(dt: number, ground: (x: number, z: number) => number): void {
    const head = this.head; if (!head || head.age >= 6) return;
    head.age += dt; head.velocity.y -= 18 * dt; head.position.addScaledVector(head.velocity, dt);
    const floor = ground(head.position.x, head.position.z) + .16;
    if (head.position.y < floor) { head.position.y = floor; head.velocity.y = Math.abs(head.velocity.y) * .2; head.velocity.x *= .85; head.velocity.z *= .85; }
    head.root.position.copy(this.root.worldToLocal(head.position.clone())); head.root.rotation.x += dt * head.velocity.length();
  }
  dispose(): void {
    this.model.traverse(o => { if (o instanceof SkinnedMesh) o.skeleton.dispose(); });
    this.head?.root.traverse(o => { if (o instanceof Mesh) o.geometry.dispose(); });
    this.head?.root.removeFromParent();
  }
}
