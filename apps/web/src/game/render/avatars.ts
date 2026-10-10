import { Ragdoll } from './ragdoll';
import { Box3, CanvasTexture, Group, LinearFilter, Mesh, Sprite, SpriteMaterial, Vector3, type Euler, type Object3D, type Scene } from 'three';
import { EntityFlags } from '@zion/shared';
import type { Stance } from '../inventory/items';
import type { WeaponLibrary, WeaponVisual } from './weapons';
import { BB_UNITS_PER_METER, sampleTrack, type CharacterClip, type CharacterTemplate } from './character-model';
import { armorPieces } from './armor-models';

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

export function labelSprite(text: string): Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 48;
  const ctx = canvas.getContext('2d')!;
  ctx.font = '600 26px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  const w = Math.min(250, ctx.measureText(text).width + 20);
  ctx.fillRect(128 - w / 2, 6, w, 36);
  ctx.fillStyle = '#f0e9d8';
  ctx.fillText(text, 128, 25);
  const tex = new CanvasTexture(canvas);
  tex.minFilter = LinearFilter;
  const sprite = new Sprite(new SpriteMaterial({ map: tex, depthTest: true, transparent: true }));
  sprite.scale.set(1.6, 0.3, 1);
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
export class Avatar {
  /** Animals: the body always faces the yaw (no head-then-body turning). */
  rigid = false;
  readonly root = new Group();
  private readonly model: Group;
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
  private weaponId: string | null = null;
  private oneShot: string | null = null;
  private recoil = 0;
  private aimPitch = 0;
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
  /** Weapon slung across the back (main-slot gun not in hand). */
  private backId: string | null = null;
  private backObj: Object3D | null = null;

