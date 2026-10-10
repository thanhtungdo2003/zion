import { Group, Mesh, Vector3, type Euler, type Object3D, type Scene } from 'three';
import { EntityFlags, Limb, isCrawling } from '@zion/shared';
import { BB_UNITS_PER_METER, sampleTrack, type CharacterClip, type CharacterTemplate } from './character-model';
import { Ragdoll } from './ragdoll';

export const ZOMBIE_MODEL_URL = '/models/mobs/hunched-rotting-zombie.bbmodel';
export const ZOMBIE_MODEL_URLS = [ZOMBIE_MODEL_URL, '/models/mobs/gaunt-zombie.bbmodel', '/models/mobs/brute-zombie.bbmodel'] as const;

const DEG = Math.PI / 180;
const PX = 1 / BB_UNITS_PER_METER;
const FADE_SEC = 0.2;

/**
 * Hit-rig zone → model bone. The rig's "_l" side is local −X, which is the model's *_right bones.
 * A broken limb hides its lower half, leaving a stump.
 */
const LIMB_BONES: Array<{ bit: number; hide: string }> = [
  { bit: Limb.ArmL, hide: 'forearm_right' },
  { bit: Limb.ArmR, hide: 'forearm_left' },
  { bit: Limb.LegL, hide: 'shin_right' },
  { bit: Limb.LegR, hide: 'shin_left' },
];

interface Bone {
  node: Object3D;
  restPos: Vector3;
  restRot: Euler;
}

interface Layer {
  clip: CharacterClip | null;
  time: number;
  rate: number;
}

const rotA: [number, number, number] = [0, 0, 0];
const rotB: [number, number, number] = [0, 0, 0];
const posA: [number, number, number] = [0, 0, 0];
const posB: [number, number, number] = [0, 0, 0];

export type GoreCallback = (x: number, y: number, z: number, amount: number) => void;

/** The killing blow, as reported by the server. */
export interface LastHit {
  x: number;
  y: number;
  z: number;
  zone: string;
  damage: number;
  /** Horizontal push direction and strength. */
  kx: number;
  kz: number;
  force: number;
}

/** Rendered zombie: shambles/runs, lunges, loses limbs, crawls, and collapses when killed. */
export class ZombieAvatar {
  readonly root = new Group();
  private readonly model: Group;
  private readonly bones = new Map<string, Bone>();
  private cur: Layer = { clip: null, time: 0, rate: 1 };
  private prev: Layer = { clip: null, time: 0, rate: 1 };
  private fade = 1;
  private lastX = Number.NaN;
  private lastZ = 0;
  private limbs = 0;
  private crawl = 0;
  private deadFor = -1;
  private wasAttacking = false;
  private flinch = 0;
  private visibility = 0;
  /** Gameplay visibility (inside the player's vision cone). */
  seen = false;
  private ragdoll: Ragdoll | null = null;
  /** Same terrain lookup used by player corpses. */
  ground: ((x: number, z: number) => number) | null = null;
  private readonly tmp = new Vector3();

  constructor(
    private readonly template: CharacterTemplate,
    private readonly onGore: GoreCallback,
    scale = 1,
  ) {
    this.model = template.root.clone(true);
    this.model.traverse((o) => {
      if (o instanceof Mesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      } else if (o !== this.model && o.name) {
        this.bones.set(o.name, { node: o, restPos: o.position.clone(), restRot: o.rotation.clone() });
      }
    });
    this.root.scale.setScalar(scale);
    this.root.add(this.model);
    this.root.visible = false;
  }

  /** Bone world position (for gore at a severed limb). */
  private boneWorld(name: string, out: Vector3): Vector3 {
    const b = this.bones.get(name)?.node;
    if (!b) return out.copy(this.root.position);
    b.updateWorldMatrix(true, false);
    return out.setFromMatrixPosition(b.matrixWorld);
  }

  flinchFrom(): void {
    this.flinch = 1;
  }

  private play(name: string | null, rate = 1, fade = 0): void {
    const fallback = name === 'lunge' || name === 'bite' ? ['attack_slam', 'bite'] : ['walk'];
    const clip = name ? (this.template.clips.get(name) ?? fallback.map(n => this.template.clips.get(n)).find(Boolean) ?? null) : null;
    if (clip === this.cur.clip) {
      this.cur.rate = rate;
      return;
    }
    this.prev = this.cur;
    this.cur = { clip, time: 0, rate };
    this.fade = fade;
  }

  /** The killing hit makes the connected body go limp, just like a player corpse. */
  startRagdoll(kx: number, kz: number, force: number, ground: (x: number, z: number) => number): Ragdoll | null {
    if (this.deadFor >= 0) return this.ragdoll;
    this.deadFor = 0; // Death stays latched while older interpolated snapshots catch up.
    this.flinch = 0;
    this.ragdoll = Ragdoll.start(this.model, (name) => this.bones.get(name)?.node, PX, ground, kx, kz, force);
    return this.ragdoll;
  }

