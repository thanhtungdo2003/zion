import { Ragdoll } from './ragdoll';
import { Box3, CanvasTexture, Color, type Material, Group, LinearFilter, Mesh, Sprite, SpriteMaterial, Vector3, Quaternion, type Camera, type Matrix4, type Euler, type Object3D, type Scene } from 'three';
import { EntityFlags, RANKS, TICK_DT, WEAPON_BY_ITEM, weaponSpec, type Attachments, type RankTitle } from '@zion/shared';
import { DEFAULT_CHARACTER } from '@zion/physics';
import type { Stance } from '../inventory/items';
import { dressWeapon, type WeaponLibrary, type WeaponVisual } from './weapons';
import { BB_UNITS_PER_METER, sampleTrack, type CharacterClip, type CharacterTemplate } from './character-model';
import { armorPieces } from './armor-models';
import { RifleGrip } from './rifle-grip';
import { WeaponAim } from './weapon-aim';
import { MeleeEdge } from './melee-edge';
import { aimOffhandLight, offhandLightPose } from './offhand-light';

const DEG = Math.PI / 180;
const PX = 1 / BB_UNITS_PER_METER;
const FADE_SEC = 0.18;
/** Clips whose root translation would fight the physics-driven position. */
const NO_ROOT_MOTION = new Set(['jump']);
/** The jump clip opens with a crouch; physics has already left the ground, so skip it. */
const JUMP_START = 0.15;
/** The head follows the aim freely up to this angle; beyond it the whole body turns. */
const MAX_HEAD_YAW = 55 * DEG;
const STANCE_CLIPS: Record<Stance, { idle: string | null; walk: string }> = {
  unarmed: { idle: null, walk: 'walk' },
  rifle: { idle: 'rifle_idle', walk: 'rifle_walk' },
  pistol: { idle: 'pistol_idle', walk: 'pistol_walk' },
  melee: { idle: 'melee_idle', walk: 'melee_walk' },
  grenade: { idle: 'grenade_idle', walk: 'grenade_walk' },
};

function wrapAngle(a: number): number {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
}

export function labelSprite(text: string, rank?: RankTitle, pvp = false): Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = rank ? 76 : 48;
  const ctx = canvas.getContext('2d')!;
  ctx.font = '600 26px "Noto Sans", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  const w = Math.min(250, ctx.measureText(text).width + 20);
  ctx.fillRect(128 - w / 2, 6, w, 36);
  ctx.fillStyle = pvp ? '#ff4949' : '#f0e9d8';
  ctx.fillText(text, rank ? 140 : 128, 25, rank ? 208 : 246);
  if (rank) {
    ctx.fillStyle = RANKS[rank.tier]!.color;
    ctx.beginPath(); ctx.moveTo(8, 8); ctx.lineTo(30, 8); ctx.lineTo(28, 28); ctx.lineTo(19, 36); ctx.lineTo(10, 28); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#141617'; ctx.font = 'bold 17px "Noto Sans", sans-serif'; ctx.fillText(RANKS[rank.tier]!.icon, 19, 20);
    ctx.fillStyle = RANKS[rank.tier]!.color; ctx.font = '600 17px "Noto Sans", sans-serif'; ctx.fillText(rank.title, 128, 57);
  }
  const tex = new CanvasTexture(canvas);
  tex.minFilter = LinearFilter;
  const sprite = new Sprite(new SpriteMaterial({ map: tex, depthTest: true, transparent: true }));
  sprite.scale.set(1.6, rank ? 0.475 : 0.3, 1);
  sprite.position.y = 2.15;
  return sprite;
}

interface Layer {
  clip: CharacterClip | null;
  time: number;
  rate: number;
}

interface Bone {
  node: Object3D;
  restPos: Vector3;
  restRot: Euler;
}

const rotA: [number, number, number] = [0, 0, 0];
const rotB: [number, number, number] = [0, 0, 0];
const posA: [number, number, number] = [0, 0, 0];
const posB: [number, number, number] = [0, 0, 0];

/** The character's three sword-slash poses, used in turn. */
const SLASH_CLIPS = ['sword_slash_vertical', 'sword_slash_horizontal', 'sword_slash_diagonal'] as const;
/** Slung weapons are drawn a bit larger than real size, like held ones (stylised character). */
const BACK_SCALE = 1.3;

/** Player character built from the preloaded Blockbench model, driven by its own animation clips. */
const INFECTED_TINT = new Color(1, .42, .4);
const INFECTED_MATERIALS = new WeakMap<Material, Material>();