  constructor(
    private readonly template: CharacterTemplate,
    isLocal: boolean,
  ) {
    this.model = template.root.clone(true);
    this.model.traverse((o) => {
      if (o instanceof Mesh) {
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

  setName(name: string): void {
    if (name === this.labelText) return;
    this.labelText = name;
    if (this.label) {
      this.root.remove(this.label);
      this.label.material.map?.dispose();
      this.label.material.dispose();
    }
    this.label = labelSprite(name);
    this.root.add(this.label);
  }

  /** Plays a clip to the end, ignoring locomotion until it finishes (throws, punches). */
  playOnce(name: string): void {
    if (!this.template.clips.has(name)) return;
    this.cur = { clip: null, time: 0, rate: 1 };
    this.play(name, 1, 0, 0.4);
    this.oneShot = name;
  }

  /** Blade swing: cycles through the three sword-slash poses; returns the variant played. */
  slash(): number {
    const v = this.slashCount++ % SLASH_CLIPS.length;
    this.slashVariant = v;
    if (this.template.clips.has(SLASH_CLIPS[v]!)) this.playOnce(SLASH_CLIPS[v]!);
    else this.playOnce('melee_attack');
    return v;
  }

  setAimPitch(pitch: number): void {
    this.aimPitch += (pitch - this.aimPitch) * 0.35;
  }

  /** Weapon kick: muzzle climb that decays over a few frames. */
  kick(amount: number): void {
    this.recoil = Math.min(0.5, this.recoil + amount);
  }

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
    const dead = (flags & EntityFlags.Dead) !== 0;
    const swimming = (flags & EntityFlags.Swimming) !== 0;
    const grounded = (flags & EntityFlags.Grounded) !== 0;
    const attacking = (flags & EntityFlags.Attacking) !== 0;
    this.airborne = grounded || swimming ? 0 : this.airborne + dt;

    const attackStart = attacking && !this.wasAttacking;
    this.wasAttacking = attacking;
    if (dead) return this.play(null);
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
    if (attackStart && !busy && (!this.weaponId || this.weaponId === 'grenade')) {
      this.playOnce(this.weaponId === 'grenade' ? 'grenade_throw' : 'melee_attack');
      return;
    }
    if (busy) return;
    if (this.healing && !swimming) return this.play('bandage_wrap', 1, 0, 0.3);
    if ((flags & EntityFlags.Climbing) !== 0) {
      // Rungs at the climbing pace; frozen while hanging still.
      return this.play(this.template.clips.has('climb_ladder') ? 'climb_ladder' : 'walk', Math.abs(vy) > 0.3 ? Math.min(1.6, Math.abs(vy) / 2.2) : 0, 0, 0.25);
    }
    // Rising off the ground = a jump: react on the very first frame, not after a delay.
    if (!grounded && !swimming && (vy > 1 || this.airborne > 0.15)) return this.play('jump', 1, JUMP_START, 0.5);
    if (swimming) return this.play(this.template.clips.has('swim') ? 'swim' : 'walk', speed > 0.3 ? 1 : 0.6, 0, 0.3);
    if (speed > 0.3) {
      const running = (flags & EntityFlags.Sprinting) !== 0 || speed > 5;
      // Armed characters keep the weapon up while running.
      if (running && this.weaponId) return this.play(STANCE_CLIPS[this.stance].walk, Math.min(2.2, speed / 3));
      if (running) return this.play('run', Math.min(1.6, Math.max(0.7, speed / 6.2)));
      return this.play(STANCE_CLIPS[this.stance].walk, Math.min(1.8, Math.max(0.6, speed / 3.2)));
    }
    this.play(STANCE_CLIPS[this.stance].idle);
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
  /** Ground height lookup for ragdolls (set by the engine). */
  ground: ((x: number, z: number) => number) | null = null;

  startRagdoll(kx: number, kz: number, force: number, ground: (x: number, z: number) => number): void {
    if (this.ragdoll) return;
    this.model.rotation.set(0, 0, 0);
    this.model.position.set(0, 0, 0);
    this.ragdoll = Ragdoll.start(this.model, (n) => this.bones.get(n)?.node, PX, ground, kx, kz, force);
  }

  update(x: number, y: number, z: number, yaw: number, flags: number, dt: number, _elapsed: number): void {
    // Down (bleeding out) or dead: limp. Starts here too when no hit started it (bites…).
    const limp = (flags & (EntityFlags.Dead | EntityFlags.Downed)) !== 0;
    if (limp && !this.ragdoll && this.ground) this.startRagdoll(0, 1, 1, this.ground);
    if (this.ragdoll) {
      const dead = limp;
      // A stagger turns into the death ragdoll if the hit was fatal.
      if (dead) this.ragdollTemp = false;
      if (dead || (this.ragdollTemp && this.ragdoll.time < 0.85)) {
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
    this.choose(speed, vy, flags, dt);
    const rolling = this.cur.clip?.name === 'roll';
    if (rolling && !wasRolling) this.rollYaw = yaw;
    if (this.bodyYaw !== this.bodyYaw || this.rigid) this.bodyYaw = yaw;
    if ((flags & EntityFlags.Climbing) !== 0) {
      // On a ladder: keep facing the rungs.
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
      const turn = diff > MAX_HEAD_YAW ? diff - MAX_HEAD_YAW : diff < -MAX_HEAD_YAW ? diff + MAX_HEAD_YAW : 0;
      // Turning back toward the aim after a sideways/backward roll must not snap the body.
      const maxTurn = this.recoveringFromRoll ? 8 * dt : Infinity;
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
      if ((flags & EntityFlags.Rolling) !== 0 && speed > 1) this.rollYaw = Math.atan2(-dx, -dz);
      this.root.rotation.y = this.rollYaw;
      this.bodyYaw = this.rollYaw;
      this.headYaw = 0;
    } else {
      this.rollYaw = this.bodyYaw;
    }

    for (const l of [this.cur, this.prev]) l.time += dt * l.rate;
    this.updateWeaponAnim(dt);
    this.fade = Math.min(1, this.fade + dt / FADE_SEC);
    this.applyPose();
    const head = this.bones.get('head');
    const body = this.bones.get('body');
    // Raise/lower the arms (and the gun with them) to the aim elevation.
    const held = this.weaponId ? this.weaponObjects.get(this.weaponId) : undefined;
    if (held) held.obj.visible = !this.healing;
    if (!rolling && this.weaponId && this.weaponId !== 'grenade' && this.oneShot === null && !this.healing) {
      for (const arm of ['arm_right', 'arm_left']) {
        const b = this.bones.get(arm);
        if (b) b.node.rotation.x += this.aimPitch;
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

    const dead = (flags & EntityFlags.Dead) !== 0;
    this.model.rotation.x = dead ? -Math.PI / 2 : 0;
    // ...and the character is shoved back a few centimetres (model faces −Z, so back is +Z).
    this.model.position.z = dead ? 0 : this.recoil * 0.12;
    this.model.position.y = dead ? 0.2 : (flags & EntityFlags.Swimming) !== 0 ? -0.1 : 0;
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

  /** Shows the given weapon in the right hand (null = empty hands). */
  setWeapon(itemId: string | null, weapons: WeaponLibrary | null): void {
    if (itemId === this.weaponId) return;
    if (this.weaponId) {
      const old = this.weaponObjects.get(this.weaponId);
      if (old) {
        old.obj.visible = false;
        this.resetWeaponPose(old.bones);
      }
    }
    this.weaponAnim = null;
    const visual = itemId ? weapons?.get(itemId) : undefined;
    this.weaponId = visual ? itemId : null;
    if (!visual || !itemId) return;
    let entry = this.weaponObjects.get(itemId);
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
      this.weaponObjects.set(itemId, entry);
    }
    entry.obj.visible = true;
  }

  /**
   * Slings a weapon diagonally across the back (muzzle up over the left shoulder), or removes
   * it. Uses the real-size display model, centred on the back attachment point.
   */
  setBackWeapon(itemId: string | null, weapons: WeaponLibrary | null): void {
    if (itemId === this.backId) return;
    this.backId = itemId;
    if (this.backObj) {
      this.backObj.removeFromParent();
      this.backObj = null;
    }
    const display = itemId ? weapons?.get(itemId)?.display : undefined;
    const anchor = this.bones.get('back_attach')?.node ?? this.bones.get('body')?.node;
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
    sling.add(inner);
    sling.scale.setScalar(BACK_SCALE);
    // Character faces −Z: the back is +Z. Muzzle (+X) tilted up towards the left shoulder.
    sling.rotation.set(0, 0, Math.PI / 2 + 0.75);
    sling.position.set(0, 0, (depth * BACK_SCALE) / 2 + 0.03);
    anchor.add(sling);
    this.backObj = sling;
  }

  /** Plays the held weapon's own clip (e.g. reload), stretched to `seconds`. */
  playWeaponAnim(name: string, seconds: number): void {
    const entry = this.weaponId ? this.weaponObjects.get(this.weaponId) : undefined;
    const clip = entry?.visual.clips.get(name);
    if (!clip) return;
    this.weaponAnim = { clip, time: 0, rate: clip.length / Math.max(0.05, seconds) };
  }

  /** World position of the held weapon's muzzle / ejection port (false if none). */
  weaponPoint(kind: 'muzzle' | 'eject', out: Vector3): boolean {
    const entry = this.weaponId ? this.weaponObjects.get(this.weaponId) : undefined;
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
    const entry = this.weaponId ? this.weaponObjects.get(this.weaponId) : undefined;
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