  update(x: number, y: number, z: number, yaw: number, flags: number, limbs: number, dt: number): void {
    if (this.ragdoll) {
      this.ragdoll.step(dt);
      this.updateVisibility(dt);
      return;
    }
    if (this.lastX !== this.lastX) {
      this.lastX = x;
      this.lastZ = z;
    }
    const speed = Math.hypot(x - this.lastX, z - this.lastZ) / Math.max(dt, 1e-3);
    this.lastX = x;
    this.lastZ = z;
    this.root.position.set(x, y, z);
    this.root.rotation.y = yaw;

    // Newly broken limbs: hide the lower half and burst gore from the stump.
    const fresh = limbs & ~this.limbs;
    if (fresh) {
      for (const l of LIMB_BONES) {
        if (!(fresh & l.bit)) continue;
        const b = this.bones.get(l.hide);
        if (b) b.node.visible = false;
        this.boneWorld(l.hide, this.tmp);
        this.onGore(this.tmp.x, this.tmp.y, this.tmp.z, 1);
      }
    }
    this.limbs = limbs;

    const dead = (flags & EntityFlags.Dead) !== 0 || this.deadFor >= 0;
    // Snapshot-only deaths (joining late or entering a corpse's streaming region).
    if (dead && this.deadFor < 0 && this.ground) {
      const ragdoll = this.startRagdoll(Math.sin(yaw), Math.cos(yaw), 1, this.ground);
      if (ragdoll) {
        ragdoll.step(dt);
        this.updateVisibility(dt);
        return;
      }
    }
    const crawling = isCrawling(limbs);
    const attacking = (flags & EntityFlags.Attacking) !== 0;
    const attackStart = attacking && !this.wasAttacking;
    this.wasAttacking = attacking;

    const busy = ['lunge', 'attack_slam', 'bite'].includes(this.cur.clip?.name ?? '') && this.cur.time < (this.cur.clip?.length ?? 0);
    if (dead) {
      if (this.deadFor < 0) this.deadFor = 0;
      this.play(null, 1, 0.5);
    } else if (attackStart && !crawling) {
      this.play('lunge', 1.4);
    } else if (attackStart && crawling) {
      this.play('bite', 1.2);
    } else if (!busy) {
      if (speed > 0.25) this.play('run', crawling ? Math.max(0.35, speed * 0.6) : Math.min(1.5, Math.max(0.45, speed / 4.2)));
      else this.play(crawling ? null : 'run', 0.12);
    }

    for (const l of [this.cur, this.prev]) l.time += dt * l.rate;
    this.fade = Math.min(1, this.fade + dt / FADE_SEC);
    this.applyPose();

    // Crawl: lie prone (head forward) and drag along.
    this.crawl += ((crawling && !dead ? 1 : 0) - this.crawl) * Math.min(1, dt * 6);
    let tilt = -this.crawl * 80 * DEG;
    let lift = this.crawl * 0.22;
    if (dead) {
      this.deadFor += dt;
      const k = Math.min(1, this.deadFor / 0.45);
      // Fall backwards (crawlers just go flat), then sink into the ground.
      tilt = crawling ? -90 * DEG : (k * k) * 88 * DEG;
      lift = 0.12 - Math.max(0, this.deadFor - 6) * 0.15;
    }
    // Flinch on hits: snap back, recover.
    if (this.flinch > 0) {
      const body = this.bones.get('body');
      if (body) body.node.rotation.x -= this.flinch * 0.5;
      this.flinch = Math.max(0, this.flinch - dt * 5);
    }
    this.model.rotation.x = tilt;
    this.model.position.y = lift;

    this.updateVisibility(dt);
  }

  private updateVisibility(dt: number): void {
    // Fade in/out with the vision cone so zombies don't pop, including their corpses.
    this.visibility += ((this.seen ? 1 : 0) - this.visibility) * Math.min(1, dt * 8);
    this.root.visible = this.visibility > 0.5;
  }

  private applyPose(): void {
    const w = this.fade;
    for (const [name, bone] of this.bones) {
      const hasA = this.sample(this.prev, name, rotA, posA);
      const hasB = this.sample(this.cur, name, rotB, posB);
      const node = bone.node;
      if (!hasA && !hasB) {
        node.position.copy(bone.restPos);
        node.rotation.copy(bone.restRot);
        continue;
      }
      node.rotation.set(
        bone.restRot.x - (rotA[0] + (rotB[0] - rotA[0]) * w) * DEG,
        bone.restRot.y - (rotA[1] + (rotB[1] - rotA[1]) * w) * DEG,
        bone.restRot.z + (rotA[2] + (rotB[2] - rotA[2]) * w) * DEG,
        'ZYX',
      );
      node.position.set(
        bone.restPos.x - (posA[0] + (posB[0] - posA[0]) * w) * PX,
        bone.restPos.y + (posA[1] + (posB[1] - posA[1]) * w) * PX,
        bone.restPos.z + (posA[2] + (posB[2] - posA[2]) * w) * PX,
      );
    }
  }

  private sample(layer: Layer, bone: string, rot: [number, number, number], pos: [number, number, number]): boolean {
    rot[0] = rot[1] = rot[2] = 0;
    pos[0] = pos[1] = pos[2] = 0;
    const clip = layer.clip;
    if (!clip) return false;
    const tracks = clip.bones.get(bone);
    if (!tracks) return false;
    const t = clip.loop ? layer.time % clip.length : Math.min(layer.time, clip.length);
    if (tracks.rotation) sampleTrack(tracks.rotation, t, rot);
    // Root translation would fight the server position.
    if (tracks.position && bone !== 'root') sampleTrack(tracks.position, t, pos);
    return true;
  }

  get position(): Vector3 {
    return this.root.position;
  }

  addTo(scene: Scene): void {
    scene.add(this.root);
  }

  dispose(scene: Scene): void {
    this.ragdoll?.release();
    this.ragdoll = null;
    scene.remove(this.root);
  }
}