export class Avatar {
  private drivingActive = false;
  drivingPose(quad: boolean | null, yaw: number, pitch=0, roll=0): void {
    if (quad === null) {
      if (this.drivingActive) { this.model.position.set(0,0,0); this.model.rotation.set(0,0,0); this.root.rotation.set(0,yaw,0,'YXZ'); }
      this.drivingActive = false; return;
    }
    this.drivingActive = true; this.root.rotation.set(pitch,yaw,roll,'YXZ'); this.bodyYaw = yaw;
    // Clear locomotion/root animation before applying the seat pose: seat offsets refer to
    // the unshifted skeleton's feet, whose hip pivot is 0.675 m above its origin.
    for(const bone of this.bones.values()){bone.node.position.copy(bone.restPos);bone.node.rotation.copy(bone.restRot);}
    this.model.position.set(0,0,0);this.model.rotation.set(0,0,0);
    const body=this.bones.get('body');
    if(body){body.node.position.y-=quad?.04:.16;body.node.rotation.x+=quad?.14:-.04;}
    for (const side of ['left', 'right']) {
      const leg = this.bones.get(`leg_${side}`), arm = this.bones.get(`arm_${side}`), hand = this.bones.get(`hand_${side}`);
      if (leg) { leg.node.rotation.copy(leg.restRot); leg.node.rotation.x += quad ? .85 : 1.3; leg.node.rotation.z += (side === 'left' ? -1 : 1) * (quad ? .28 : .06); }
      if (arm) { arm.node.rotation.copy(arm.restRot); arm.node.rotation.x += quad ? 1.05 : 1.2; arm.node.rotation.z += (side === 'left' ? -1 : 1) * .12; }
      if (hand) { hand.node.rotation.copy(hand.restRot); hand.node.rotation.x += .2; }
    }
  }
  private offhandId: string | null = null;
  private offhandObject: Object3D | null = null;
  private offhandBase: Matrix4 | null = null;
  private weaponAim: WeaponAim | null = null;
  private readonly meleeEdge = new MeleeEdge();
  /** Animals: the body always faces the yaw (no head-then-body turning). */
  rigid = false;
  readonly root = new Group();
  private readonly model: Group;
  private readonly restHeadInverse = new Quaternion();
  private readonly rollEyeOffset = new Vector3();
  private readonly rollCameraRotation = new Quaternion();
  private readonly rollBaseInverse = new Quaternion();
  private readonly bones = new Map<string, Bone>();
  private cur: Layer = { clip: null, time: 0, rate: 1 };
  private prev: Layer = { clip: null, time: 0, rate: 1 };
  private fade = 1;
  private label: Sprite | null = null;
  private labelText = '';
  private lastX = 0;
  private lastY = 0;
  private lastZ = 0;
  private rollYaw = 0;
  private recoveringFromRoll = false;
  private bodyYaw = Number.NaN;
  private headYaw = 0;
  private stance: Stance = 'unarmed';
  private idleClip: string | null = null;
  private idleDurationRange: readonly [number, number] | null = null;
  private idleRate = 1;
  private weaponId: string | null = null;
  private rifleGrip: RifleGrip | null = null;
  private oneShot: string | null = null;
  private recoil = 0;
  private swimLift = 0;
  private aimPitch = 0;
  private aimBlend = 0;
  private weaponKey: string | null = null;
  private readonly weaponObjects = new Map<string, { obj: Object3D; visual: WeaponVisual; bones: Map<string, Bone & { restScale: Vector3 }> }>();
  private weaponAnim: { clip: CharacterClip; time: number; rate: number } | null = null;
  private airborne = 0;
  private wasAttacking = false;
  private breath = 0;
  private slashCount = 0;
  private readonly restWorld = new Map<string, Vector3>();
  private readonly armor = new Map<string, Object3D[]>();
  /** Variant of the latest blade swing (0 vertical, 1 horizontal, 2 diagonal), for its trail. */
  slashVariant = 0;
  /** Applying a first aid kit: loops the bandage animation with the weapon put away. */
  healing = false;
  /** Stowed weapon on the back or hip. */
  private backId: string | null = null;
  private backObj: Object3D | null = null;

  /** The character's own meshes (not weapons or armour), for the infection tint. */
  private readonly bodyMeshes: Mesh[] = [];
  private infected = false;

  /**
   * Infection zombie: the same skin under a faint red veil over the whole body (materials are
   * shared between avatars, so tinted copies are cached per original).
   */
  setInfected(on: boolean): void {
    if (on === this.infected) return;
    this.infected = on;
    for (const mesh of this.bodyMeshes) {
      const swap = (m: Material): Material => {
        if (!on) return (m.userData.untinted as Material | undefined) ?? m;
        let tinted = INFECTED_MATERIALS.get(m);
        if (!tinted) {
          tinted = m.clone();
          const t = tinted as Material & { color?: Color; emissive?: Color };
          t.color?.multiply(INFECTED_TINT);
          t.emissive?.setRGB(.3, .015, .01);
          tinted.userData = { ...m.userData, untinted: m };
          INFECTED_MATERIALS.set(m, tinted);
        }
        return tinted;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
    }
  }

  constructor(
    private readonly template: CharacterTemplate,
    isLocal: boolean,
  ) {
    this.model = template.root.clone(true);
    this.model.traverse((o) => {
      if (o instanceof Mesh) {
        this.bodyMeshes.push(o);
        o.castShadow = true;
        o.receiveShadow = !isLocal;
      } else if (o.userData.restPos) {
        // userData is JSON-cloned (Vector3/Euler lose their methods), so read rest pose from the clone itself.
        this.bones.set(o.name, { node: o, restPos: o.position.clone(), restRot: o.rotation.clone() });
      }
    });
    this.root.add(this.model);
    // Rest positions of the bones in model space: armour pieces are placed relative to them.
    this.model.updateMatrixWorld(true);
    for (const [name, b] of this.bones) this.restWorld.set(name, b.node.getWorldPosition(new Vector3()));
    const head=this.bones.get('head')?.node;
    if(head){
      head.getWorldQuaternion(this.restHeadInverse).invert();
      this.rollEyeOffset.set(0,DEFAULT_CHARACTER.eyeHeight,-.12).sub(head.getWorldPosition(new Vector3())).applyQuaternion(this.restHeadInverse);
    }
  }

  /** Follow the actual authored root/head animation, including the forward/back eye orbit. */
  rollCamera(camera: Camera): boolean {
    const head=this.bones.get('head')?.node;
    if(!head || this.cur.clip?.name!=='roll')return false;
    this.root.updateMatrixWorld(true);
    head.getWorldQuaternion(this.rollCameraRotation).multiply(this.restHeadInverse);
    this.rollBaseInverse.setFromAxisAngle(new Vector3(0,1,0),-this.root.rotation.y);
    this.rollCameraRotation.multiply(this.rollBaseInverse);
    camera.quaternion.premultiply(this.rollCameraRotation);
    camera.position.copy(this.rollEyeOffset);head.localToWorld(camera.position);
    return true;
  }

  /** Puts on (or takes off, null) the armour piece for a slot; its parts ride on the body bones. */
  setArmor(slot: string, template: CharacterTemplate | null): void {
    for (const o of this.armor.get(slot) ?? []) o.removeFromParent();
    this.armor.delete(slot);
    if (!template) return;
    const objs: Object3D[] = [];
    for (const { bone, object } of armorPieces(template, (b) => this.restWorld.get(b))) {
      this.bones.get(bone)?.node.add(object);
      objs.push(object);
    }
    this.armor.set(slot, objs);
  }

  setName(name: string, rank?: RankTitle, pvp = false): void {
    const key = `${name}:${rank?.step ?? ''}:${pvp}`;
    if (key === this.labelText) return;
    this.labelText = key;
    if (this.label) {
      this.root.remove(this.label);
      this.label.material.map?.dispose();
      this.label.material.dispose();
      this.label = null;
    }
    // No name: no floating tag at all (e.g. other players in battle royale).
    if (!name) return;
    this.label = labelSprite(name, rank, pvp);
    this.root.add(this.label);
  }

  /** Plays a clip to the end, ignoring locomotion until it finishes (throws, punches). */
  playOnce(name: string, durationMs?: number): void {
    if (!this.template.clips.has(name)) return;
    this.cur = { clip: null, time: 0, rate: 1 };
    const clip = this.template.clips.get(name)!;
    this.play(name, durationMs ? clip.length / (durationMs / 1000) : 1, 0, 0.4);
    this.oneShot = name;
  }

  /** Blade swing: cycles through the three sword-slash poses; returns the variant played. */
  slash(): number {
    this.meleeEdge.reset();
    const v = this.slashCount++ % SLASH_CLIPS.length;
    this.slashVariant = v;
    const spec = weaponSpec(WEAPON_BY_ITEM[this.weaponId ?? ''] ?? 0);
    const duration = spec?.kind === 'melee' ? spec.animationMs : undefined;
    if (this.template.clips.has(SLASH_CLIPS[v]!)) this.playOnce(SLASH_CLIPS[v]!, duration);
    else this.playOnce('melee_attack', duration);
    return v;
  }

  setAimPitch(pitch: number): void {
    this.aimPitch += (pitch - this.aimPitch) * 0.35;
  }

  /** Weapon kick: muzzle climb that decays over a few frames. */
  kick(amount: number): void {
    this.recoil = Math.min(0.5, this.recoil + amount);
    this.proneShotFor = .6;
  }

  private proneShotFor = 0;
  private crouchBlend = 0;
  /** 0..1 eased low-ready carry while running with a gun. */
  private runBlend = 0;
  private readonly runTarget = new Vector3();
  private leanBlend = 0;

  private play(name: string | null, rate = 1, start = 0, fade = 0): void {
    const clip = name ? (this.template.clips.get(name) ?? null) : null;
    if (clip === this.cur.clip) {
      this.cur.rate = rate;
      return;
    }
    this.prev = this.cur;
    this.cur = { clip, time: start, rate };
    this.fade = fade;
  }

  private choose(speed: number, vy: number, flags: number, dt: number): void {
    if (flags & (EntityFlags.InPlane | EntityFlags.Freefall | EntityFlags.Parachute)) { this.play(null); return; }
    const dead = (flags & EntityFlags.Dead) !== 0;
    const swimming = (flags & EntityFlags.Swimming) !== 0;
    const grounded = (flags & EntityFlags.Grounded) !== 0;
    const attacking = (flags & EntityFlags.Attacking) !== 0;
    this.airborne = grounded || swimming ? 0 : this.airborne + dt;

    const attackStart = attacking && !this.wasAttacking;
    this.wasAttacking = attacking;
    if (dead) return this.play(null);
    if (swimming) {
      this.oneShot = null;
      this.recoil = 0;
      return this.play(this.template.clips.has('swim') ? 'swim' : 'walk', speed > .3 ? Math.min(1.6, Math.max(.75, speed / 2)) : .6, 0, .3);
    }
    if ((flags & EntityFlags.Reviving) !== 0) {
      this.oneShot = null;
      this.recoil = 0;
      return this.play(this.template.clips.has('cpr_kneel') ? 'cpr_kneel' : 'bandage_wrap', 1, 0, .3);
    }
    if ((flags & EntityFlags.Prone) !== 0) {
      this.oneShot = null;
      const gun = this.stance === 'rifle' || this.stance === 'pistol';
      const firing = gun && (attacking || this.proneShotFor > 0);
      const clip = firing ? 'prone_rifle_shoot' : speed > .2 ? 'prone_rifle_crawl' : gun ? 'prone_rifle_idle' : 'prone';
      return this.play(this.template.clips.has(clip) ? clip : 'prone', speed > .2 && !firing ? Math.min(1.6, Math.max(.4, speed / 1.15)) : 1, 0, .3);
    }
    if ((flags & EntityFlags.Rolling) !== 0) {
      // Snapshot/prediction flags can end before the last rendered frame of the clip.
      if (this.cur.clip?.name !== 'roll') this.play('roll', 1, 0, 0.6);
      return;
    }
    // Finish the tuck and foot plant before locomotion can take over.
    if (this.cur.clip?.name === 'roll' && this.cur.time < this.cur.clip.length) return;
    const busy = this.oneShot !== null && this.cur.clip?.name === this.oneShot && this.cur.time < this.cur.clip.length;
    if (!busy) this.oneShot = null;
    // Guns fire without a body animation (recoil only); grenades throw; empty hands punch.
    if (attackStart && !busy && this.stance === 'melee' && this.weaponId) {
      this.slash();
      return;
    }
    if (attackStart && !busy && (!this.weaponId || (this.stance === 'grenade' && this.weaponId !== 'c4_detonator'))) {
      this.playOnce(this.weaponId ? 'grenade_throw' : 'melee_attack');
      return;
    }
    if (busy) return;
    if (this.healing && !swimming) return this.play('bandage_wrap', 1, 0, 0.3);
    if ((flags & EntityFlags.Mantling) !== 0) {
      // Mantle: hands on the edge, pulling up and over, quick.
      return this.play(this.template.clips.has('climb_ladder') ? 'climb_ladder' : 'jump', 1.8, 0, 0.12);
    }
    if ((flags & EntityFlags.Climbing) !== 0) {
      // Rungs at the climbing pace; frozen while hanging still.
      return this.play(this.template.clips.has('climb_ladder') ? 'climb_ladder' : 'walk', Math.abs(vy) > 0.3 ? Math.min(1.6, Math.abs(vy) / 2.2) : 0, 0, 0.25);
    }
    // Rising off the ground = a jump: react on the very first frame, not after a delay.
    if (!grounded && !swimming && (vy > 1 || this.airborne > 0.15)) return this.play('jump', 1, JUMP_START, 0.5);
    if (speed > 0.3) {
      const running = (flags & EntityFlags.Sprinting) !== 0 || speed > 5;
      // Armed characters keep the weapon up while running.
      if (running && this.weaponId) return this.play(STANCE_CLIPS[this.stance].walk, Math.min(2.2, speed / 3));
      if (running) return this.play('run', Math.min(1.6, Math.max(0.7, speed / 6.2)));
      return this.play(STANCE_CLIPS[this.stance].walk, Math.min(1.8, Math.max(0.6, speed / 3.2)));
    }
    this.play(this.idleClip ?? STANCE_CLIPS[this.stance].idle, this.idleClip ? this.idleRate : 1);
  }

  private ragdoll: Ragdoll | null = null;

  /** Killed: the body goes limp and is thrown back along (kx, kz), parts staying connected. */
  /** Knocked back by a shot: limp for a moment, then back on the feet (alive). */
  stagger(kx: number, kz: number, ground: (x: number, z: number) => number): void {
    if (this.ragdoll) return;
    this.startRagdoll(kx, kz, 1.6, ground);
    this.ragdollTemp = !!this.ragdoll;
  }

  private ragdollTemp = false;
  /** Direction and strength of the last blow, used when a knock-down starts the ragdoll. */
  knockHint: { kx: number; kz: number; force: number } | null = null;
  /** Ground height lookup for ragdolls (set by the engine). */
  ground: ((x: number, z: number) => number) | null = null;
  private flightTilt = 0;
  private flightActive = false;
  flightPose(flags: number, dive: boolean, moving: boolean, dt: number): void {
    const falling = !!(flags & EntityFlags.Freefall), chute = !!(flags & EntityFlags.Parachute);
    const active = falling || chute || !!(flags & EntityFlags.InPlane);
    if (!active && !this.flightActive) return;
    this.flightActive = active;
    const target = falling ? (dive ? -2.55 : moving ? -1.95 : -Math.PI / 2) : chute ? -.12 : 0;
    this.flightTilt += (target - this.flightTilt) * (1 - Math.exp(-dt * 7));
    this.model.rotation.x = this.flightTilt;
    this.model.position.y = falling ? 1 : 0;
    if (falling || chute) for (const name of ['arm_left', 'arm_right']) {
      const arm = this.bones.get(name)?.node;
      if (arm) { arm.rotation.x = chute ? -2.2 : -.35; arm.rotation.z = name === 'arm_left' ? .9 : -.9; }
    }
    this.root.visible = !(flags & EntityFlags.InPlane);
  }

  startRagdoll(kx: number, kz: number, force: number, ground: (x: number, z: number) => number): void {
    if (this.ragdoll) return;
    this.model.rotation.set(0, 0, 0);
    this.model.position.set(0, 0, 0);
    this.ragdoll = Ragdoll.start(this.model, (n) => this.bones.get(n)?.node, PX, ground, kx, kz, force);
  }

  update(x: number, y: number, z: number, yaw: number, flags: number, dt: number, _elapsed: number, rollState?: { rollTicks: number; rollYaw: number }): void {
    const prone = (flags & EntityFlags.Prone) !== 0;
    this.proneShotFor = Math.max(0, this.proneShotFor - dt);
    if (this.label) this.label.visible = !prone;
    // Down (bleeding out) or dead: limp. Starts here too when no hit started it (bites…).
    const limp = (flags & (EntityFlags.Dead | EntityFlags.Downed)) !== 0;
    if (limp && !this.ragdoll && this.ground) this.startRagdoll(0, 1, 1, this.ground);
    // Run over: limp and thrown along the blow, back on the feet once the server lets go.
    const knocked = (flags & EntityFlags.Knocked) !== 0;
    if (knocked && !this.ragdoll && this.ground) {
      const h = this.knockHint ?? { kx: 0, kz: 1, force: 4 };
      this.startRagdoll(h.kx, h.kz, h.force, this.ground);
      this.ragdollTemp = false;
    }
    if (this.ragdoll) {
      const dead = limp;
      // A stagger turns into the death ragdoll if the hit was fatal.
      if (dead) this.ragdollTemp = false;
      if (dead || knocked || (this.ragdollTemp && this.ragdoll.time < 0.85)) {
        this.ragdoll.step(dt);
        return;
      }
      this.ragdollTemp = false;
      // Respawned: back to the animated skeleton.
      this.ragdoll.release();
      this.ragdoll = null;
    }
    this.root.position.set(x, y, z);
    const inv = 1 / Math.max(dt, 1e-3);
    const dx = x - this.lastX;
    const dz = z - this.lastZ;
    const speed = Math.hypot(dx, dz) * inv;
    const vy = (y - this.lastY) * inv;
    const wasRolling = this.cur.clip?.name === 'roll';
    // Local simulation owns the end of the action; never keep tumbling after steering resumes.
    if (rollState && rollState.rollTicks === 0 && wasRolling) this.cur.time = this.cur.clip!.length;
    this.choose(speed, vy, flags, dt);
    const rolling = this.cur.clip?.name === 'roll';
    if (rolling && !wasRolling) this.rollYaw = rollState?.rollYaw ?? (speed > 1 ? Math.atan2(-dx, -dz) : yaw);
    if (this.bodyYaw !== this.bodyYaw || this.rigid) this.bodyYaw = yaw;
    if (prone) {
      this.bodyYaw = yaw;
      this.headYaw = 0;
    } else if ((flags & (EntityFlags.Climbing | EntityFlags.Mantling)) !== 0) {
      // On a ladder or over a ledge: keep facing the wall.
      this.headYaw = 0;
    } else if ((flags & EntityFlags.Swimming) !== 0 && speed > 0.4) {
      // Swimming: the body turns smoothly into the direction it swims.
      const d = wrapAngle(Math.atan2(-dx, -dz) - this.bodyYaw);
      const max = 6 * dt;
      this.bodyYaw = wrapAngle(this.bodyYaw + Math.max(-max, Math.min(max, d)));
      this.headYaw = 0;
    } else {
      // Head tracks the aim; the body only turns once the head would exceed its range.
      let diff = wrapAngle(yaw - this.bodyYaw);
      // On the move the whole body squares up to where the player looks (strafing and
      // backpedalling included); standing still, only the head follows until it runs out of range.
      const moving = speed > .6 && !rolling;
      const turn = moving ? diff : diff > MAX_HEAD_YAW ? diff - MAX_HEAD_YAW : diff < -MAX_HEAD_YAW ? diff + MAX_HEAD_YAW : 0;
      // Turning back toward the aim after a sideways/backward roll must not snap the body.
      const maxTurn = this.recoveringFromRoll ? 8 * dt : moving ? 12 * dt : Infinity;
      this.bodyYaw = wrapAngle(this.bodyYaw + Math.max(-maxTurn, Math.min(maxTurn, turn)));
      if (Math.abs(turn) <= maxTurn) this.recoveringFromRoll = false;
      diff = wrapAngle(yaw - this.bodyYaw);
      this.headYaw = Math.max(-MAX_HEAD_YAW, Math.min(MAX_HEAD_YAW, diff));
    }
    this.root.rotation.y = this.bodyYaw;
    this.lastX = x;
    this.lastY = y;
    this.lastZ = z;
    // A roll tumbles along its travel direction, which may differ from where the mouse aims.
    if (rolling) {
      this.recoveringFromRoll = true;
      this.root.rotation.y = this.rollYaw;
      this.bodyYaw = this.rollYaw;
      this.headYaw = 0;
    } else {
      this.rollYaw = this.bodyYaw;
    }

    for (const l of [this.cur, this.prev]) {
      if (l === this.cur && l.clip?.name === this.idleClip && this.idleDurationRange) {
        let remaining = dt;
        while (remaining > 0) {
          const untilLoop = Math.max(0, (l.clip.length - l.time) / l.rate);
          if (remaining < untilLoop) { l.time += remaining * l.rate; break; }
          remaining -= untilLoop;
          l.time = 0;
          l.rate = this.idleRate = this.randomIdleRate();
        }
      } else l.time += dt * l.rate;
    }
    this.updateWeaponAnim(dt);
    if (rolling && rollState && this.cur.clip) {
      const durationTicks = Math.max(1, Math.round(DEFAULT_CHARACTER.rollDuration / TICK_DT));
      this.cur.time = this.cur.clip.length * Math.max(0, Math.min(1, 1 - rollState.rollTicks / durationTicks));
    }
    this.fade = Math.min(1, this.fade + dt / FADE_SEC);
    this.applyPose();
    const head = this.bones.get('head');
    const body = this.bones.get('body');
    // Raise/lower the arms (and the gun with them) to the aim elevation.
    const held = this.weaponKey ? this.weaponObjects.get(this.weaponKey) : undefined;
    const treating = this.healing || (flags & EntityFlags.Reviving) !== 0;
    const aiming = !limp && !rolling && !treating && (flags & EntityFlags.Aiming) !== 0;
    this.aimBlend += ((aiming ? 1 : 0) - this.aimBlend) * (1 - Math.exp(-dt * 14));
    if (held) held.obj.visible = !treating;
    if (!rolling && this.weaponId && this.stance !== 'grenade' && this.oneShot === null && !treating) {
      for (const arm of ['arm_right', 'arm_left']) {
        const b = this.bones.get(arm);
        if (b) b.node.rotation.x += this.aimPitch + this.aimBlend * .12;
      }
    }
    if (this.recoil > 0) {
      for (const arm of ['arm_right', 'arm_left']) {
        const b = this.bones.get(arm);
        if (b) b.node.rotation.x += this.recoil;
      }
      // The whole body takes the kick: upper body rocks back.
      if (body) body.node.rotation.x += this.recoil * 0.3;
      this.recoil = Math.max(0, this.recoil - dt * 3.5);
    }
    if (!rolling && this.weaponId && body) {
      // Armed: the whole upper body (arms + gun) turns with the aim so the muzzle points at the
      // cursor; only the legs wait until the twist gets too large.
      body.node.rotation.y += this.headYaw;
    } else if (!rolling && head) {
      head.node.rotation.y += this.headYaw;
    }

    // Crouch (X): a low kneeling stance, one knee forward, the other leg back, chest over the gun.
    const crouching = !limp && !rolling && !prone && (flags & (EntityFlags.Crouching | EntityFlags.Swimming)) === EntityFlags.Crouching;
    this.crouchBlend += ((crouching ? 1 : 0) - this.crouchBlend) * (1 - Math.exp(-dt * 10));
    const lean = limp || prone || rolling ? 0 : (flags & EntityFlags.LeanLeft) ? -1 : (flags & EntityFlags.LeanRight) ? 1 : 0;
    this.leanBlend += (lean - this.leanBlend) * (1 - Math.exp(-dt * 10));
    if (this.crouchBlend > .001) {
      const c = this.crouchBlend, step = speed > .3 ? Math.sin(this.breath * 9) * .25 : 0;
      const legL = this.bones.get('leg_left')?.node, legR = this.bones.get('leg_right')?.node;
      if (legL) legL.rotation.x = legL.rotation.x * (1 - c) + c * (1 + step);
      if (legR) legR.rotation.x = legR.rotation.x * (1 - c) + c * (-1 - step);
      if (body) body.node.rotation.x -= .22 * c;
    }
    // Lean (Q / E): the upper body tips out sideways from the hips (+X is the character's right).
    if (body && Math.abs(this.leanBlend) > .001) body.node.rotation.z -= .32 * this.leanBlend;
    const dead = (flags & EntityFlags.Dead) !== 0;
    this.model.rotation.x = dead ? -Math.PI / 2 : 0;
    // ...and the character is shoved back a few centimetres (model faces −Z, so back is +Z).
    this.model.position.z = dead ? 0 : this.recoil * 0.12;
    this.swimLift += (((flags & EntityFlags.Swimming) !== 0 ? .35 : 0) - this.swimLift) * (1 - Math.exp(-dt * 8));
    this.model.position.y = dead ? 0.2 : this.swimLift;
    // Hips lowered so the kneeling legs reach the ground.
    this.model.position.y -= .3 * this.crouchBlend;
    if (held) {
      held.obj.matrix.copy(held.visual.attach);
      held.obj.matrixWorldNeedsUpdate = true;
      const triggerSide = held.visual.twoHandGrip?.triggerHand ?? 'right';
      const supportSide = triggerSide === 'right' ? 'left' : 'right';
      const trigger = this.bones.get(`hand_${triggerSide}`)?.node;
      const support = this.bones.get(`hand_${supportSide}`)?.node;
      const supportArm = this.bones.get(`arm_${supportSide}`)?.node;
      if (!dead && !treating && this.cur.clip?.name === 'rifle_patrol_idle' && held.visual.twoHandGrip && trigger && support && supportArm && body) {
        this.rifleGrip ??= new RifleGrip();
        this.rifleGrip.pose(held.obj, held.visual, trigger, support, supportArm, body.node);
      }
      // Running with a gun: both hands on it, muzzle lowered towards the ground across the body.
      const running = !aiming && !prone && !(flags & EntityFlags.Crouching) && speed > .3 && ((flags & EntityFlags.Sprinting) !== 0 || speed > 5) && (flags & (EntityFlags.Grounded | EntityFlags.Swimming)) === EntityFlags.Grounded;
      this.runBlend += ((running && held.visual.aim ? 1 : 0) - this.runBlend) * (1 - Math.exp(-dt * 9));
      if (!dead && !treating && !rolling && this.oneShot === null && !this.weaponAnim && !this.idleClip && held.visual.aim) {
        this.weaponAim ??= new WeaponAim();
        const r = this.runBlend;
        // The firing arm comes forward to the hip so the gun is carried in front of the body.
        const triggerArm = this.bones.get(`arm_${triggerSide}`)?.node;
        if (r > .001 && triggerArm) { triggerArm.rotation.x += (.75 - triggerArm.rotation.x) * r; triggerArm.rotation.z *= 1 - r * .6; }
        this.weaponAim.pose(held.obj, held.visual.aim, yaw + r * .45, this.aimPitch * (1 - r) - .75 * r);
        // The other hand reaches for the handguard.
        if (r > .05 && held.visual.twoHandGrip && support && supportArm) {
          held.obj.updateWorldMatrix(true, false);
          reachFor(supportArm, support, this.runTarget.copy(held.visual.twoHandGrip.support).applyMatrix4(held.obj.matrixWorld), r);
        }
      }
      if (!dead && !treating && held.visual.melee && this.oneShot && (this.oneShot.startsWith('sword_slash_') || this.oneShot === 'melee_attack')) {
        this.meleeEdge.pose(held.obj, held.visual.melee.held, this.root);
      } else if (held.visual.melee) this.meleeEdge.rest(held.obj, held.visual.melee.held);
      else this.meleeEdge.reset();
    }
    // Idle breathing so a standing character never looks frozen.
    this.breath += dt;
    if (body && !this.cur.clip && !dead) body.node.position.y += Math.sin(this.breath * 2.2) * 0.25 * PX * (1 - 0.5 * (1 - this.fade));
  }

  private applyPose(): void {
    const w = this.fade;
    const rollTransition = (this.prev.clip?.name === 'roll') !== (this.cur.clip?.name === 'roll');
    for (const [name, bone] of this.bones) {
      const hasA = this.sample(this.prev, name, rotA, posA);
      const hasB = this.sample(this.cur, name, rotB, posB);
      const node = bone.node;
      if (!hasA && !hasB) {
        node.position.copy(bone.restPos);
        node.rotation.copy(bone.restRot);
        continue;
      }
      // A completed tumble is 360°, equivalent to 0°. Interpolating the raw Euler values
      // would unwind a whole revolution during the transition to standing/walking.
      const rx = rotA[0] + (rollTransition ? wrapAngle((rotB[0] - rotA[0]) * DEG) / DEG : rotB[0] - rotA[0]) * w;
      const ry = rotA[1] + (rollTransition ? wrapAngle((rotB[1] - rotA[1]) * DEG) / DEG : rotB[1] - rotA[1]) * w;
      const rz = rotA[2] + (rollTransition ? wrapAngle((rotB[2] - rotA[2]) * DEG) / DEG : rotB[2] - rotA[2]) * w;
      const px = posA[0] + (posB[0] - posA[0]) * w;
      const py = posA[1] + (posB[1] - posA[1]) * w;
      const pz = posA[2] + (posB[2] - posA[2]) * w;
      // Blockbench animation conventions: X/Y rotation and X translation are mirrored.
      node.rotation.set(bone.restRot.x - rx * DEG, bone.restRot.y - ry * DEG, bone.restRot.z + rz * DEG, 'ZYX');
      node.position.set(bone.restPos.x - px * PX, bone.restPos.y + py * PX, bone.restPos.z + pz * PX);
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
    if (tracks.position && !(bone === 'root' && NO_ROOT_MOTION.has(clip.name))) sampleTrack(tracks.position, t, pos);
    return true;
  }

  setStance(stance: Stance): void {
    this.stance = stance;
  }

  private randomIdleRate(): number {
    const clip = this.idleClip ? this.template.clips.get(this.idleClip) : undefined;
    if (!clip || !this.idleDurationRange) return 1;
    const [min, max] = this.idleDurationRange;
    return clip.length / (min + Math.random() * (max - min));
  }

  /** Each lobby character can choose a fresh real-time duration on every idle loop. */
  setIdleClip(name: string | null, phase = 0, durationRange?: readonly [number, number]): void {
    this.idleClip = name && this.template.clips.has(name) ? name : null;
    this.idleDurationRange = durationRange ? [Math.max(.1, durationRange[0]), Math.max(.1, durationRange[0], durationRange[1])] : null;
    this.idleRate = this.randomIdleRate();
    const length = this.idleClip ? this.template.clips.get(this.idleClip)!.length : 1;
    this.play(this.idleClip ?? STANCE_CLIPS[this.stance].idle, this.idleRate, ((phase % length) + length) % length);
  }

  /** Shows the given weapon in the right hand (null = empty hands). */
  setWeapon(itemId: string | null, weapons: WeaponLibrary | null, attachments?: Attachments): void {
    // Each attachment combination is its own dressed copy of the gun.
    const key = itemId ? `${itemId}|${attachments?.optic ?? ''}|${attachments?.muzzle ?? ''}` : null;
    if (key === this.weaponKey) return;
    if (this.weaponKey) {
      const old = this.weaponObjects.get(this.weaponKey);
      if (old) {
        old.obj.visible = false;
        this.resetWeaponPose(old.bones);
      }
    }
    this.weaponAnim = null;
    const visual = itemId ? dressWeapon(weapons, itemId, attachments) : undefined;
    this.weaponId = visual ? itemId : null;
    this.weaponKey = visual ? key : null;
    if (!visual || !itemId || !key) return;
    let entry = this.weaponObjects.get(key);
    if (!entry) {
      const hand = this.bones.get('hand_right')?.node;
      if (!hand) return;
      const obj = visual.object.clone(true);
      obj.matrixAutoUpdate = false;
      obj.matrix.copy(visual.attach);
      const bones = new Map<string, Bone & { restScale: Vector3 }>();
      obj.traverse((o) => {
        if (o instanceof Mesh) o.castShadow = true;
        else if (o !== obj) bones.set(o.name, { node: o, restPos: o.position.clone(), restRot: o.rotation.clone(), restScale: o.scale.clone() });
      });
      hand.add(obj);
      entry = { obj, visual, bones };
      this.weaponObjects.set(key, entry);
    }
    entry.obj.visible = true;
  }

  setOffhand(itemId: string | null, weapons: WeaponLibrary | null): void {
    if (itemId === this.offhandId) return;
    this.offhandObject?.removeFromParent(); this.offhandObject = null; this.offhandId = null;
    const visual = itemId ? weapons?.get(itemId) : null;
    const hand = this.bones.get('hand_left')?.node;
    if (!visual?.offhandAttach || !hand) return;
    const obj = visual.object.clone(true);
    obj.name = 'offhand-item'; obj.matrixAutoUpdate = false; obj.matrix.copy(visual.offhandAttach);
    obj.traverse(o => { if (o instanceof Mesh) o.castShadow = false; });
    hand.add(obj); this.offhandObject = obj; this.offhandId = itemId; this.offhandBase = visual.offhandAttach.clone();
  }

  /** Points held gear (the flashlight) where this character looks. */
  aimOffhand(look: Vector3): void {
    const base = this.offhandId ? this.offhandBase : null;
    if (base) aimOffhandLight(this.offhandObject, base, look);
  }

  offhandLightPose(origin: Vector3, direction: Vector3): boolean {
    return offhandLightPose(this.offhandObject, origin, direction);
  }

  /**
   * Stows weapons diagonally on the back, with their tip pointing down. Crossbows hang
   * from the right hip instead, with the stock at belt height.
   */
  setBackWeapon(itemId: string | null, weapons: WeaponLibrary | null): void {
    if (itemId === this.backId) return;
    this.backId = itemId;
    if (this.backObj) {
      this.backObj.removeFromParent();
      this.backObj = null;
    }
    const display = itemId ? weapons?.get(itemId)?.display : undefined;
    const atHip = itemId === 'crossbow';
    const anchor = (atHip ? undefined : this.bones.get('back_attach')?.node) ?? this.bones.get('body')?.node;
    if (!display || !anchor) return;
    const inner = display.clone(true);
    const box = new Box3().setFromObject(inner);
    const centre = box.getCenter(new Vector3());
    const depth = box.max.z - box.min.z;
    inner.position.sub(centre);
    inner.traverse((o) => {
      if (o instanceof Mesh) o.castShadow = true;
    });
    const sling = new Group();
    sling.name = 'stowed-weapon';
    sling.add(inner);
    sling.scale.setScalar(BACK_SCALE);
    // Display models point along +X. Character right is −X, and the back is +Z.
    if (atHip) {
      sling.rotation.set(0, 0, -Math.PI / 2);
      const bounds = new Box3().setFromObject(sling);
      // Keep the entire model outside the torso, with its upper end at the belt.
      sling.position.set(-4 * PX - 0.06 - bounds.max.x, -6 * PX - bounds.max.y, 0.03);
    } else {
      sling.rotation.set(0, 0, -Math.PI / 2 + 0.75);
      sling.position.set(0, 0, (depth * BACK_SCALE) / 2 + 0.03);
    }
    anchor.add(sling);
    this.backObj = sling;
  }

  /** Plays the held weapon's own clip (e.g. reload), stretched to `seconds`. */
  playWeaponAnim(name: string, seconds: number): void {
    const entry = this.weaponKey ? this.weaponObjects.get(this.weaponKey) : undefined;
    const clip = entry?.visual.clips.get(name);
    if (!clip) return;
    this.weaponAnim = { clip, time: 0, rate: clip.length / Math.max(0.05, seconds) };
  }

  /** World position of the held weapon's muzzle / ejection port (false if none). */
  weaponPoint(kind: 'muzzle' | 'eject', out: Vector3): boolean {
    const entry = this.weaponKey ? this.weaponObjects.get(this.weaponKey) : undefined;
    const p = entry?.visual[kind];
    if (!entry || !p) return false;
    entry.obj.updateWorldMatrix(true, false);
    out.copy(p).applyMatrix4(entry.obj.matrixWorld);
    return true;
  }

  private resetWeaponPose(bones: Map<string, Bone & { restScale: Vector3 }>): void {
    for (const b of bones.values()) {
      b.node.position.copy(b.restPos);
      b.node.rotation.copy(b.restRot);
      b.node.scale.copy(b.restScale);
    }
  }

  private updateWeaponAnim(dt: number): void {
    const anim = this.weaponAnim;
    const entry = this.weaponKey ? this.weaponObjects.get(this.weaponKey) : undefined;
    if (!anim || !entry) return;
    anim.time += dt * anim.rate;
    if (anim.time >= anim.clip.length) {
      this.weaponAnim = null;
      this.resetWeaponPose(entry.bones);
      return;
    }
    for (const [name, b] of entry.bones) {
      const tracks = anim.clip.bones.get(name);
      if (!tracks) continue;
      rotA[0] = rotA[1] = rotA[2] = 0;
      posA[0] = posA[1] = posA[2] = 0;
      if (tracks.rotation) sampleTrack(tracks.rotation, anim.time, rotA);
      if (tracks.position) sampleTrack(tracks.position, anim.time, posA);
      b.node.rotation.set(b.restRot.x - rotA[0] * DEG, b.restRot.y - rotA[1] * DEG, b.restRot.z + rotA[2] * DEG, 'ZYX');
      b.node.position.set(b.restPos.x - posA[0] * PX, b.restPos.y + posA[1] * PX, b.restPos.z + posA[2] * PX);
      if (tracks.scale) {
        sampleTrack(tracks.scale, anim.time, rotB);
        b.node.scale.set(b.restScale.x * rotB[0], b.restScale.y * rotB[1], b.restScale.z * rotB[2]);
      }
    }
  }

  setVisible(v: boolean): void {
    this.root.visible = v;
  }

  addTo(scene: Scene): void {
    scene.add(this.root);
  }

  dispose(scene: Scene): void {
    scene.remove(this.root);
    if (this.label) {
      this.label.material.map?.dispose();
      this.label.material.dispose();
    }
  }
}

const reachShoulder = new Vector3(), reachHand = new Vector3(), reachFrom = new Vector3(), reachTo = new Vector3();
const reachTurn = new Quaternion(), reachWorld = new Quaternion(), reachParent = new Quaternion();
/** Swings an arm about its shoulder so its hand points at `target` (blended by `weight`). */
function reachFor(arm: Object3D, hand: Object3D, target: Vector3, weight: number): void {
  arm.updateWorldMatrix(true, true);
  arm.getWorldPosition(reachShoulder);
  hand.getWorldPosition(reachHand);
  reachFrom.subVectors(reachHand, reachShoulder).normalize();
  reachTo.subVectors(target, reachShoulder).normalize();
  reachTurn.setFromUnitVectors(reachFrom, reachTo);
  reachTurn.slerp(reachWorld.identity(), 1 - weight);
  arm.getWorldQuaternion(reachWorld);
  arm.parent!.getWorldQuaternion(reachParent).invert();
  arm.quaternion.copy(reachParent.multiply(reachTurn.multiply(reachWorld)));
  arm.updateWorldMatrix(false, true);
}
