import { Ragdoll } from './ragdoll';
import { SkinnedRagdoll } from './skinned-ragdoll';
import { type Bone as Bone3, Box3, BoxGeometry, BufferAttribute, MeshLambertMaterial, CanvasTexture, Color, type Material, Group, LinearFilter, Mesh, Sprite, SpriteMaterial, Vector3, Quaternion, Matrix4, Euler, type Camera, type Object3D, type Scene } from 'three';
import { BLADE_COMBO, BLADE_COMBO_WEAPONS, LONG_LUNGE_CLIP, meleeSwing, EntityFlags, type CarriedGear, ITEMS, RANKS, TICK_DT, WEAPON_BY_ITEM, appearanceHeight, bladeStepTiming, nextBladeStep, weaponSpec, type Appearance, type Attachments, type RankTitle } from '@zion/shared';
import { DEFAULT_CHARACTER } from '@zion/physics';
import type { Stance } from '../inventory/items';
import { dressWeapon, type WeaponLibrary, type WeaponVisual } from './weapons';
import { BB_UNITS_PER_METER, sampleTrack, type CharacterClip, type CharacterTemplate } from './character-model';
import { armorBone, coversHair, fitArmor, skinArmor, type ArmorPiece } from './armor-models';
import { adjustFor, adjustMatrix, applyDrags, dragsFor, onGearFit, softFor } from '../gear-fit';
import { softShape, SoftTail } from './soft-tail';
import { RifleGrip } from './rifle-grip';
import { rifleReloadLayer, usesRifleReload } from './recorded-reload';
import { WeaponAim } from './weapon-aim';
import { MeleeEdge } from './melee-edge';
import { aimOffhandLight, offhandLightPose } from './offhand-light';
import { rifleStockContact } from './grip-profile';
import { BackpackInstance } from './backpack-model';
import { HumanBody, STAND_CLIP, armorAnchors, SURVIVOR_SIZE, type RifleFit, type HumanAssets, type Mocap, type MocapPose, type MocapLayer, type DriverRig, type Grasp, type HandPreset, type Side } from './human-rig';
import { PostureMotion, type Posture } from './posture-motion';
import { ReloadMagazine } from './reload-magazine';
import { MixamoSkin } from './mixamo-body';
import { locomotionClip, locomotionGait, type Gait } from './locomotion';

const DEG = Math.PI / 180;
const PX = 1 / BB_UNITS_PER_METER;
const FADE_SEC = 0.18;
/** Clips whose root translation would fight the physics-driven position. */
const NO_ROOT_MOTION = new Set(['jump']);
/** The jump clip opens with a crouch; physics has already left the ground, so skip it. */
const JUMP_START = 0.15;
/** How much faster than recorded a jump may run to catch up with the body (take-off, landing). */
const JUMP_CATCH_UP = 3;
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

let speakerTexture: CanvasTexture | null = null;
/** The speaker shown over a player talking on team voice (one texture for everyone). */
function speakerSprite(): Sprite {
  if (!speakerTexture) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d')!;
    g.fillStyle = 'rgba(0,0,0,.55)'; g.beginPath(); g.arc(32, 32, 30, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ffb000'; g.strokeStyle = '#ffb000'; g.lineWidth = 4; g.lineCap = 'round';
    g.beginPath(); g.moveTo(14, 25); g.lineTo(22, 25); g.lineTo(32, 16); g.lineTo(32, 48); g.lineTo(22, 39); g.lineTo(14, 39); g.closePath(); g.fill();
    g.beginPath(); g.arc(34, 32, 9, -.8, .8); g.stroke();
    g.beginPath(); g.arc(34, 32, 17, -.8, .8); g.stroke();
    speakerTexture = new CanvasTexture(c); speakerTexture.minFilter = LinearFilter;
  }
  const s = new Sprite(new SpriteMaterial({ map: speakerTexture, depthTest: false, transparent: true }));
  s.scale.set(.32, .32, 1);
  s.renderOrder = 10;
  return s;
}

/** The character's three sword-slash poses, used in turn. */
/** Neutral standing pose for empty hands and melee weapons (bind pose, arms lowered). */
const NEUTRAL_IDLE = STAND_CLIP;
/** Fraction of a mantle spent reaching and pulling before getting up onto the ledge. */
const MANTLE_PULL = .55;
/** The ledge climbs' recordings, by `Mantle.kind`. */
const MANTLE_CLIP_NAMES = ['hang_to_crouch', 'climb_wall'] as const;
/** Where a ledge climb is in its recording, and where that puts the hips relative to the body's feet (m). */
export interface MantleClipPose { kind: 0 | 1; time: number; hipHeight: number; hipAhead: number }
/** Height one recorded ladder cycle climbs at the survivor's size (m). */
const LADDER_STRIDE = 1.39;
/** How far a sword's handle tilts from across the knuckles towards the forearm's line (rad). */
const SWORD_GRIP_TILT = .7;
/** Standing turn: starts once the view is this far off the body, ends this close (rad). */
const TURN_START = 30 * DEG;
const TURN_STOP = 8 * DEG;
const PUNCH_CLIPS = ['punch_1', 'punch_2', 'punch_hook'] as const;
const SLASH_CLIPS = ['sword_slash_vertical', 'sword_slash_horizontal', 'sword_slash_diagonal'] as const;
/** Slung weapons are drawn a bit larger than real size, like held ones (stylised character). */
const BACK_SCALE = 1.3;
/** Size held guns are drawn at on the block characters (the survivor holds them at real size). */
const BLOCK_GUN_SCALE = 1.5;
/** Hip joint height of the block character, which vehicle seats are placed for. */
const BLOCK_HIP = .675;
/** The rig hand's grip point (`HAND_GRIP` in weapons.ts): where a fist closes. */
const HAND_GRIP = new Vector3(0, 2 / BB_UNITS_PER_METER, -0.2 / BB_UNITS_PER_METER);
/** How long the knees give after a landing (s). */
const LAND_SEC = .34;
/** Ladder rung spacing (m): hands close on rungs at these heights. */
const RUNG = .3;
/** Farthest the survivor's support hand reaches from its shoulder to a handguard (m). */
const SUPPORT_REACH = .55 * SURVIVOR_SIZE;
const SIDES = ['L', 'R'] as const;
const X_AXIS = new Vector3(1, 0, 0);
const UP = new Vector3(0, 1, 0);
/** Shots leave once the bore is this close to the aim (radians). */
const GUN_READY_ANGLE = .07;
/** Furthest the arms carry a gun round from the chest (rad); beyond, the body must turn. */
const GUN_YAW_RANGE = .6;
/** Seconds for the upper body to change between recorded holds (ready, aim, low carry). */
const UPPER_FADE = .32;
/** Crossfade when the body changes posing method (s). */
const BRANCH_FADE = .18;
/** Either recorded roll (empty-handed, or the dive roll with a weapon). */
const ARMED_ROLL = [.55, 1.75] as const;
/** Survivor bones simulated when it falls limp (the rest follow their parents). */
const RAGDOLL_BONE = /^(spine(_00[1-6])?|pelvis_[LR]|(thigh|shin|upper_arm|forearm)_[LR](_001)?|(foot|toe|shoulder|hand)_[LR])$/;
const isRoll = (clip: string | null | undefined) => clip === 'roll' || clip === 'roll_armed';
/**
 * Pistol (recorded "Drawing Gun" and "Shooting"): the draw plays when one is taken in hand; it ends
 * holding the gun up one-handed (PISTOL_HOLD), the left hand free. Firing without aiming pushes it
 * out one-handed (PISTOL_HIP, the draw's extended frame); aiming brings both hands onto it
 * (Shooting). Each is an upper-body layer, crossfaded like the rifle's.
 */
const PISTOL_DRAWN = 1.7, PISTOL_HOLD = 1.7, PISTOL_HIP = 1.25;
/** Where the Shooting recording's recoil begins (s). */
const PISTOL_RECOIL = .2;
/** The recorded recoil's kick and recovery played within this (s); shots in it do not restart it. */
const PISTOL_RECOIL_SPAN = .3;

/**
 * Critically damped spring towards `target` (D. Holden, "Spring-It-On"): continuous velocity,
 * no overshoot; `halflife` seconds to close half the distance. Returns [value, velocity].
 */
function spring(x: number, v: number, target: number, dt: number, halflife: number): [number, number] {
  const [nx, nv] = springFree(x, v, target, dt, halflife);
  return [Math.min(1, Math.max(0, nx)), nv];
}

/** The same spring without the 0..1 clamp (angles). */
function springFree(x: number, v: number, target: number, dt: number, halflife: number): [number, number] {
  if (dt <= 0) return [x, v];
  const y = (4 * Math.LN2) / (halflife + 1e-5) / 2, j0 = x - target, j1 = v + j0 * y, e = Math.exp(-y * dt);
  return [e * (j0 + j1 * dt) + target, e * (v - j1 * y * dt)];
}

/** Crossfade weights shaped to start and settle with zero speed (smoothstep; two layers still
 * sum to one), so the first frame of a change of clip never jumps. */
function easeWeight(w: number): number {
  const t = Math.min(1, Math.max(0, w));
  return t * t * (3 - 2 * t);
}

/**
 * Playback rate (clip seconds per second) for moving at `speed`: steps follow the ground covered,
 * but never quicker or slower than the recording's natural cadence allows (a walk played three
 * times over reads as frantic pumping; feet may slide a little instead).
 */
function cadence(clip: Mocap, speed: number): number {
  return stepLoops(clip, speed) * clip.duration;
}

/** A walk never steps quicker than this many times its recorded cadence; beyond it the stride carries. */
const WALK_CADENCE_MAX = 1.35;
/** Loops per second for moving at `speed`: distance-matched, except a walk capped at a brisk pace. */
export function stepLoops(clip: Mocap, speed: number): number {
  const loops = speed / Math.max(.3, clip.stride);
  return clip.name.startsWith('walk_') ? Math.min(loops, WALK_CADENCE_MAX / clip.duration) : loops;
}

/**
 * Where a backpack's panel rests (survivor model space, facing +Z): the back's surface behind the
 * shoulder blades, at the top of the shoulders, measured from the body mesh.
 */
function backSurface(assets: HumanAssets): Vector3 {
  const body = assets.parts.get('body')?.geometry, pos = body?.getAttribute('position');
  const shoulder = assets.restP[assets.index.get('upper_arm_L')!]!.y, chest = assets.restP[assets.index.get('spine_003')!]!.y;
  let back = Infinity;
  if (pos) for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (Math.abs(pos.getX(i)) < .06 && y > chest - .05 && y < shoulder) back = Math.min(back, pos.getZ(i));
  }
  return new Vector3(0, shoulder + .04, Number.isFinite(back) ? back - .006 : -.12);
}

function smooth(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Landing: the knees give quickly, then the body rises again. `u`: 0..1 since touching down. */
type AvatarMocap = MocapPose;

/** Take-off, top, landing and end of a recorded jump, from its hip height (cached per clip). */
const jumpCache = new WeakMap<Mocap, { takeoff: number; apex: number; touch: number; land: number; end: number }>();
function jumpPhases(clip: Mocap): { takeoff: number; apex: number; touch: number; land: number; end: number } {
  let p = jumpCache.get(clip);
  if (p) return p;
  const y = clip.hipsY, n = y.length, at = (i: number) => (i / Math.max(1, n - 1)) * clip.duration;
  let apex = 0;
  for (let i = 1; i < n; i++) if (y[i]! > y[apex]!) apex = i;
  let crouch = 0, land = apex;
  for (let i = 0; i < apex; i++) if (y[i]! < y[crouch]!) crouch = i;
  for (let i = apex; i < n; i++) if (y[i]! < y[land]!) land = i;
  let takeoff = crouch;
  while (takeoff < apex && y[takeoff]! < 0) takeoff++;
  // Touch-down: the recorded hips back at standing height after the apex (the feet meet the
  // ground; the landing crouch follows).
  let touch = apex;
  while (touch < land && y[touch]! > 0) touch++;
  p = { takeoff: at(takeoff), apex: at(apex), touch: at(touch), land: at(land), end: Math.min(clip.duration, at(land) + .6) };
  jumpCache.set(clip, p);
  return p;
}

function landCurve(u: number): number {
  return u < .22 ? smooth(0, .22, u) : 1 - smooth(.22, 1, u);
}

/** The survivor's model space is turned half round from the character's root (it faces +Z). */
/** A worn piece's meshes: directly under its holder (skinned vests) or under the cloned model. */
function armorMeshes(holder: Object3D): Object3D[] {
  return holder.children.length === 1 && !(holder.children[0] as Mesh).isMesh ? holder.children[0]!.children : holder.children;
}
const MODEL_FRAME = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI);

/** Gear Studio keys of the default shirt, trousers and boots (always worn, not inventory items). */
export const OUTFIT_KEYS = { top: 'outfit:top', legs: 'outfit:legs', feet: 'outfit:feet' } as const;

/**
 * The Studio's position / turn / size for the default trousers and boots, applied to their shared
 * bind-pose geometry (every survivor wears the same), from the shipped shape each time.
 */
function fitOutfit(assets: HumanAssets): void {
  for (const [slot, key] of Object.entries(OUTFIT_KEYS)) {
    const geometry = assets.parts.get(slot)?.geometry;
    if (!geometry) continue;
    const a = adjustFor(key), sig = JSON.stringify(a ?? null);
    if (geometry.userData.outfitFit === sig) continue;
    geometry.userData.outfitFit = sig;
    const pos = geometry.getAttribute('position');
    const base = (geometry.userData.shippedPositions ??= Float32Array.from(pos.array as Float32Array)) as Float32Array;
    const centre = new Box3().setFromBufferAttribute(new BufferAttribute(base, 3)).getCenter(new Vector3());
    const m = adjustMatrix(a, centre, MODEL_FRAME), v = new Vector3();
    for (let i = 0; i < pos.count; i++) { v.fromArray(base, i * 3).applyMatrix4(m); pos.setXYZ(i, v.x, v.y, v.z); }
    pos.needsUpdate = true;
    geometry.computeBoundingSphere();
  }
}

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
    this.drivingActive = true; this.root.rotation.set(pitch,yaw,roll,'YXZ'); this.bodyYaw = yaw; this.poseDirty = true;
    // Clear locomotion/root animation before applying the seat pose: seat offsets refer to
    // the unshifted skeleton's feet, whose hip pivot is 0.675 m above its origin.
    for(const bone of this.bones.values()){bone.node.position.copy(bone.restPos);bone.node.rotation.copy(bone.restRot);}
    this.model.position.set(0,0,0);this.model.rotation.set(0,0,0);
    // The survivor's hip joints sit higher than the block character's the seats were made for.
    const legRest = this.bones.get('leg_left')?.restPos.y;
    if (this.human && legRest !== undefined) this.model.position.y = BLOCK_HIP - legRest * this.model.scale.y;
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
  /** Eye/shoulder cameras keep forward locomotion square to their heading. */
  viewAligned = false;
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
  private lastX = Number.NaN;
  private gait: Gait = 'idle';
  private motionSpeed = 0;
  private stepPhase = 0;
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
  private readonly weaponObjects = new Map<string, { obj: Object3D; visual: WeaponVisual; attach: Matrix4; bones: Map<string, Bone & { restScale: Vector3 }> }>();
  private weaponAnim: { clip: CharacterClip; time: number; rate: number } | null = null;
  private airborne = 0;
  private wasAttacking = false;
  private breath = 0;
  private slashCount = 0;
  /** A recorded move played on the body (a blade combo step, a punch): a span of a clip. */
  private recAction: { clip: string; from: number; to: number; rate: number; t: number; lunge: boolean } | null = null;
  private bladeStep = -1;
  private bladeReadyAt = 0;
  private punchCount = 0;
  private readonly restWorld = new Map<string, Vector3>();
  private readonly armor = new Map<string, Object3D[]>();
  /** Worn armour pieces by slot (kept to re-dress when the Studio's fitting changes). */
  private readonly armorPieces = new Map<string, ArmorPiece>();
  /** Painted soft parts of worn armour: each swings in its mesh's frame. */
  private readonly armorTails = new Map<string, Array<{ tail: SoftTail; frame: Object3D }>>();
  /** Carry hooks as built (rest), and their frame relative to the character's root. */
  private readonly hookRest = new Map<string, { p: Vector3; q: Quaternion; frame: Quaternion }>();
  private readonly stopFit: () => void;
  /** Variant of the latest blade swing (0 vertical, 1 horizontal, 2 diagonal), for its trail. */
  slashVariant = 0;
  /** Applying a first aid kit: loops the bandage animation with the weapon put away. */
  healing = false;
  /** Stowed weapon on the back or hip. */
  /** Named body sockets (móc đeo), shared by equipped and temporarily stowed gear. */
  private readonly carryHooks = new Map<string, Group>();
  private interactionWeapon: Object3D | null = null;
  private interactionWeaponKey: string | null = null;

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
    this.human?.setTint(on);
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

  /** The skinned survivor following the rig (player characters), and the rig as it sees it. */
  private readonly human: HumanBody | null = null;
  /** The survivor's skin on the Mixamo skeleton (Studio switch), posed after the survivor's own. */
  private readonly mixamo: MixamoSkin | null = null;
  private readonly rig: DriverRig | null = null;
  /** The rig moved since the survivor was last posed (posed lazily, just before rendering). */
  private poseDirty = false;
  private readonly frame = { flags: 0, speed: 0, vy: 0, dt: 0, dx: 0, dz: 0 };
  /** The recorded clip mixed over the survivor (running, sprinting with a gun, aiming on the move, jumping). */
  private mocap: AvatarMocap | null = null;
  /** Lobby: a recorded idle instead of the rig's idle clip. */
  private mocapIdle: string | null = null;
  private airTime = 0;
  /** Seconds left of the knees giving after a landing. */
  private landT = 0;
  private plantBlend = 1;
  private reloadAnim: { t: number; dur: number } | null = null;
  private mantleGrip: { left: Vector3; right: Vector3 } | null = null;
  private readonly rungs: Record<Side, Vector3 | null> = { L: null, R: null };

  constructor(
    private readonly template: CharacterTemplate,
    isLocal: boolean,
    options: { body?: boolean } = {},
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
    const torso = this.bones.get('body');
    if (torso) {
      for (const [name, x, y, z] of [
        ['back_right', .13, .25, .16], ['back_left', -.13, .25, .16], ['back_center', 0, .33, .13],
        ['hip_right', .24, -.18, .03], ['hip_left', -.24, -.18, .03],
        ['chest', 0, .16, -.17],
      ] as const) {
        const hook = new Group();
        hook.name = `carry-hook-${name}`;
        hook.userData.label = 'Móc đeo';
        hook.position.set(x, y, z).multiplyScalar(template.human ? SURVIVOR_SIZE : 1);
        torso.node.add(hook);
        this.carryHooks.set(name, hook);
      }
    }
    if (template.human && options.body !== false) {
      const human = new HumanBody(template.human, { shadows: true, receiveShadows: !isLocal });
      this.model.add(human.group);
      this.human = human;
      if (template.mixamo) this.mixamo = new MixamoSkin(human, template.mixamo);
      // Bind hooks to the survivor's actual chest/pelvis, including recorded trunk motion.
      // Preserve the fitted model-space pose while changing from the driver to the skin bones.
      this.model.updateWorldMatrix(true, true);
      for (const [name, hook] of this.carryHooks) {
        const joint = human.group.getObjectByName(name.startsWith('hip_') ? 'spine' : 'spine_003');
        if (joint) joint.attach(hook);
      }
      // The pack hangs from the survivor's real back: its surface behind the shoulder blades.
      const packHook = this.carryHooks.get('back_center'), chest = human.group.getObjectByName('spine_003');
      if (packHook && chest) {
        human.group.updateMatrixWorld(true);
        packHook.position.copy(chest.worldToLocal(human.group.localToWorld(backSurface(template.human))));
      }
      this.recordHooks();
      const bone = (n: string) => this.bones.get(n)!.node;
      this.rig = {
        model: this.model, root: bone('root'), body: bone('body'), head: bone('head'),
        armL: bone('arm_left'), armR: bone('arm_right'), handL: bone('hand_left'), handR: bone('hand_right'),
        legL: bone('leg_left'), legR: bone('leg_right'), bodyRest: this.bones.get('body')!.restPos.clone(), handGrip: HAND_GRIP,
        rootRest: bone('root').matrix.clone(),
      };
      // Posed once per rendered frame, after every gameplay pose (mantle, plan, seats…) is in.
      const update = this.root.updateMatrixWorld.bind(this.root);
      this.root.updateMatrixWorld = (force?: boolean) => {
        update(force);
        if (this.poseDirty && !this.humanRagdoll) {
          // Far: posed every third frame (the time in between carried over), still moving with its root.
          if (this.detail === 2 && ++this.lodFrame % 3 !== 0) { this.lodDt += this.frame.dt; return; }
          this.frame.dt += this.lodDt; this.lodDt = 0;
          this.poseDirty = false;
          // Hidden actors still advance their inexpensive clip clocks. Returning to third
          // person or revealing a remote player must not resume a stale foot/upper-body pose.
          if (!this.root.visible) { this.stepRecordedMotion(); return; }
          this.finishPose();
          this.smoothBranchSwitch();
          // The pack swings from the posed shoulders (and its strap ends from the pack).
          const hook = this.carryHooks.get('back_center');
          if (this.backpack && hook) this.backpack.update(hook, this.frame.dt);
          for (const list of this.armorTails.values()) for (const { tail, frame } of list) tail.update(frame, this.frame.dt);
          this.poseMixamo();
          this.human?.updateHair(this.frame.dt, this.mixamo?.head());
        } else if (this.humanRagdoll) { this.poseMixamo(); this.human?.updateHair(this.frame.dt, this.mixamo?.head()); }
      };
    }
    // Rest positions of the bones in model space: armour pieces are placed relative to them.
    this.model.updateMatrixWorld(true);
    for (const [name, b] of this.bones) this.restWorld.set(name, b.node.getWorldPosition(new Vector3()));
    if (!this.hookRest.size) this.recordHooks();
    this.applyHookFit();
    if (this.template.human) fitOutfit(this.template.human);
    // The Studio's fitting changes live: re-dress with it.
    this.stopFit = onGearFit(() => this.refit());
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

  private mantleArms = false;
  /** The recorded ledge climb being followed (survivor bodies). */
  private mantleClip: MantleClipPose | null = null;

  /** The climb's hips in body units, from metres above / ahead of where the body stands. */
  private mantleHips(weight: number): { y: number; z: number; weight: number } {
    const scale = this.human ? this.human.group.getWorldScale(new Vector3()).y : 1, c = this.mantleClip!;
    return { y: c.hipHeight / scale, z: c.hipAhead / scale, weight: Math.min(1, weight) };
  }
  private readonly gripTarget = new Vector3();
  private readonly gripShoulder = new Vector3();
  private readonly gripHand = new Vector3();
  /**
   * Mantling over a ledge (call after update): both hands planted on the edge at `left` / `right`
   * (world points that stay put while the body rises: the arms swing and shorten to keep them
   * there), the chest leaning in, the legs kicking up the wall in turn. `k`: progress 0..1.
   */
  poseMantle(grip: { left: Vector3; right: Vector3 } | null, k: number, clip: MantleClipPose | null = null): void {
    const arms = [['left', grip?.left], ['right', grip?.right]] as const;
    this.mantleGrip = grip;
    this.mantleClip = grip ? clip : null;
    this.mantleK = grip ? k : 0;
    this.poseDirty = true;
    if (!grip) {
      if (this.mantleArms) { for (const [side] of arms) this.bones.get(`arm_${side}`)?.node.scale.set(1, 1, 1); this.mantleArms = false; const held = this.weaponKey ? this.weaponObjects.get(this.weaponKey) : undefined; if (held) held.obj.visible = true; }
      return;
    }
    this.mantleArms = true;
    const held = this.weaponKey ? this.weaponObjects.get(this.weaponKey) : undefined;
    if (held) held.obj.visible = false;
    const body = this.bones.get('body')?.node;
    // Lean in over the edge while pulling, straighten as the hips come over.
    if (body) body.rotation.x -= .35 * Math.sin(Math.min(1, k * 1.3) * Math.PI);
    // Legs: one knee drives up the wall while the other pushes, then they swap; both tuck at the end.
    const kick = Math.sin(k * Math.PI * 2.2);
    const legL = this.bones.get('leg_left')?.node, legR = this.bones.get('leg_right')?.node;
    // (+X swings a leg forward/up, as when sitting: the knee comes up towards the wall.)
    if (legL) legL.rotation.x = .25 + .95 * Math.max(0, kick) + .5 * k;
    if (legR) legR.rotation.x = .25 + .95 * Math.max(0, -kick) + .5 * k;
    this.root.updateWorldMatrix(true, true);
    for (const [side, target] of arms) {
      const arm = this.bones.get(`arm_${side}`)?.node, hand = this.bones.get(`hand_${side}`)?.node;
      if (!arm || !hand || !target) continue;
      arm.scale.set(1, 1, 1);
      arm.updateWorldMatrix(true, true);
      reachFor(arm, hand, this.gripTarget.copy(target), 1);
      // The hand stays exactly on the edge: the arm takes the shoulder-to-edge length (within reason).
      arm.getWorldPosition(this.gripShoulder); hand.getWorldPosition(this.gripHand);
      const rest = this.gripShoulder.distanceTo(this.gripHand), want = this.gripShoulder.distanceTo(target);
      if (rest > .01) arm.scale.y = Math.max(.45, Math.min(1.35, want / rest));
      arm.updateWorldMatrix(false, true);
    }
  }

  private planSheet: Mesh | null = null;
  private planning = false;
  private readonly planTarget = new Vector3();
  /**
   * Holding a blueprint up to place a structure (call after update): both hands in front of the
   * chest gripping a blue drafting sheet; whatever was in hand is put away meanwhile.
   */
  posePlan(on: boolean): void {
    const held = this.weaponKey ? this.weaponObjects.get(this.weaponKey) : undefined;
    this.poseDirty = true;
    if (!on) {
      if (this.planning) { this.planning = false; if (held) held.obj.visible = true; if (this.planSheet) this.planSheet.visible = false; }
      return;
    }
    this.planning = true;
    if (held) held.obj.visible = false;
    if (!this.planSheet) {
      this.planSheet = new Mesh(new BoxGeometry(.5, .34, .012), new MeshLambertMaterial({ color: '#3d82d6', emissive: new Color('#0d2a52') }));
      this.root.add(this.planSheet);
    }
    // In the model's own frame: the sheet held out, tilted up towards the eyes.
    this.planSheet.visible = true;
    this.planSheet.position.set(0, 1.12, -.42);
    this.planSheet.rotation.set(-.55, 0, 0);
    this.root.updateWorldMatrix(true, true);
    for (const side of ['left', 'right'] as const) {
      const arm = this.bones.get(`arm_${side}`)?.node, hand = this.bones.get(`hand_${side}`)?.node;
      if (!arm || !hand) continue;
      this.planTarget.set(side === 'left' ? .24 : -.24, 1.1, -.4);
      this.root.localToWorld(this.planTarget);
      reachFor(arm, hand, this.planTarget, 1);
      arm.updateWorldMatrix(false, true);
    }
  }

  /** Puts on (or takes off, null) the armour piece for a slot, fitted to this survivor's head or chest. */
  setArmor(slot: string, piece: ArmorPiece | null): void {
    for (const o of this.armor.get(slot) ?? []) o.removeFromParent();
    this.armor.delete(slot);
    this.armorTails.delete(slot);
    if (piece) this.armorPieces.set(slot, piece); else this.armorPieces.delete(slot);
    const human = this.human, assets = this.template.human;
    // Worn trousers / boots replace the default ones; other pieces only those they say they replace
    // (most armour is simply worn over the shirt).
    const replaced = (part: 'top' | 'legs' | 'feet') => this.armorPieces.has(part) || [...this.armorPieces.values()].some((p) => p.spec.replaces?.includes(part));
    for (const part of ['top', 'legs', 'feet'] as const) human?.setOutfitCovered(part, replaced(part));
    human?.setHairCovered([...this.armor.values()].some((objs) => objs.some((o) => o.userData.coversHair)));
    if (!piece || !human || !assets) return;
    // The automatic fit, then the Studio's hand adjustment (offset, turn, size about the piece's centre).
    const auto = fitArmor(piece, armorAnchors(assets));
    const centre = new Box3().setFromObject(piece.object).applyMatrix4(auto).getCenter(new Vector3());
    const fit = adjustMatrix(adjustFor(piece.spec.item), centre, MODEL_FRAME).multiply(auto);
    let holder: Object3D;
    if (piece.spec.slot === 'chest') {
      // Vests are skinned to the body: shoulder pads and sleeves move with the arms.
      holder = skinArmor(piece, fit, assets, human.skeleton);
      human.group.add(holder);
    } else {
      const name = armorBone(piece), bone = human.group.getObjectByName(name), i = assets.index.get(name);
      if (!bone || i === undefined) return;
      // Model space → the bone's bind frame, so the piece follows the head or chest as it moves.
      holder = new Group();
      new Matrix4().multiplyMatrices(assets.inverses[i]!, fit).decompose(holder.position, holder.quaternion, holder.scale);
      holder.add(piece.object.clone());
      bone.add(holder);
    }
    holder.name = `armor-${slot}`;
    holder.userData.coversHair = coversHair(piece);
    holder.userData.gearKey = piece.spec.item;
    this.armor.set(slot, [holder]);
    // Painted soft parts ("Làm mềm" in the Studio): their own geometry and material, bent by a spring.
    const tails: Array<{ tail: SoftTail; frame: Object3D }> = [];
    const meshes = armorMeshes(holder);
    // Hand pulls first (their own geometry), then the soft parts on the pulled shape.
    meshes.forEach((o, i) => {
      const mesh = o as Mesh, drags = dragsFor(piece.spec.item, i);
      if (!mesh.isMesh || !drags.length) return;
      mesh.geometry = mesh.geometry.clone();
      applyDrags(mesh.geometry, drags);
    });
    for (const region of softFor(piece.spec.item)) {
      const mesh = meshes[region.mesh] as Mesh | undefined;
      if (!mesh?.isMesh) continue;
      if (!dragsFor(piece.spec.item, region.mesh).length) mesh.geometry = mesh.geometry.clone();
      const shape = softShape(mesh.geometry, region.vertices);
      if (!shape) continue;
      mesh.material = (Array.isArray(mesh.material) ? mesh.material[0]! : mesh.material).clone();
      const tail = new SoftTail(mesh.geometry, shape, region.stiffness);
      tail.patch(mesh.material as Material);
      tails.push({ tail, frame: mesh });
    }
    if (tails.length) this.armorTails.set(slot, tails);
    human.setHairCovered([...this.armor.values()].some((objs) => objs.some((o) => o.userData.coversHair)));
  }

  /**
   * The meshes of a worn piece by gear key (armour item id or "military_backpack"), in the order
   * painted soft regions index them.
   */
  gearMeshes(key: string): Mesh[] {
    if (key === 'military_backpack') return this.backpack?.mesh ? [this.backpack.mesh] : [];
    for (const objs of this.armor.values()) if (objs[0]?.userData.gearKey === key) return armorMeshes(objs[0]).filter((o): o is Mesh => (o as Mesh).isMesh);
    return [];
  }
  /** A carry hook (the Studio shows and adjusts it). */
  carryHook(name: string): Group | undefined { return this.carryHooks.get(name); }

  /** Rest transforms of the carry hooks and each one's frame relative to the root. */
  private recordHooks(): void {
    this.root.updateMatrixWorld(true);
    const rootQ = this.root.getWorldQuaternion(new Quaternion()).invert();
    for (const [name, hook] of this.carryHooks) {
      const parentQ = hook.parent ? hook.parent.getWorldQuaternion(new Quaternion()) : new Quaternion();
      this.hookRest.set(name, { p: hook.position.clone(), q: hook.quaternion.clone(), frame: rootQ.clone().multiply(parentQ) });
    }
  }

  /**
   * An anchor's turn in the character's frame as at rest: its carry hook's rest frame, then the
   * fixed chain from that hook down to it (backpack mounts). Never the animated pose, so a place
   * set in the Studio stays put whatever the body is doing (running, aiming) when guns are hung.
   */
  private restFrame(anchor: Object3D): Quaternion {
    const hooks = new Set<Object3D>(this.carryHooks.values());
    let hook: Object3D | null = anchor;
    while (hook && !hooks.has(hook)) hook = hook.parent;
    const name = hook ? [...this.carryHooks].find(([, h]) => h === hook)?.[0] : undefined;
    const rest = name ? this.hookRest.get(name) : undefined;
    if (!hook || !rest) {
      this.root.updateMatrixWorld(true);
      return this.root.getWorldQuaternion(new Quaternion()).invert().multiply(anchor.getWorldQuaternion(new Quaternion()));
    }
    hook.updateWorldMatrix(true, true);
    const below = hook.getWorldQuaternion(new Quaternion()).invert().multiply(anchor.getWorldQuaternion(new Quaternion()));
    return rest.frame.clone().multiply(hook.quaternion).multiply(below);
  }

  /** The Studio's adjustments of the carry hooks (and so everything hung on them). */
  private applyHookFit(): void {
    for (const [name, hook] of this.carryHooks) {
      const rest = this.hookRest.get(name), a = adjustFor(`hook:${name}`);
      if (!rest) continue;
      const m = adjustMatrix(a, rest.p, rest.frame).multiply(new Matrix4().compose(rest.p, rest.q, new Vector3(1, 1, 1)));
      m.decompose(hook.position, hook.quaternion, hook.scale);
    }
  }

  /** Re-dresses with the current fitting: hooks, armour, backpack and what hangs on them. */
  refit(): void {
    this.applyHookFit();
    if (this.template.human) fitOutfit(this.template.human);
    for (const [slot, piece] of [...this.armorPieces]) this.setArmor(slot, piece);
    if (this.backpack) { this.backpack.dispose(); this.backpack = null; }
    this.gearKey = '';
    this.setGear(this.gear, this.gearWeapons);
  }

  /** The survivor's look (hair, outfit, face and body); its height scales the whole character. */
  setAppearance(a: Appearance): void {
    if (!this.human) return;
    this.human.setAppearance(a);
    this.model.scale.setScalar(appearanceHeight(a));
    this.poseDirty = true;
  }

  /** A magazine change: the support hand swaps the magazine and works the action. */
  startReload(seconds: number): void {
    if (this.human) this.reloadAnim = { t: 0, dur: Math.max(.3, seconds) };
  }

  /** A reload cut short (a shot stops a shotgun's shell-by-shell loading). */
  stopReload(): void { this.reloadAnim = null; }

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

  private speaker: Sprite | null = null;
  /** Shows the speaker over the head (team voice), beside the name tag when there is one. */
  setSpeaking(on: boolean): void {
    if (!on) { if (this.speaker) this.speaker.visible = false; return; }
    if (!this.speaker) { this.speaker = speakerSprite(); this.root.add(this.speaker); }
    this.speaker.visible = true;
    this.speaker.position.set(0, (this.label?.position.y ?? 2.15) + (this.label ? .34 : 0), 0);
  }

  /** A hand signal (Warfare orders) and until when it shows. */
  private gestureKind: 'point' | 'wave' | 'halt' | 'salute' | null = null;
  private gestureYaw = 0;
  private gestureStart = 0;
  private gestureUntil = 0;
  /**
   * A hand signal for a moment: point the right arm towards `yaw`, wave it over the head, hold the
   * palm up (halt) or salute. The weapon is put away meanwhile; the legs keep moving as they were.
   */
  gesture(kind: 'point' | 'wave' | 'halt' | 'salute', yaw: number, ms = kind === 'wave' ? 1600 : 1200): void {
    this.gestureKind = kind; this.gestureYaw = yaw;
    this.gestureStart = performance.now(); this.gestureUntil = this.gestureStart + ms;
    this.poseDirty = true;
  }

  /** Level of detail by camera distance (see HumanBody.setDetail); far bodies also pose less often. */
  private detail: 0 | 1 | 2 = 0;
  private lodFrame = 0;
  private lodDt = 0;
  setDetail(distance: number): void {
    const level = distance < 14 ? 0 : distance < 45 ? 1 : 2;
    if (level === this.detail) return;
    this.detail = level;
    this.human?.setDetail(level);
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
  slash(step = -1, count?: number): number {
    this.meleeEdge.reset();
    const v = this.slashCount++ % SLASH_CLIPS.length;
    this.slashVariant = v;
    const weapon = WEAPON_BY_ITEM[this.weaponId ?? ''] ?? 0, spec = weaponSpec(weapon);
    if (spec?.kind === 'melee' && BLADE_COMBO_WEAPONS.has(weapon) && this.template.human?.clips.has('sword_combo')) {
      // One-handed blade: the next combo step (the local player passes the step its swing used;
      // others count with the same window rule).
      const now = performance.now();
      const n = step >= 0 ? step : nextBladeStep(this.bladeStep, this.bladeReadyAt, now);
      const timing = bladeStepTiming(spec, n), c = BLADE_COMBO[n]!;
      this.bladeStep = n; this.bladeReadyAt = now + timing.cooldownMs;
      this.recAction = { clip: c.clip, from: c.from, to: c.to, rate: (c.to - c.from) / (timing.durationMs / 1000), t: 0, lunge: !!c.lunge };
      this.playOnce(this.template.clips.has(SLASH_CLIPS[v]!) ? SLASH_CLIPS[v]! : 'melee_attack', timing.durationMs);
      return v;
    }
    // Long-hafted (two slashes in turn) and heavy weapons (the hammer swing): recorded, the same
    // swing and timing as the server's (the blow at the hand's fastest point).
    const swing = spec?.kind === 'melee' ? meleeSwing(weapon, spec, count ?? this.meleeSwings) : null;
    if (swing && this.template.human?.clips.has(swing.clip)) {
      this.meleeSwings = (count ?? this.meleeSwings) + 1;
      this.recAction = { clip: swing.clip, from: swing.from, to: swing.to, rate: (swing.to - swing.from) / (swing.durationMs / 1000), t: 0, lunge: swing.clip === LONG_LUNGE_CLIP };
      return v;
    }
    const duration = spec?.kind === 'melee' ? spec.animationMs : undefined;
    if (this.template.clips.has(SLASH_CLIPS[v]!)) this.playOnce(SLASH_CLIPS[v]!, duration);
    else this.playOnce('melee_attack', duration);
    return v;
  }

  /** Empty hands: the three recorded punches in turn. */
  private punch(): void {
    const clips = this.template.human?.clips;
    const id = PUNCH_CLIPS[this.punchCount++ % PUNCH_CLIPS.length]!, clip = clips?.get(id);
    if (!clip) return;
    // Quicker than the recordings' leisurely wind-up and recovery.
    this.recAction = { clip: id, from: .05, to: clip.duration, rate: 1.6, t: 0, lunge: false };
  }

  setAimPitch(pitch: number): void {
    this.aimPitch += (pitch - this.aimPitch) * 0.35;
  }

  /** Weapon kick: muzzle climb that decays over a few frames. */
  kick(amount: number): void {
    this.recoil = Math.min(0.5, this.recoil + amount);
    this.proneShotFor = .6;
    // A shot during the recorded recoil lets it finish (restarting it mid-way jerked the gun).
    if (this.lastKick > PISTOL_RECOIL_SPAN) this.lastKick = 0;
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
      if (!this.weaponId) this.punch();
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
    this.poseDirty = true;
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

  /** The survivor's own skeleton falling limp (its bones are not posed while it lasts). */
  private humanRagdoll: { ragdoll: SkinnedRagdoll; bones: Bone3[] } | null = null;

  startRagdoll(kx: number, kz: number, force: number, ground: (x: number, z: number) => number): void {
    if (this.ragdoll) return;
    if (this.human) {
      // From the pose it has now: the real skeleton collapses onto the ground (the block driver's
      // ragdoll would bend the skin round its few chunky bones).
      this.root.updateMatrixWorld(true);
      const bones: Bone3[] = [];
      // The body's chains only: face and finger bones ride along with their parents (simulated
      // loose they would scatter the face and hands).
      this.human.group.traverse((o) => { if ((o as Bone3).isBone && RAGDOLL_BONE.test(o.name)) bones.push(o as Bone3); });
      this.humanRagdoll = { ragdoll: new SkinnedRagdoll(this.human.group, bones, ground, kx, kz, force), bones };
    }
    this.model.rotation.set(0, 0, 0);
    this.model.position.set(0, 0, 0);
    this.ragdoll = Ragdoll.start(this.model, (n) => this.bones.get(n)?.node, PX, ground, kx, kz, force);
  }

  update(x: number, y: number, z: number, yaw: number, flags: number, dt: number, _elapsed: number, rollState?: { rollTicks: number; rollYaw: number }, motionDt = dt): void {
    const prone = (flags & EntityFlags.Prone) !== 0;
    this.proneShotFor = Math.max(0, this.proneShotFor - dt);
    this.poseDirty = true;
    this.frame.flags = flags; this.frame.dt = dt;
    if (this.recAction) {
      const a = this.recAction;
      a.t += dt;
      if (a.from + a.t * a.rate >= a.to || (flags & (EntityFlags.Dead | EntityFlags.Downed | EntityFlags.Knocked | EntityFlags.Swimming | EntityFlags.Prone | EntityFlags.Climbing)) !== 0) this.recAction = null;
    }
    if (this.reloadAnim && ((flags & (EntityFlags.Dead | EntityFlags.Downed | EntityFlags.Knocked | EntityFlags.Climbing | EntityFlags.Swimming | EntityFlags.Reviving)) !== 0
      || this.healing || this.mantleGrip || this.planning || this.drivingActive || this.flightActive
      || (this.reloadAnim.t += dt) >= this.reloadAnim.dur)) this.reloadAnim = null;
    // Knees give on landing after a real fall.
    if ((flags & (EntityFlags.Grounded | EntityFlags.Swimming)) === 0) this.airTime += dt;
    else { if (this.airTime > .35 && !(flags & EntityFlags.Climbing)) this.landT = LAND_SEC; this.airTime = 0; }
    this.landT = Math.max(0, this.landT - dt);
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
        this.humanRagdoll?.ragdoll.step(dt);
        return;
      }
      this.ragdollTemp = false;
      // Respawned: back to the animated skeleton.
      this.ragdoll.release();
      this.ragdoll = null;
      if (this.humanRagdoll) { for (const b of this.humanRagdoll.bones) b.matrixAutoUpdate = true; this.humanRagdoll = null; }
    }
    this.root.position.set(x, y, z);
    const inv = 1 / Math.max(motionDt, 1e-3);
    const reset = !Number.isFinite(this.lastX) || Math.hypot(x - this.lastX, z - this.lastZ) > Math.max(4, motionDt * 20);
    const dx = reset ? 0 : x - this.lastX;
    const dz = reset ? 0 : z - this.lastZ;
    const measured = Math.hypot(dx, dz) * inv;
    if (reset) { this.motionSpeed = 0; this.bodyYaw = yaw; }
    // Filter the motion signal, not the rendered position or the gait's accumulated phase.
    this.motionSpeed += (measured - this.motionSpeed) * (1 - Math.exp(-Math.max(0, motionDt) * 24));
    const speed = this.motionSpeed;
    const vy = reset ? 0 : (y - this.lastY) * inv;
    this.frame.speed = speed; this.frame.vy = vy; this.frame.dx = dx; this.frame.dz = dz;
    const wasRolling = this.cur.clip?.name === 'roll';
    // Local simulation owns the end of the action; never keep tumbling after steering resumes.
    if (rollState && rollState.rollTicks === 0 && wasRolling) this.cur.time = this.cur.clip!.length;
    this.choose(speed, vy, flags, dt);
    const rolling = this.cur.clip?.name === 'roll';
    if (rolling && !wasRolling) this.rollYaw = rollState?.rollYaw ?? (speed > 1 ? Math.atan2(-dx, -dz) : yaw);
    if (this.bodyYaw !== this.bodyYaw || this.rigid) this.bodyYaw = yaw;
    const oldBodyYaw = this.bodyYaw;
    this.aimYaw = yaw;
    const travelling = (flags & EntityFlags.Swimming) === 0 && this.facesTravel(flags, speed, dx, dz, rolling, yaw);
    this.facingTravel = travelling;
    if ((flags & (EntityFlags.Climbing | EntityFlags.Mantling)) !== 0) {
      // On a ladder or over a ledge: keep facing the wall.
      this.headYaw = 0;
    } else if ((flags & EntityFlags.Swimming) !== 0 && speed > 0.4) {
      // Swimming: the body turns smoothly into the direction it swims.
      const d = wrapAngle(Math.atan2(-dx, -dz) - this.bodyYaw);
      const max = 6 * dt;
      this.bodyYaw = wrapAngle(this.bodyYaw + Math.max(-max, Math.min(max, d)));
      this.headYaw = 0;
    } else if (travelling) {
      // Walking or running freely: the body turns into the direction of travel; only the head
      // keeps looking where the camera looks.
      const d = wrapAngle(Math.atan2(-dx, -dz) - this.bodyYaw), max = (this.recoveringFromRoll ? 8 : 9) * dt;
      this.bodyYaw = wrapAngle(this.bodyYaw + Math.max(-max, Math.min(max, d * (1 - Math.exp(-dt * 10)))));
      this.headYaw = Math.max(-MAX_HEAD_YAW, Math.min(MAX_HEAD_YAW, wrapAngle(yaw - this.bodyYaw)));
    } else {
      // Aim turns the whole body even at rest. A small, smooth root lag is shared through
      // the spine, instead of leaving the feet planted while only the arms spin around.
      let diff = wrapAngle(yaw - this.bodyYaw);
      // On the move the whole body squares up to where the player looks (strafing and
      // backpedalling included); standing still, only the head follows until it runs out of range.
      const moving = speed > .025 && Math.hypot(dx, dz) > 1e-6 && !rolling;
      // Attacking (shots, swings, throws) squares the body up to the mouse at once.
      const attacking = this.attackIntent || (flags & EntityFlags.Attacking) !== 0 || !!this.recAction || this.oneShot !== null;
      const following = moving || prone || attacking || (flags & EntityFlags.Aiming) !== 0;
      // Standing still, the head turns first; past its range the feet step the body round in
      // one smooth turn until it nearly faces the view again (no per-frame nudges).
      if (!following && !this.turningInPlace && Math.abs(diff) > TURN_START) this.turningInPlace = true;
      if (following || Math.abs(diff) < TURN_STOP) this.turningInPlace = false;
      const turn = following ? diff * (1 - Math.exp(-dt * (prone ? 7 : 12))) : this.turningInPlace ? diff * (1 - Math.exp(-dt * 5)) : 0;
      // Turning back toward the aim after a sideways/backward roll must not snap the body.
      const maxTurn = prone ? 2.6 * dt : this.recoveringFromRoll ? 8 * dt : following ? 12 * dt : 4.5 * dt;
      this.bodyYaw = wrapAngle(this.bodyYaw + Math.max(-maxTurn, Math.min(maxTurn, turn)));
      if (this.viewAligned && moving && !prone && !this.recoveringFromRoll) this.bodyYaw = yaw;
      if (Math.abs(turn) <= maxTurn) this.recoveringFromRoll = false;
      diff = wrapAngle(yaw - this.bodyYaw);
      this.headYaw = Math.max(-MAX_HEAD_YAW, Math.min(MAX_HEAD_YAW, diff));
    }
    this.bodyTurnRate = wrapAngle(this.bodyYaw - oldBodyYaw) / Math.max(dt, .001);
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
    // The survivor blades the other way: support shoulder forward, the stock at the firing shoulder.
    if (this.template.human && this.stance === 'rifle' && this.weaponId && body) {
      body.node.rotation.y = -body.node.rotation.y;
      if (head) head.node.rotation.y = -head.node.rotation.y;
    }
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
    if (!this.template.human) this.model.position.y -= .3 * this.crouchBlend;
    if (held) {
      held.obj.matrix.copy(held.attach);
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
      const running = !this.human && !aiming && !prone && !(flags & EntityFlags.Crouching) && speed > .3 && ((flags & EntityFlags.Sprinting) !== 0 || speed > 5) && (flags & (EntityFlags.Grounded | EntityFlags.Swimming)) === EntityFlags.Grounded;
      this.runBlend += ((running && held.visual.aim ? 1 : 0) - this.runBlend) * (1 - Math.exp(-dt * 9));
      if (!dead && !treating && !rolling && this.oneShot === null && !this.weaponAnim && !this.idleClip && held.visual.aim) {
        this.weaponAim ??= new WeaponAim();
        const r = this.runBlend;
        // The firing arm comes forward to the hip so the gun is carried in front of the body.
        const triggerArm = this.bones.get(`arm_${triggerSide}`)?.node;
        if (r > .001 && triggerArm) { triggerArm.rotation.x += (.75 - triggerArm.rotation.x) * r; triggerArm.rotation.z *= 1 - r * .6; }
        if (this.template.human && !prone && r < .999) this.holdGunReady(triggerSide, 1 - r);
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

  /**
   * Poses the survivor from the rig: what each hand holds (the gun's grip and handguard, a ledge,
   * a ladder rung, the magazine during a reload), how tucked the body is (rolls, the top of a
   * jump), the knees giving on landing and the feet planted on the ground.
   */
  private finishPose(): void {
    const human = this.human!, rig = this.rig!;
    const { flags, speed, vy, dt } = this.frame;
    // Where the person looks follows the camera with a short, human lag.
    const lookRate = 1 - Math.exp(-Math.max(0, dt) * 9);
    this.lookYaw += (this.headYaw - this.lookYaw) * lookRate;
    this.lookPitch += (this.aimPitch - this.lookPitch) * lookRate;
    const has = (f: number) => (flags & f) !== 0;
    const limp = !!this.ragdoll || has(EntityFlags.Dead | EntityFlags.Downed | EntityFlags.Knocked);
    const swimming = has(EntityFlags.Swimming), prone = has(EntityFlags.Prone), climbing = has(EntityFlags.Climbing);
    const rolling = this.cur.clip?.name === 'roll';
    const airborne = !has(EntityFlags.Grounded) && !swimming && !climbing;
    const held = this.weaponKey ? this.weaponObjects.get(this.weaponKey) : undefined;
    const sighted = has(EntityFlags.Aiming) && !this.reloadAnim;
    const resting = !sighted && !has(EntityFlags.Attacking) && !this.reloadAnim && !airborne
      && !prone && !has(EntityFlags.Crouching) && (has(EntityFlags.Sprinting) || speed > 4.2);
    // Up to the sights briskly, back down softly (no snap upright on release).
    // Critically damped springs: each change of stance starts and settles softly, without the
    // first-frame jump of an exponential blend. Up to the sights briskly, down gently.
    [this.sightBlend, this.sightVel] = spring(this.sightBlend, this.sightVel, sighted ? 1 : 0, dt, sighted ? .07 : .16);
    [this.restGunBlend, this.restVel] = spring(this.restGunBlend, this.restVel, resting ? 1 : 0, dt, resting ? .1 : .12);
    const scale = this.model.scale.y;
    if (!this.reloadAnim || !held?.obj.visible) this.heldMagazine.clear();
    const gesturing = !limp && !climbing && !swimming && !this.mantleGrip && !this.drivingActive && !this.flightActive && performance.now() < this.gestureUntil;
    const stowing = !limp && (gesturing || climbing || !!this.mantleGrip || this.planning || this.healing
      || this.drivingActive || this.flightActive || has(EntityFlags.Reviving | EntityFlags.Swimming));
    this.stowForInteraction(stowing);
    if (held) held.obj.visible = !stowing;
    const base = this.root.getWorldPosition(new Vector3());
    const fwd = new Vector3(0, 0, -1).applyQuaternion(this.root.getWorldQuaternion(new Quaternion()));
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
    fwd.normalize();
    const right = new Vector3(-fwd.z, 0, fwd.x);
    const grasp: Record<Side, Grasp | null> = { L: null, R: null };
    const reach: Record<Side, Vector3 | null> = { L: null, R: null };
    const hands: Record<Side, HandPreset> = { L: 'relaxed', R: 'relaxed' };
    let tuck = 0;
    const recordedRoll = rolling && !!this.template.human?.clips.has('roll');
    if (rolling && this.cur.clip && !recordedRoll) {
      const p = Math.min(1, this.cur.time / this.cur.clip.length);
      tuck = smooth(.03, .18, p) * (1 - smooth(.6, .85, p));
    } else if (airborne && this.cur.clip?.name === 'jump') tuck = .12 + .3 * (1 - smooth(.5, 4, Math.abs(vy)));
    const scaleClips = !!this.template.human?.clips.has('climb_up');
    const recorded = this.stepRecordedMotion();
    const scaling = scaleClips && (climbing || !!this.mantleGrip) && !!recorded;
    // A recorded jump already tucks and absorbs the landing.
    if (recorded?.clip === 'jump') tuck = 0;
    const land = this.landT > 0 ? landCurve(1 - this.landT / LAND_SEC) : 0;
    if (!climbing) this.rungs.L = this.rungs.R = null;

    if (limp) {
      // A limp body: hands loose.
    } else if (scaling) {
      // Ladders and ledges: the recorded climb (hands and feet as captured).
    } else if (this.mantleGrip) {
      // Palms flat over the ledge, fingers curled round its edge.
      const approach = fwd.clone().multiplyScalar(.35).add(new Vector3(0, -1, 0)).normalize();
      grasp.L = { center: this.mantleGrip.left.clone().addScaledVector(UP, -.015), axis: right.clone(), approach, radius: .02 };
      grasp.R = { center: this.mantleGrip.right.clone().addScaledVector(UP, -.015), axis: right.clone().negate(), approach: approach.clone(), radius: .02 };
    } else if (this.planning) {
      for (const s of SIDES) { reach[s] = this.root.localToWorld(new Vector3(s === 'L' ? -.25 : .25, 1.1, -.42).multiplyScalar(SURVIVOR_SIZE)); hands[s] = 'pinch'; }
    } else if (climbing) {
      // Ladder: each hand closes on a rung and stays there until it is time to reach for the next.
      const t = this.cur.clip?.name === 'climb_ladder' ? this.cur.time / this.cur.clip.length : 0;
      const wall = base.clone().addScaledVector(fwd, .36);
      for (const s of SIDES) {
        const high = Math.cos(Math.PI * 2 * (t - (s === 'R' ? 0 : .5)));
        const rung = Math.round((base.y + (1.72 + .16 * high) * SURVIVOR_SIZE * scale) / RUNG) * RUNG;
        const want = wall.clone().addScaledVector(right, (s === 'R' ? .2 : -.2) * scale).setY(rung);
        const at = (this.rungs[s] ??= want.clone()).lerp(want, 1 - Math.exp(-dt * 16));
        grasp[s] = { center: at.clone(), axis: right.clone().multiplyScalar(s === 'R' ? -1 : 1), approach: fwd.clone().multiplyScalar(.85).add(new Vector3(0, -.5, 0)).normalize(), radius: .017 };
      }
    } else if (held && held.obj.visible) {
      this.reloadReach = null;
      this.holdWeapon(held, grasp, hands, fwd, right);
      if (this.reloadReach) reach[this.reloadSide] = this.reloadReach;
    } else {
      const punching = this.oneShot === 'melee_attack';
      const preset: HandPreset = punching || this.drivingActive ? 'fist' : swimming ? 'open' : speed > 4 && !airborne ? 'ready' : 'relaxed';
      hands.L = hands.R = preset;
      if (gesturing) {
        // Hand signals with the right arm, from the shoulder.
        const t = (performance.now() - this.gestureStart) / 1000, size = SURVIVOR_SIZE * scale;
        const shoulder = base.clone().addScaledVector(UP, 1.42 * size).addScaledVector(right, .2 * size);
        if (this.gestureKind === 'point') {
          const dir = new Vector3(-Math.sin(this.gestureYaw), .1, -Math.cos(this.gestureYaw)).normalize();
          reach.R = shoulder.addScaledVector(dir, .6 * size); hands.R = 'pinch';
        } else if (this.gestureKind === 'wave') {
          reach.R = shoulder.addScaledVector(UP, .5 * size).addScaledVector(right, (.1 + Math.sin(t * 9) * .16) * size).addScaledVector(fwd, .06 * size); hands.R = 'open';
        } else if (this.gestureKind === 'halt') {
          reach.R = shoulder.addScaledVector(UP, .38 * size).addScaledVector(fwd, .18 * size); hands.R = 'open';
        } else {
          reach.R = base.clone().addScaledVector(UP, 1.66 * size).addScaledVector(right, .12 * size).addScaledVector(fwd, .1 * size); hands.R = 'open';
        }
      } else if (rolling && !recordedRoll) {
        // Tucked: hands round the shins.
        for (const s of SIDES) { reach[s] = rig.root.localToWorld(new Vector3(s === 'L' ? -.13 : .13, .78, -.3).multiplyScalar(SURVIVOR_SIZE)); hands[s] = 'fist'; }
      } else if (airborne && this.cur.clip?.name === 'jump' && !this.weaponId && !this.template.human?.clips.has('jump')) {
        // Arms come forward for balance instead of the block character's overhead swing.
        for (const s of SIDES) reach[s] = base.clone().addScaledVector(UP, (1.06 + .14 * smooth(-2, 3, vy)) * SURVIVOR_SIZE * scale).addScaledVector(fwd, .27 * SURVIVOR_SIZE * scale).addScaledVector(right, (s === 'L' ? -.26 : .26) * SURVIVOR_SIZE * scale);
      }
    }
    const planted = !limp && has(EntityFlags.Grounded) && !prone && !swimming && !rolling && !climbing && !this.mantleArms && !this.flightActive && !this.drivingActive;
    this.plantBlend += ((planted ? 1 : 0) - this.plantBlend) * (1 - Math.exp(-Math.max(dt, 1 / 60) * 12));
    // The recorded firing arm drives the gun; aiming rotates that arm about its shoulder.
    const bracing = !!recorded && (recorded.clip === 'stand_to_crouch' || recorded.clip === 'crouch_to_prone' || recorded.clip === 'prone_forward' || recorded.clip.startsWith('prone_turn_'));
    this.pointBlend += ((held?.visual.aim && held.obj.visible && !bracing ? 1 : 0) - this.pointBlend) * (1 - Math.exp(-Math.max(dt, 1 / 120) * 12));
    if (held?.visual.aim && has(EntityFlags.Attacking) && !this.reloadAnim) this.pointBlend = 1;
    if (held?.visual.aim && held.obj.visible && recorded?.arms && !limp && !climbing && !this.mantleGrip && !this.planning && (!this.reloadAnim || recorded.action) && !this.healing) {
      // Recorded body first, rigid weapon in the firing hand second, support-hand IK last.
      grasp.L = grasp.R = null;
      this.poseBranch = recorded.weight > .98 ? 'gun' : 'gun-driver';
      if (recorded.weight > .98) human.poseMocap(recorded, dt);
      else human.poseFromDriver(rig, { dt, grasp, reach, hands, plant: this.plantBlend, crouch: this.crouchBlend, tuck, land, moving: speed > .025, grounded: (this.frame.flags & EntityFlags.Grounded) !== 0, ground: this.ground, mocap: recorded });
      this.attachRecordedGun(held, bracing, recorded.action?.weight ?? 0);
      this.heldMagazine.update(held.obj, recorded.action && this.reloadAnim ? this.reloadAnim.t / this.reloadAnim.dur : -1, human.palmMatrix('L'));
      return;
    }
    if (held && held.obj.visible && !held.visual.aim && !held.visual.melee && recorded && recorded.weight > .98
      && !limp && !climbing && !this.mantleGrip && !this.planning && !this.healing) {
      this.poseBranch = 'item';
      human.poseMocap(recorded, dt);
      this.carryItem(held);
      return;
    }
    if (held && held.obj.visible && !limp && !climbing && !this.mantleGrip && !this.planning && !this.reloadAnim && !this.healing
      && held.visual.melee) {
      if (recorded && recorded.arms && recorded.weight > .98) {
        // Recorded body; the weapon rides in the animated right hand, the left arm moves freely.
        this.poseBranch = 'melee';
        human.poseMocap(recorded, dt);
        this.holdMelee(held);
      } else {
        this.poseBranch = 'carry';
        this.carryWeapon(held, grasp, reach, hands, recorded, { dt, tuck, land, speed, fwd });
      }
      return;
    }
    // Fully recorded and nothing to reach for: the clip as it was captured.
    if (recorded && recorded.arms && recorded.weight > .98 && !grasp.L && !grasp.R && !reach.L && !reach.R) {
      this.poseBranch = 'recorded';
      human.poseMocap(recorded, dt);
      // Walking and running carry the head level too: the walk recording looks down at the ground.
      if (!limp && (recorded.clip === NEUTRAL_IDLE || /^(walk_|jog_|fast_run)/.test(recorded.clip)) && recorded.weight > .98) {
        // Standing relaxed: the head carried level (the source frame tips it back), turned to the look.
        const ly = this.root.rotation.y + this.lookYaw, lp = Math.max(-.6, Math.min(.6, this.lookPitch));
        human.headUp(new Vector3(-Math.sin(ly) * Math.cos(lp), Math.sin(lp), -Math.cos(ly) * Math.cos(lp)), .9);
      } else if (!limp && !isRoll(recorded.clip)) human.lookAround(this.lookYaw, Math.max(-.6, Math.min(.6, this.lookPitch)) * (prone ? .4 : 1), prone ? 0 : .3);
    }
    else {
      this.poseBranch = 'driver';
      human.poseFromDriver(rig, { dt, grasp, reach, hands, plant: this.plantBlend, crouch: this.crouchBlend, tuck, land: recorded?.clip === 'jump' ? 0 : land, moving: speed > .025, grounded: (this.frame.flags & EntityFlags.Grounded) !== 0, ground: this.ground, mocap: recorded });
    }
    human.group.updateMatrixWorld(true);
  }

  /** Which way finishPose posed the body this frame (a change starts a short crossfade). */
  private poseBranch = '';
  private lastBranch = '';
  /** The body (bone rotations, hips) and the held item as last shown, and a crossfade from them. */
  private shown: { q: Quaternion[]; hips: Vector3; item: Matrix4 | null; itemObj: Object3D | null } | null = null;
  private crossfade: { from: { q: Quaternion[]; hips: Vector3; item: Matrix4 | null; itemObj: Object3D | null }; t: number } | null = null;

  /**
   * The posing methods (recorded clip, driver with IK, held-gun placement…) each give a whole,
   * consistent pose but not the same one: switching method from one frame to the next (a pistol
   * reload, the body fading into its recording) jumped the arms and the gun. A switch now fades
   * from the pose last shown over BRANCH_FADE seconds, the item in hand fading along with it.
   */
  private smoothBranchSwitch(): void {
    const human = this.human!, dt = this.frame.dt;
    const held = this.weaponKey ? this.weaponObjects.get(this.weaponKey)?.obj ?? null : null;
    if (this.shown && this.lastBranch && this.poseBranch !== this.lastBranch && !this.humanRagdoll) {
      this.crossfade = { from: this.shown, t: 0 };
    }
    this.lastBranch = this.poseBranch;
    const f = this.crossfade;
    if (f) {
      f.t += dt;
      const k = f.t >= BRANCH_FADE ? 1 : smooth(0, 1, f.t / BRANCH_FADE);
      if (k >= 1 || this.humanRagdoll) this.crossfade = null;
      else {
        human.bones.forEach((b, i) => { const q = f.from.q[i]; if (q) b.quaternion.slerpQuaternions(q, b.quaternion.clone(), k); });
        const hips = human.bones[human.assets.index.get('spine') ?? 0]!;
        hips.position.lerpVectors(f.from.hips, hips.position.clone(), k);
        human.group.updateMatrixWorld(true);
        if (held && f.from.item && f.from.itemObj === held && held.parent) {
          const now = held.matrixWorld.clone();
          const a = { p: new Vector3(), q: new Quaternion(), s: new Vector3() }, b = { p: new Vector3(), q: new Quaternion(), s: new Vector3() };
          f.from.item.decompose(a.p, a.q, a.s); now.decompose(b.p, b.q, b.s);
          const world = new Matrix4().compose(a.p.lerp(b.p, k), a.q.slerp(b.q, k), a.s.lerp(b.s, k));
          held.matrix.copy(held.parent.matrixWorld.clone().invert().multiply(world));
          held.updateWorldMatrix(false, true);
        }
      }
    }
    const shown = this.shown ??= { q: human.bones.map(() => new Quaternion()), hips: new Vector3(), item: null, itemObj: null };
    human.bones.forEach((b, i) => shown.q[i]!.copy(b.quaternion));
    shown.hips.copy(human.bones[human.assets.index.get('spine') ?? 0]!.position);
    shown.itemObj = held && held.visible ? held : null;
    shown.item = shown.itemObj ? (shown.item ?? new Matrix4()).copy(held!.matrixWorld) : null;
  }

  /** The Mixamo skeleton: the recorded walk when walking forward on foot, else the survivor's pose. */
  private poseMixamo(): void {
    if (!this.mixamo) return;
    const { flags, speed, dt, dx, dz } = this.frame;
    const has = (f: number) => (flags & f) !== 0;
    const yaw = this.root.rotation.y, len = Math.hypot(dx, dz);
    const forward = len < 1e-6 || (-Math.sin(yaw) * dx - Math.cos(yaw) * dz) / len > .7;
    const walking = !this.humanRagdoll && has(EntityFlags.Grounded) && forward && speed > .3 && speed < 2.8
      && !has(EntityFlags.Crouching | EntityFlags.Prone | EntityFlags.Swimming | EntityFlags.Climbing | EntityFlags.Sprinting | EntityFlags.Dead | EntityFlags.Downed | EntityFlags.Knocked | EntityFlags.Attacking)
      && !this.drivingActive && !this.flightActive && !this.mantleGrip && !this.reloadAnim && this.cur.clip?.name !== 'roll';
    const held = this.weaponKey ? this.weaponObjects.get(this.weaponKey) : undefined;
    this.mixamo.update({ dt, speed, walking, armsBusy: !!held?.obj.visible });
  }

  private pointBlend = 0;
  private lookYaw = 0;
  private lookPitch = 0;
  private raiseBlend = 0;
  private readyBlend = 0;
  /** The aim yaw as given (camera/cursor), and its direction with the aim pitch. */
  private aimYaw = 0;
  private readonly aimDirection = new Vector3(0, 0, -1);
  private readyVel = 0;
  private sightVel = 0;
  private restVel = 0;
  /** Angle between the held gun's bore and the aim (radians), after posing. */
  private boreError = Math.PI;
  private bobScale = 1;
  private sightBlend = 0;
  private restGunBlend = 0;
  private readonly heldMagazine = new ReloadMagazine();
  private supportGripBlend = 1;
  /** Preserve every contributing pose during an interrupted crossfade. */
  private mocapLayers: MocapLayer[] = [];
  private upperLayers: MocapLayer[] = [];
  private legLayers: MocapLayer[] = [];
  private readonly postureMotion = new PostureMotion();
  private bodyTurnRate = 0;
  /** Standing still and stepping round to face the view again. */
  private turningInPlace = false;
  /** Smoothed turn rate driving the turning feet (rad/s). */
  private stepTurnRate = 0;
  /** The local player is pressing attack (before the server's flag comes back). */
  attackIntent = false;
  private mantleK = 0;
  /** The body faces its direction of travel this frame (not the camera). */
  private facingTravel = false;

  /** Free movement turns the body to the travel direction; aiming, attacking, swinging,
   * prone, rolling and climbing keep it on the camera. A little speed is needed (no jitter). */
  private facesTravel(flags: number, speed: number, dx: number, dz: number, rolling: boolean, yaw: number): boolean {
    const free = (flags & (EntityFlags.Aiming | EntityFlags.Attacking | EntityFlags.Prone | EntityFlags.Climbing | EntityFlags.Mantling)) === 0;
    const distance = Math.hypot(dx, dz);
    if (!free || rolling || this.attackIntent || this.recAction || this.oneShot !== null || distance < 1e-6 || speed < (this.facingTravel ? .25 : .5)) return false;
    // Moving away from the view backpedals (recorded backward steps) instead of turning round.
    const ahead = (-dx * Math.sin(yaw) - dz * Math.cos(yaw)) / distance;
    return ahead > -.35;
  }
  private carryPhase = 0;
  private startRunTime: number | null = null;
  private aimClipTime = 0;
  /** Seconds since a pistol was taken in hand (−1: not drawing). */
  private pistolDraw = -1;
  /** Long or heavy swings so far (others' avatars count their own). */
  private meleeSwings = 0;
  /** Last shot (seconds ago), for the one-handed firing stance and the Shooting clip's recoil. */
  private sinceShot = 9;
  /** Seconds since the last shot left the gun (`kick`), for the pistol's recorded recoil. */
  private lastKick = 9;
  private forwardBlend = 0;

  private calibrateGun(held: { obj: Object3D; visual: WeaponVisual }, trig: Side, scale: number): RifleFit {
    const v = held.visual, aim = v.aim!;
    const stock = this.stockPoint(held, trig, scale);
    return this.human!.rifleFit({ key: this.weaponKey ?? '', barrel: aim.barrel, up: aim.up, grip: aim.grip, scale, trigger: trig, twoHanded: !!v.twoHandGrip, gripRadius: v.spec?.gripRadius, stock });
  }

  /** Stock comb behind the firing grip, measured from the gun mesh (gun frame, unscaled). */
  private stockPoint(held: { obj: Object3D; visual: WeaponVisual }, trig: Side, scale: number): Vector3 | null {
    const v = held.visual, aim = v.aim!;
    if (this.stance !== 'rifle' || !v.spec) return null;
    // Compact guns (P90, MP5, UZI…) are held out in front by both hands, not tucked under the arm.
    if (v.spec.length < .6) return null;
    return rifleStockContact(held.obj, aim.grip.clone().multiplyScalar(scale), aim.barrel.clone().normalize(), aim.up.clone().normalize(), trig === 'R' ? 1 : -1)?.multiplyScalar(1 / scale) ?? null;
  }

  /**
   * The recorded firing hand carries the gun rigidly; the chest turns so the bore follows the
   * aim (never the other way round); the support hand then takes the handguard by IK.
   */
  private attachRecordedGun(held: { obj: Object3D; visual: WeaponVisual }, supportFree = false, reloadWeight = 0): void {
    const human = this.human!, v = held.visual, aim = v.aim!;
    // A pistol is held one-handed (the left hand free) unless aiming down the sights.
    const pistol = this.stance === 'pistol' && !!this.template.human?.clips.has('pistol_draw');
    if (pistol && (this.frame.flags & EntityFlags.Aiming) === 0) supportFree = true;
    this.supportGripBlend += ((supportFree ? 0 : 1) - this.supportGripBlend) * (1 - Math.exp(-this.frame.dt * 10));
    const trig: Side = v.twoHandGrip?.triggerHand === 'left' ? 'L' : 'R', sup: Side = trig === 'R' ? 'L' : 'R';
    held.obj.matrix.copy(this.weaponObjects.get(this.weaponKey!)!.attach);
    held.obj.updateWorldMatrix(true, false);
    const scale = new Vector3().setFromMatrixScale(held.obj.matrixWorld).x;
    const fit = this.calibrateGun(held, trig, scale);
    const gunWorld = () => human.handMatrix(trig).multiply(fit.inHand);
    // Bring the bore onto the aim through the chest: yaw always (the body turns before the
    // feet), elevation while the rifle is up. Two passes converge the shoulder lever arm.
    const flags = this.frame.flags, dt = this.frame.dt;
    // In a match the gun is always ready: belly height, stock against the ribs, bore straight.
    // The lobby keeps the recorded relaxed idle.
    const inGame = this.mocapIdle === null;
    const raised = (flags & (EntityFlags.Aiming | EntityFlags.Attacking)) !== 0;
    this.raiseBlend += ((raised ? 1 : 0) - this.raiseBlend) * (1 - Math.exp(-dt * 14));
    // A shot leaves along the bore: firing brings the gun up at once.
    if ((flags & EntityFlags.Attacking) !== 0 && !this.reloadAnim) this.raiseBlend = 1;
    const carry = this.pointBlend * (1 - reloadWeight) * (1 - this.restGunBlend);
    // (A pistol's carry comes from its recorded stances, not the rifle's chest-height hold.)
    const ready = inGame && !supportFree && !pistol && (flags & EntityFlags.Prone) === 0;
    [this.readyBlend, this.readyVel] = spring(this.readyBlend, this.readyVel, ready ? 1 : 0, dt, .07);
    // A pistol fired from the hip is still brought onto the aim (one-handed).
    // A pistol's chest only brings the bore on once its pointing stance (Shooting, or the hip shot)
    // is in: turning the chest to level the gun of the high hold bent the body double.
    const pointing = pistol ? Math.min(1, 2 * this.upperLayers.reduce((sum, l) => sum + (l.clip === 'pistol_shoot' || l.clip === 'pistol_hip' ? easeWeight(l.weight) : 0), 0)) : 1;
    const aimWeight = (inGame ? pistol ? Math.max(this.sightBlend, this.raiseBlend) * pointing : this.sightBlend : this.raiseBlend) * carry;
    // The ready gun is placed on the aim by the arm; the chest then only shares the look.
    const hipNow = this.readyBlend * carry;
    // Running freely the gun is carried along the body, level; otherwise it follows the aim.
    // Attacking or sighting: the true aim (the head's range is capped while the body catches up,
    // and a shot must go where the cursor is). Otherwise the gun follows the head.
    const onTarget = this.attackIntent || (flags & (EntityFlags.Aiming | EntityFlags.Attacking)) !== 0;
    // Either way the arms carry it only so far round from the chest; the body turns the rest.
    const off = onTarget ? wrapAngle(this.aimYaw - this.root.rotation.y) : this.headYaw;
    const yaw = this.facingTravel ? this.root.rotation.y : this.root.rotation.y + Math.max(-GUN_YAW_RANGE, Math.min(GUN_YAW_RANGE, off));
    const pitch = this.facingTravel ? 0 : this.aimPitch + this.recoil * .6;
    // (Recoil climb included: the gate must not hold back automatic fire between shots.)
    const gatePitch = this.aimPitch + this.recoil * .6;
    this.aimDirection.set(-Math.sin(this.aimYaw) * Math.cos(gatePitch), Math.sin(gatePitch), -Math.cos(this.aimYaw) * Math.cos(gatePitch));
    const want = new Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
    for (let pass = 0; pass < 2; pass++) {
      const bore = aim.barrel.clone().transformDirection(gunWorld());
      const flat = bore.clone().setY(0), flatWant = want.clone().setY(0);
      const turn = new Quaternion();
      // Raised: the bore onto the aim. Lowered: the chest only shares the head's turn.
      const error = flat.lengthSq() > 1e-4 ? Math.atan2(flat.z * flatWant.x - flat.x * flatWant.z, flat.dot(flatWant)) : 0;
      turn.setFromAxisAngle(UP, error * aimWeight + (pass === 0 ? this.lookYaw * .35 * (1 - aimWeight) * (1 - hipNow) : 0));
      // Elevation about the chest's own right axis.
      const turned = bore.clone().applyQuaternion(turn);
      const lift = new Quaternion().setFromUnitVectors(turned, turned.clone().setY(0).normalize().multiplyScalar(Math.cos(pitch)).setY(Math.sin(pitch)).normalize());
      human.turnChest(new Quaternion().slerp(lift, aimWeight).multiply(turn), 1);
    }
    // Shouldered: the firing arm brings the gun in until the stock meets the cheek (the arm
    // moves the gun, never the reverse); the neck settles the remainder.
    const stock = this.stockPoint(held, trig, scale);
    const shoulder = this.sightBlend * aimWeight;
    if (stock && shoulder > .001) for (let pass = 0; pass < 2; pass++) {
      const draw = human.rifleCheek(trig).sub(stock.clone().applyMatrix4(gunWorld())).clampLength(0, .14);
      if (draw.length() < .003) break;
      human.placeHand(trig, human.handMatrix(trig).premultiply(new Matrix4().makeTranslation(draw.x, draw.y, draw.z)), shoulder, Math.PI);
    }
    // Ready (not sighting): the firing arm carries the gun up to chest height, the stock
    // tucked into the armpit, bore along the aim. The arm moves; the gun follows the hand.
    const hip = this.readyBlend * carry * (1 - shoulder);
    if (hip > .001) {
      const k = SURVIVOR_SIZE * this.model.scale.y, side = trig === 'R' ? 1 : -1;
      const fwd = want.clone().setY(0).normalize(), right = new Vector3(-fwd.z, 0, fwd.x).multiplyScalar(side);
      // The armpit: just below and inside the firing shoulder joint.
      const compact = (v.spec?.length ?? 1) < .6;
      // A compact gun is held in front of the chest's middle, both arms reaching it alike; a long
      // one sits on the firing side with its stock under the arm.
      const ribs = compact
        ? human.bonePosition('upper_arm_R').add(human.bonePosition('upper_arm_L')).multiplyScalar(.5).addScaledVector(UP, -.16 * k).addScaledVector(right, .04 * k).addScaledVector(fwd, .05 * k)
        : human.bonePosition(trig === 'R' ? 'upper_arm_R' : 'upper_arm_L').addScaledVector(UP, -.1 * k).addScaledVector(right, -.025 * k).addScaledVector(fwd, .03 * k);
      const b = aim.barrel.clone().normalize(), u = aim.up.clone().addScaledVector(b, -aim.up.dot(b)).normalize();
      const up = UP.clone().addScaledVector(want, -want.y).normalize();
      const rotation = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(want, up, new Vector3().crossVectors(want, up))
        .multiply(new Matrix4().makeBasis(b, u, new Vector3().crossVectors(b, u)).transpose()));
      // Without a measured stock the grip sits a forearm ahead of the ribs.
      const anchor = stock ?? aim.grip.clone().addScaledVector(b, -.25 / scale);
      const position = ribs.sub(anchor.clone().multiplyScalar(scale).applyQuaternion(rotation));
      const gun = new Matrix4().compose(position, rotation, new Vector3(scale, scale, scale));
      human.placeHand(trig, gun.multiply(fit.inHand.clone().invert()), hip, Math.PI);
    }
    // A compact gun (P90, MP5…) carried low sits against the belly: the support hand would sink
    // into it. Bring the gun forward until the handguard has a forearm's room in front of the body.
    if (v.twoHandGrip && this.supportGripBlend > .01) {
      const k = SURVIVOR_SIZE * this.model.scale.y, front = new Vector3(0, 0, -1).applyQuaternion(this.root.getWorldQuaternion(new Quaternion())).setY(0).normalize();
      const guard = v.twoHandGrip.support.clone().applyMatrix4(gunWorld()), belly = human.bonePosition('spine_002');
      const need = .2 * k - guard.sub(belly).dot(front);
      if (need > 0) human.placeHand(trig, human.handMatrix(trig).premultiply(new Matrix4().makeTranslation(front.x * need, 0, front.z * need)), 1, Math.PI);
    }
    const world = gunWorld();
    const bore = aim.barrel.clone().transformDirection(world);
    // Ready to fire only once the bore is on the true aim, not merely on where the head points.
    this.boreError = bore.angleTo(this.aimDirection);
    if (inGame) {
      // The head stays upright and turns with the (lagging) look, ahead of the chest.
      const ly = this.root.rotation.y + this.lookYaw, lp = Math.max(-.6, Math.min(.6, this.lookPitch));
      human.headUp(new Vector3(-Math.sin(ly) * Math.cos(lp), Math.sin(lp), -Math.cos(ly) * Math.cos(lp)), .85 * (1 - shoulder));
    } else human.lookAround(this.lookYaw * (1 - shoulder), 0, 0);
    // The skull looks along the sights, the lower neck brings the cheek onto the stock comb;
    // alternating twice settles both.
    const sights = aim.barrel.clone().transformDirection(world);
    for (let pass = 0; pass < 3; pass++) {
      if (stock) human.cheekTo(trig, stock.clone().applyMatrix4(world), shoulder);
      human.lookAlong(sights, shoulder);
    }
    held.obj.matrix.copy(held.obj.parent!.matrixWorld.clone().invert().multiply(world));
    held.obj.matrixWorldNeedsUpdate = true;
    held.obj.updateWorldMatrix(false, true);
    const supportWeight = this.supportGripBlend * (1 - reloadWeight);
    const target = v.twoHandGrip && supportWeight > .001 ? human.supportTarget(sup, world, fit, v.twoHandGrip.support, v.spec?.supportRadius ?? .021) : null;
    if (target) human.placeHand(sup, target, supportWeight);
    human.group.updateMatrixWorld(true);
  }

  private readonly itemCenters = new Map<string, Vector3>();

  /**
   * A small item (grenade, tool, detonator) in the right palm: carried in front of the chest,
   * and for a grenade an overhand throw: wind-up behind the shoulder with the chest turned and
   * the other arm pointing at the target, release over the shoulder, follow-through across the
   * body. The hand is placed by IK; the item sits in the palm and leaves it at the release.
   */
  private carryItem(held: { obj: Object3D; visual: WeaponVisual }): void {
    const human = this.human!, dt = this.frame.dt;
    const k = SURVIVOR_SIZE * this.model.scale.y;
    const yaw = this.root.rotation.y + this.lookYaw;
    const fwd = new Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)), right = new Vector3(-fwd.z, 0, fwd.x);
    const clipT = this.oneShot === 'grenade_throw' && this.cur.clip ? Math.min(1, this.cur.time / this.cur.clip.length) : -1;
    // Thrown from the raised (primed) hold: the swing starts at the wind-up, not from the chest.
    if (clipT < 0) this.throwFromPrime = false; else if (this.primeBlend > .5) this.throwFromPrime = true;
    const throwing = clipT >= 0 && this.throwFromPrime ? .38 + clipT * .62 : clipT;
    const at = (bone: string, f: number, r: number, u: number) => human.bonePosition(bone).addScaledVector(fwd, f * k).addScaledVector(right, r * k).addScaledVector(UP, u * k);
    const carry = at('spine_002', .22, .1, -.04);
    let hand = carry, chestYaw = 0, lean = 0, point = 0;
    if (throwing >= 0) {
      // Keys: carry → wind-up → release → follow-through → carry.
      const keys: Array<[number, Vector3, number, number, number]> = [
        [0, carry, 0, 0, 0],
        [.38, at('upper_arm_R', -.2, .1, .16), .55, -.05, 1],
        [.55, at('upper_arm_R', .42, -.02, .2), -.25, .2, .6],
        [.78, at('spine_002', .3, -.12, -.08), -.45, .28, 0],
        [1, carry, 0, 0, 0],
      ];
      let i = 0;
      while (i < keys.length - 2 && throwing > keys[i + 1]![0]) i++;
      const [t0, p0, y0, l0, a0] = keys[i]!, [t1, p1, y1, l1, a1] = keys[i + 1]!;
      const u = smooth(t0, t1, throwing);
      hand = p0.clone().lerp(p1, u); chestYaw = y0 + (y1 - y0) * u; lean = l0 + (l1 - l0) * u; point = a0 + (a1 - a0) * u;
      this.throwBlend = 1;
    } else this.throwBlend = Math.max(0, this.throwBlend - dt * 4);
    // Pin pulled: the grenade held up behind the shoulder, the free arm on the target, until thrown.
    const priming = throwing < 0 && (this.frame.flags & EntityFlags.Priming) !== 0;
    this.primeBlend += ((priming ? 1 : 0) - this.primeBlend) * (1 - Math.exp(-dt * 9));
    if (throwing < 0 && this.primeBlend > .001) {
      const b = this.primeBlend;
      hand = carry.clone().lerp(at('upper_arm_R', -.2, .1, .16), b); chestYaw = .55 * b; lean = -.05 * b; point = b;
    }
    this.carryBlend += (1 - this.carryBlend) * (1 - Math.exp(-dt * 10));
    // The chest winds and unwinds about the spine; the throw drives the body forward.
    if (chestYaw || lean) human.turnChest(new Quaternion().setFromAxisAngle(UP, chestYaw).multiply(new Quaternion().setFromAxisAngle(right, lean)));
    const handRot = human.handMatrix('R');
    const rot = new Quaternion().setFromRotationMatrix(new Matrix4().extractRotation(handRot));
    const palm = human.assets.hands.R.palm.clone().multiplyScalar(human.group.getWorldScale(new Vector3()).x).applyQuaternion(rot);
    human.placeHand('R', new Matrix4().compose(hand.clone().sub(palm), rot, new Vector3(1, 1, 1)), this.carryBlend, Math.PI);
    if (point > .001) {
      // The free arm points at the target during the wind-up.
      const lp = at('upper_arm_L', .5, -.05, .12);
      const lrot = new Quaternion().setFromRotationMatrix(new Matrix4().extractRotation(human.handMatrix('L')));
      human.placeHand('L', new Matrix4().compose(lp, lrot, new Vector3(1, 1, 1)), point);
    }
    // The item in the palm (centred on its own bounds), gone once released.
    const key = this.weaponKey ?? '';
    let center = this.itemCenters.get(key);
    if (!center) {
      held.obj.matrix.identity(); held.obj.updateWorldMatrix(true, true);
      const box = new Box3().setFromObject(held.obj);
      center = held.obj.worldToLocal(box.getCenter(new Vector3()));
      this.itemCenters.set(key, center);
    }
    const palmM = human.palmMatrix('R'), normal = human.assets.hands.R.normal.clone().transformDirection(palmM);
    const p = new Vector3(), q = new Quaternion(), sc = new Vector3();
    palmM.decompose(p, q, sc);
    held.obj.updateWorldMatrix(true, false);
    const itemScale = new Vector3().setFromMatrixScale(this.weaponObjects.get(key)!.attach).multiply(new Vector3().setFromMatrixScale(held.obj.parent!.matrixWorld));
    const world = new Matrix4().compose(p.addScaledVector(normal, .03 * k), q, itemScale);
    world.multiply(new Matrix4().makeTranslation(-center.x, -center.y, -center.z));
    held.obj.matrix.copy(held.obj.parent!.matrixWorld.clone().invert().multiply(world));
    held.obj.matrixWorldNeedsUpdate = true;
    held.obj.visible = !(throwing > .55 && throwing < .95);
    // Posed after this frame's matrix pass: refresh the item's meshes now.
    held.obj.updateWorldMatrix(false, true);
    human.group.updateMatrixWorld(true);
  }

  private throwBlend = 0;
  private primeBlend = 0;
  private throwFromPrime = false;
  private carryBlend = 0;

  /** The held gun points along the aim (shots wait for it while it comes up). Bodies without
   * the recorded rig, or not holding a gun, are always ready. */
  gunReady(): boolean {
    const held = this.weaponKey ? this.weaponObjects.get(this.weaponKey) : undefined;
    if (!this.human || !held?.visual.aim || !held.obj.visible) return true;
    return this.boreError < GUN_READY_ANGLE;
  }

  /**
   * A melee weapon in the recorded right hand: its handle across the palm (blade out past the
   * index finger, the cutting edge leading like the knuckles). Long handles take the left hand
   * lower on the handle when it is close enough to reach without twisting the arm.
   */
  private holdMelee(held: { obj: Object3D; visual: WeaponVisual }): void {
    const human = this.human!, m = held.visual.melee!.held, frame = human.assets.hands.R;
    held.obj.matrix.copy(this.weaponObjects.get(this.weaponKey!)!.attach);
    held.obj.updateWorldMatrix(true, false);
    const scale = new Vector3().setFromMatrixScale(held.obj.matrixWorld).x;
    const hand = human.handMatrix('R'), handScale = new Vector3().setFromMatrixScale(hand).x;
    // In the hand's own frame (+Y along the fingers): a sword grip runs diagonally across the
    // palm, pommel at its heel, blade out past the thumb and index finger angled towards the
    // forearm's line, the cutting edge leading with the knuckles.
    const across = frame.across.clone().normalize(), fingers = new Vector3(0, 1, 0);
    const bladeL = across.clone().negate().multiplyScalar(Math.cos(SWORD_GRIP_TILT)).addScaledVector(fingers, Math.sin(SWORD_GRIP_TILT)).normalize();
    const edgeL = fingers.clone().addScaledVector(bladeL, -fingers.dot(bladeL)).normalize();
    const axis = m.axis.clone().normalize(), edge = m.edge.clone().addScaledVector(axis, -m.edge.dot(axis)).normalize();
    const rotation = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(bladeL, edgeL, new Vector3().crossVectors(bladeL, edgeL))
      .multiply(new Matrix4().makeBasis(axis, edge, new Vector3().crossVectors(axis, edge)).transpose()));
    const s = scale / handScale;
    const center = frame.palm.clone().addScaledVector(frame.normal.clone().normalize(), .016 / handScale);
    const local = new Matrix4().compose(center.sub(m.grip.clone().multiplyScalar(s).applyQuaternion(rotation)), rotation, new Vector3(s, s, s));
    const world = hand.clone().multiply(local);
    held.obj.matrix.copy(held.obj.parent!.matrixWorld.clone().invert().multiply(world));
    held.obj.matrixWorldNeedsUpdate = true;
    held.obj.updateWorldMatrix(false, true);
    const scaleV = new Vector3(scale, scale, scale);
    // Two-handed: the left palm on the weapon's own support point (Studio "Tay đỡ"), also through
    // recorded swings; without one, long weapons take it a little lower on the handle (not mid-swing).
    const supportAt = held.visual.twoHandGrip?.support;
    if (supportAt || ((held.visual.spec?.length ?? 0) >= .8 && !this.recAction)) {
      const second = (supportAt ? supportAt.clone() : m.grip.clone().addScaledVector(axis, -.13 / Math.max(.01, scaleV.x))).applyMatrix4(world);
      const leftHand = human.handMatrix('L'), rot = new Quaternion().setFromRotationMatrix(new Matrix4().extractRotation(leftHand));
      const palm = human.assets.hands.L.palm.clone().multiplyScalar(human.group.getWorldScale(new Vector3()).x).applyQuaternion(rot);
      if (second.distanceTo(new Vector3().setFromMatrixPosition(leftHand)) < .45) human.placeHand('L', new Matrix4().compose(second.sub(palm), rot, new Vector3(1, 1, 1)), .9);
    }
    human.group.updateMatrixWorld(true);
  }

  /**
   * A held weapon following the hand: the trigger hand is posed by the body (recorded arms, or
   * the rig's arm swinging with the steps), the weapon is placed in that hand by its grip, then
   * the other hand takes its second grip (handguard, lower on a long handle) if it has one.
   */
  private carryWeapon(held: { obj: Object3D; visual: WeaponVisual }, grasp: Record<Side, Grasp | null>, reach: Record<Side, Vector3 | null>, hands: Record<Side, HandPreset>, recorded: AvatarMocap | null,
    f: { dt: number; tuck: number; land: number; speed: number; fwd: Vector3 }): void {
    const human = this.human!, rig = this.rig!, v = held.visual;
    const trig: Side = (v.twoHandGrip?.triggerHand ?? 'right') === 'right' ? 'R' : 'L', sup: Side = trig === 'R' ? 'L' : 'R';
    // The weapon's grips in its own frame (unscaled, at the origin), from where the rig holds it.
    held.obj.updateWorldMatrix(true, false);
    const M = held.obj.matrixWorld, pos = new Vector3(), rot = new Quaternion(), scl = new Vector3();
    M.decompose(pos, rot, scl);
    const inv = rot.clone().invert();
    const local = (g: Grasp | null): Grasp | null => g && { ...g, center: g.center.clone().sub(pos).applyQuaternion(inv), axis: g.axis.clone().applyQuaternion(inv), approach: g.approach.clone().applyQuaternion(inv) };
    const trigLocal = local(grasp[trig]);
    let supLocal = local(grasp[sup]);
    if (v.melee && !this.oneShot && f.speed > .8) supLocal = null;
    const recordedArms = !!recorded?.arms;
    if (!recordedArms && grasp[trig] && v.melee) {
      // The rig's hand, swinging forward and back with the steps.
      this.carryPhase += f.speed * f.dt / 1.4 * Math.PI;
      const swing = Math.min(1, f.speed / 3) * .14 * SURVIVOR_SIZE;
      const shift = f.fwd.clone().multiplyScalar(Math.sin(this.carryPhase) * swing).add(new Vector3(0, Math.abs(Math.cos(this.carryPhase)) * swing * .25, 0));
      // On the move (not striking) a blade is carried low at the side, not held out in front.
      const relax = v.melee && !this.oneShot ? Math.min(1, f.speed / 1.5) : 0;
      const shoulder = (trig === 'R' ? rig.armR : rig.armL).getWorldPosition(new Vector3());
      const side = new Vector3(-f.fwd.z, 0, f.fwd.x).multiplyScalar(trig === 'R' ? 1 : -1);
      const low = shoulder.clone().addScaledVector(UP, -.58 * SURVIVOR_SIZE * this.model.scale.y).addScaledVector(f.fwd, .12).addScaledVector(side, .1);
      const center = grasp[trig]!.center.clone().lerp(low, relax * .75).add(shift);
      // The blade tips forward and down, the arm hanging.
      const axis = grasp[trig]!.axis.clone().lerp(f.fwd.clone().multiplyScalar(.8).add(new Vector3(0, -.6, 0)).normalize(), relax * .7).normalize();
      const approach = grasp[trig]!.approach.clone().addScaledVector(axis, -grasp[trig]!.approach.dot(axis)).normalize();
      grasp[trig] = { ...grasp[trig]!, center, axis, approach };
      if (relax > .5) grasp[sup] = null;
    } else if (recordedArms) grasp[trig] = null;
    grasp[sup] = null;
    if (recordedArms) { hands[trig] = 'fist'; reach[trig] = null; }
    human.poseFromDriver(rig, { dt: f.dt, grasp, reach, hands, plant: this.plantBlend, crouch: this.crouchBlend, tuck: f.tuck, land: recorded?.clip === 'jump' ? 0 : f.land, moving: f.speed > .025, grounded: (this.frame.flags & EntityFlags.Grounded) !== 0, ground: this.ground, mocap: recorded });
    human.group.updateMatrixWorld(true);
    // The weapon in the hand.
    const world = trigLocal ? human.objectInHand(trig, trigLocal, scl) : null;
    if (!world) return;
    held.obj.matrix.copy(held.obj.parent!.matrixWorld.clone().invert().multiply(world));
    held.obj.updateWorldMatrix(false, true);
    // The hands on their grips, now that the weapon is where the body put it (elbows staying on
    // the side the body has them).
    const q = new Quaternion(), p = new Vector3(), sc = new Vector3();
    world.decompose(p, q, sc);
    const placed = (g: Grasp): Grasp => ({ ...g, center: g.center.clone().applyQuaternion(q).add(p), axis: g.axis.clone().applyQuaternion(q), approach: g.approach.clone().applyQuaternion(q) });
    if (trigLocal) human.regrip(trig, placed(trigLocal));
    if (supLocal) human.regrip(sup, placed(supLocal), recordedArms ? undefined : new Vector3(0, -1, 0).addScaledVector(f.fwd, -.3));
    human.group.updateMatrixWorld(true);
  }

  /**
   * Which recorded clip plays now, and where in it: loops advance with the ground covered (so the
   * feet keep pace with the speed); the jump follows the vertical speed (take-off, top, landing).
   * Fades in and out, and from one clip to the next.
   */
  private stepRecordedMotion(): AvatarMocap | null {
    const flags = this.frame.flags;
    const swimming = (flags & EntityFlags.Swimming) !== 0, climbing = (flags & EntityFlags.Climbing) !== 0;
    const limp = !!this.ragdoll || (flags & (EntityFlags.Dead | EntityFlags.Downed | EntityFlags.Knocked)) !== 0;
    const rolling = this.cur.clip?.name === 'roll', recordedRoll = rolling && !!this.template.human?.clips.has('roll');
    const scaleClips = !!this.template.human?.clips.has('climb_up');
    const held = this.weaponKey ? this.weaponObjects.get(this.weaponKey) : undefined;
    const fwd = new Vector3(0, 0, -1).applyQuaternion(this.root.getWorldQuaternion(new Quaternion()));
    fwd.y = 0; fwd.normalize();
    return this.pickMocap(held, recordedRoll ? Math.min(1, this.cur.time / this.cur.clip!.length) : null,
      limp || swimming || (rolling && !recordedRoll) || ((climbing || !!this.mantleGrip) && !scaleClips) || this.planning || this.drivingActive || this.flightActive,
      !(flags & EntityFlags.Grounded) && !swimming && !climbing, fwd);
  }

  private pickMocap(held: { visual: WeaponVisual } | undefined, roll: number | null, busy: boolean, airborne: boolean, fwd: Vector3): AvatarMocap | null {
    const clips = this.template.human?.clips;
    if (!clips) return null;
    const { speed, vy, dt, dx, dz, flags } = this.frame;
    const gun = !!held?.visual.aim, melee = !!held?.visual.melee;
    const aiming = (flags & (EntityFlags.Aiming | EntityFlags.Attacking)) !== 0;
    // In a match the rifle is carried ready (raised to the hip) except while sprinting.
    const ready = aiming || (this.mocapIdle === null && (flags & EntityFlags.Sprinting) === 0);
    const posture: Posture = flags & EntityFlags.Prone ? 2 : flags & EntityFlags.Crouching ? 1 : 0;
    this.aimClipTime += dt;
    if (this.pistolDraw >= 0) this.pistolDraw = this.pistolDraw < PISTOL_DRAWN ? this.pistolDraw + dt : PISTOL_DRAWN;
    this.sinceShot = flags & EntityFlags.Attacking ? 0 : this.sinceShot + dt;
    this.lastKick += dt;
    const distance = Math.hypot(dx, dz);
    const climbingNow = (flags & EntityFlags.Climbing) !== 0, mantlingNow = !!this.mantleGrip;
    // A lunge's travel is the recording's own steps: no running lean, bob or forward alignment on top.
    const moving = !busy && !airborne && !climbingNow && !mantlingNow && !this.recAction?.lunge && speed > .025 && distance > 1e-6;
    // Snaps on with the first step, releases gently so stopping does not swing the trunk.
    const aligning = this.viewAligned && moving && posture === 0 && roll === null;
    this.forwardBlend += ((aligning ? 1 : 0) - this.forwardBlend) * (1 - Math.exp(-dt * (aligning ? 24 : 5)));
    // Physics has already moved the player: a preparatory stance clip cannot hold the feet.
    if (busy || airborne || roll !== null || moving) this.postureMotion.reset(posture);
    const transition = busy || airborne || roll !== null || moving ? null : this.postureMotion.step(posture, dt, (id) => clips.get(id)?.duration ?? 0);
    const ahead = (dx * fwd.x + dz * fwd.z) / Math.max(1e-6, distance);
    const sideways = (-dx * fwd.z + dz * fwd.x) / Math.max(1e-6, distance);
    const strafe = Math.abs(sideways) > Math.abs(ahead) + .1;
    const direction = this.facingTravel ? 'forward' : strafe ? sideways > 0 ? 'right' : 'left' : ahead < 0 ? 'backward' : 'forward';
    this.gait = locomotionGait(speed, (flags & EntityFlags.Sprinting) !== 0, this.gait);
    const standingMove = locomotionClip(this.gait, direction, gun);
    const legId = !moving || roll !== null ? null : posture === 2 ? 'prone_forward' : posture === 1 ? `crouch_${direction}`
      : standingMove;
    // Crawl is one coordinated hand/hip/knee cycle; a separate leg clock breaks that contact.
    // Turning on the spot: the feet step round with the recorded turns (about a quarter turn each).
    this.stepTurnRate += (this.bodyTurnRate - this.stepTurnRate) * (1 - Math.exp(-dt * 8));
    // A turntable preview (rigid) spins the whole model: no stepping round.
    const turning = !this.rigid && !moving && posture === 0 && roll === null && !airborne && !busy && !this.recAction && (this.turningInPlace || Math.abs(this.stepTurnRate) > 1.2);
    const turnClip = this.stepTurnRate > 0 ? 'turn_left' : 'turn_right';
    // Steps keep a steady cadence through the turn (at least one step per ~0.6 s).
    const legs = turning && clips.has(turnClip)
      ? this.stepLegs(turnClip, dt, 0, false, Math.max(.9, Math.abs(this.stepTurnRate)) / (Math.PI / 2) * clips.get(turnClip)!.duration)
      : this.stepLegs(posture === 2 || this.recAction?.lunge ? null : legId, dt, speed, false);
    // Start Run is not played: it opens by leaning back, so the legs look as if they drag the body.
    this.startRunTime = null;
    let want: string | null = null;
    // With a gun or weapon in hand the dive roll (Running Dive Roll); empty-handed the plain roll.
    if (roll !== null) want = held && clips.has('roll_armed') ? 'roll_armed' : 'roll';
    else if (!busy) {
      // A recorded move (blade combo step, punch) plays over locomotion; legs keep stepping.
      if (climbingNow) want = vy < -.1 ? 'climb_down' : 'climb_up';
      // Over a ledge: the recording the climb follows (Braced Hang To Crouch below head height,
      // Climbing above), else reach and pull, then up onto it.
      else if (mantlingNow) want = this.mantleClip && clips.has(MANTLE_CLIP_NAMES[this.mantleClip.kind]) ? MANTLE_CLIP_NAMES[this.mantleClip.kind] : this.mantleK < MANTLE_PULL ? 'climb_up' : 'hang_to_crouch';
      else if (this.recAction && posture !== 2 && !airborne) want = this.recAction.clip;
      else if (airborne && (this.airTime > .08 || vy > 1) || this.landT > 0) want = 'jump';
      else if (transition) want = transition.clip;
      else if (posture === 2) want = moving ? 'prone_forward' : Math.abs(this.bodyTurnRate) > .18 ? this.bodyTurnRate > 0 ? 'prone_turn_left' : 'prone_turn_right' : 'prone_rifle';
      else if (posture === 1) want = moving ? `crouch_${direction}` : 'rifle_kneel_idle';
      else if (moving) {
        want = standingMove;
      } else if (gun) want = ready ? 'rifle_aim_idle' : this.mocapIdle ?? 'rifle_idle';
      // A grenade, tool or detonator: the relaxed recorded stance; the hand carries the item.
      else if (held && !melee) want = this.mocapIdle ?? 'rifle_idle';
      else if (this.mocapIdle && speed < .2) want = this.mocapIdle;
      // Empty hands or a melee weapon: standing relaxed (the turn recording's first frame).
      else if (!gun && clips.has(NEUTRAL_IDLE)) want = NEUTRAL_IDLE;
    }
    const clip = want ? clips.get(want) : undefined;
    if (!clip) want = null;
    const cur = this.mocap;
    // Ease the carried rifle back from a run without snapping the firing wrist on arrival.
    // Departures answer quickly (the torso must not lag behind the first step); settling is softer.
    const blendRate = isRoll(want) || want === 'jump' || isRoll(cur?.clip) || want === this.recAction?.clip ? 16 : moving ? 14 : !moving && gun && !transition && posture === 0 ? 4.5 : 10;
    const k = 1 - Math.exp(-Math.max(dt, 0) * blendRate);
    // Each outgoing layer retains its own playback direction. Interrupted blends never collapse
    // to a single source clip; that would pop the arms/hips on quick direction or stance changes.
    for (const layer of this.mocapLayers) {
      const stepping = legs.find((l) => l.clip === layer.clip);
      if (stepping) layer.time = stepping.time;
      else layer.time += dt * (layer.rate ?? 1);
      layer.weight *= 1 - k;
    }
    if (!want || !clip) {
      this.mocapLayers = this.mocapLayers.filter((l) => l.weight > .0005);
      if (!cur || !this.mocapLayers.length) { this.mocap = null; return null; }
      return (this.mocap = { ...cur, weight: this.mocapLayers.reduce((s, l) => s + l.weight, 0), layers: this.mocapLayers.map((l) => ({ ...l })), legs, upper: null, action: null, aim: undefined });
    }
    let layer = this.mocapLayers.find((l) => l.clip === want);
    const advancedRate = layer?.rate ?? (layer ? 1 : 0);
    if (!layer) {
      const phase = cur && clip.loop && clips.get(cur.clip)?.loop ? (cur.time / Math.max(1e-6, clips.get(cur.clip)!.duration)) % 1 : 0;
      // A body seen for the first time (spawn, a player coming into view) starts in its recording
      // rather than fading in from the bind pose (and switching pose methods once faded in).
      layer = { clip: want, time: want === this.mocapIdle ? Math.random() * clip.duration : phase * clip.duration, weight: cur ? 0 : 1 };
      this.mocapLayers.push(layer);
    }
    layer.weight = Math.min(1, layer.weight + k);
    let rate = 1, time = layer.time, jumpInAir = false;
    const acting = !!this.recAction && want === this.recAction.clip;
    if (acting) { time = this.recAction!.from + this.recAction!.t * this.recAction!.rate; rate = this.recAction!.rate; }
    else if (want === NEUTRAL_IDLE) { time = 0; rate = 0; }
    else if (climbingNow) { rate = Math.abs(vy) / LADDER_STRIDE * clip.duration; time = layer.time + dt * (rate - advancedRate); }
    else if (mantlingNow && this.mantleClip && want === MANTLE_CLIP_NAMES[this.mantleClip.kind]) { rate = 0; time = this.mantleClip.time; }
    else if (mantlingNow) {
      rate = 0;
      time = want === 'climb_up' ? this.mantleK / MANTLE_PULL * clip.duration * .5 : clip.duration * (.45 + .55 * (this.mantleK - MANTLE_PULL) / (1 - MANTLE_PULL));
    }
    else if (transition) { time = transition.time; rate = transition.rate; }
    else if (want === 'rifle_start_run') time = this.startRunTime ?? 0;
    // The dive roll's recording runs in first and gets up slowly: the gameplay roll plays its dive,
    // tumble and rise (0.55–1.75 s) — otherwise the running steps would eat most of the roll.
    else if (want === 'roll_armed') time = ARMED_ROLL[0] + roll! * (ARMED_ROLL[1] - ARMED_ROLL[0]);
    else if (isRoll(want)) time = roll! * clip.duration;
    else if (want === 'jump') {
      const p = jumpPhases(clip);
      // Falling ends at the recorded touch-down; on the ground the recording plays on from there
      // (its landing crouch, then standing up).
      const target = airborne ? vy > 0 ? p.takeoff + (p.apex - p.takeoff) * smooth(5, 0, vy) : p.apex + (p.touch - p.apex) * smooth(0, 6, -vy) : p.touch + (p.end - p.touch) * smooth(0, 1, 1 - this.landT / LAND_SEC);
      // One jump runs forward through its recording, at most a few times its speed: touching down
      // short of the recorded landing (a low hop, a slow fall) used to snap the hips straight into
      // the deepest crouch in one frame. A fresh take-off starts over.
      const fresh = layer.weight <= k + .02 || (airborne && vy > 0 && target < time - .3);
      time = fresh ? target : Math.max(time - dt, Math.min(target, time - dt + dt * JUMP_CATCH_UP));
      jumpInAir = time < p.touch;
    } else if (want.startsWith('prone_turn_')) {
      rate = Math.min(2, Math.abs(this.bodyTurnRate) / 1.5);
    } else if (want === 'prone_rifle') {
      // Idle is the supplied firing stance, without a phantom recoil loop between shots.
      if (!(flags & EntityFlags.Attacking) && this.proneShotFor <= 0) { time = 0; rate = 0; }
    } else if (moving && clip.loop) {
      rate = cadence(clip, speed);
      if (posture === 2 && ahead < -.2) rate = -rate;
    }
    // Undo the generic time step and apply the current locomotion rate, including reverse crawl.
    if (!acting && want !== NEUTRAL_IDLE && !climbingNow && !mantlingNow && !transition && want !== 'jump' && !isRoll(want) && want !== 'rifle_start_run' && !(want === 'prone_rifle' && rate === 0)) time += dt * (rate - advancedRate);
    // Torso and feet sample the same phase, including during walk/run/direction crossfades.
    const step = moving && want === legId ? legs.find((l) => l.clip === want) : undefined;
    if (step) { time = step.time; rate = step.rate ?? rate; }
    layer.time = time; layer.rate = rate;
    this.mocapLayers = this.mocapLayers.filter((l) => l === layer || l.weight > .0005);
    const weight = this.mocapLayers.reduce((s, l) => s + l.weight, 0);
    const standingAim = gun && !busy && posture === 0 && !transition && !isRoll(want);
    // Forward running uses Rifle Run directly. Side/back legs keep their directional recording,
    // with Rifle Run (rather than the standing idle) supplying their moving rifle posture.
    const pistol = this.stance === 'pistol' && clips.has('pistol_draw') && clips.has('pistol_shoot');
    const sighted = (flags & EntityFlags.Aiming) !== 0;
    const upperId = pistol
      ? this.pistolDraw >= 0 && this.pistolDraw < PISTOL_DRAWN ? 'pistol_draw' : sighted ? 'pistol_shoot' : this.sinceShot < .6 ? 'pistol_hip' : 'pistol_hold'
      : ready ? moving && !airborne && this.gait !== 'walk' ? 'rifle_run' : 'rifle_aim_idle' : 'rifle_idle';
    // The upper-body overlay crossfades like the base (a hard switch, e.g. on stopping,
    // pops the arms and gun in one frame).
    const activeUpper = standingAim && clips.has(upperId) ? upperId : null;
    // Linear progress over UPPER_FADE seconds, eased on output: a soft start and finish.
    // (A pistol comes up to point twice as fast: a shot waits for the gun to be on the aim.)
    const upperFade = Math.max(dt, 0) / (pistol ? UPPER_FADE / 2 : UPPER_FADE);
    for (const l of this.upperLayers) { l.time += dt; l.weight = l.clip === activeUpper ? Math.min(1, l.weight + upperFade) : Math.max(0, l.weight - upperFade); }
    if (activeUpper && !this.upperLayers.some((l) => l.clip === activeUpper)) this.upperLayers.push({ clip: activeUpper, time: this.aimClipTime, weight: upperFade });
    // Pistol layers keep their own times: the draw as it plays, the held frames still, the
    // Shooting clip's recoil only around a shot.
    for (const l of this.upperLayers) {
      if (l.clip === 'pistol_draw') l.time = Math.max(0, this.pistolDraw);
      else if (l.clip === 'pistol_hold') l.time = PISTOL_HOLD;
      else if (l.clip === 'pistol_hip') l.time = PISTOL_HIP;
      // Shooting holds its steady first frame; a shot plays the recorded recoil (from 0.2 s in) to
      // the end, which returns to that same steady frame, within PISTOL_RECOIL_SPAN.
      else if (l.clip === 'pistol_shoot') { const d = clips.get('pistol_shoot')!.duration; l.time = this.lastKick < PISTOL_RECOIL_SPAN ? PISTOL_RECOIL + (d - PISTOL_RECOIL) * this.lastKick / PISTOL_RECOIL_SPAN : 0; }
    }
    const syncUpper = this.upperLayers.find((l) => l.clip === activeUpper);
    if (syncUpper && moving && !airborne && upperId === 'rifle_run') syncUpper.time = time / clip.duration * clips.get(upperId)!.duration;
    this.upperLayers = this.upperLayers.filter((l) => l.weight > .001);
    const uppers = this.upperLayers.map((l) => ({ ...l, weight: easeWeight(l.weight) * this.pointBlend }));
    const reloadClip = usesRifleReload(this.weaponId) && gun && !busy && want !== 'jump' && !isRoll(want) ? clips.get('rifle_reload') : undefined;
    const action = reloadClip && this.reloadAnim ? rifleReloadLayer(this.reloadAnim.t, this.reloadAnim.dur, reloadClip.duration) : null;
    return (this.mocap = {
      // Climbs ride on the physics' own rise: their recorded hip lift would climb twice.
      // (The jump's recorded rise too, until its touch-down: the body may land before the recording does.)
      clip: want, time, weight, hips: (want !== 'jump' || (!airborne && !jumpInAir)) && !climbingNow && !mantlingNow,
      // A ledge climb puts the hips where the recording has them over the ledge.
      ...(mantlingNow && this.mantleClip && want === MANTLE_CLIP_NAMES[this.mantleClip.kind] ? { hipsAt: this.mantleHips(layer.weight) } : {}),
      arms: gun ? (!this.reloadAnim || !!action) && !isRoll(want) : true,
      ground: isRoll(want) || posture === 2 || want === 'crouch_to_prone',
      layers: this.mocapLayers.map((l) => ({ ...l, weight: easeWeight(l.weight) })), legs, upper: null, uppers, action, alignForward: this.forwardBlend,
      bob: this.bobScale += ((gun && moving && posture === 0 ? ready ? .4 : .55 : 1) - this.bobScale) * (1 - Math.exp(-dt * 6)),
      // Calmer running: less pelvis sway with a gun, less arm pumping with empty hands.
      damp: moving && posture === 0 ? gun ? { hips: .5 } : { arms: .35, hips: .2 } : undefined,
      lean: this.forwardLean(moving && posture === 0 && !airborne && roll === null ? ahead * speed : 0, dt, (flags & EntityFlags.Aiming) !== 0),
      aim: gun && !transition && !busy && want !== 'jump' && !isRoll(want)
        ? { yaw: this.headYaw * .8, pitch: Math.max(posture === 2 ? -.15 : -.5, Math.min(posture === 2 ? .15 : .5, this.aimPitch * .55)), weight: this.sightBlend * (1 - (action?.weight ?? 0)), rifle: this.stance === 'rifle' && posture === 0 && aiming } : undefined,
    });
  }

  private leanSpeed = 0;
  private leanAccel = 0;
  private leanAngle = 0;
  private leanVel = 0;

  /** Forward lean (radians) from forward speed and its change: into a departure, upright when
   * braking; much less while aiming down the sights. Smoothed so it never pops. */
  private forwardLean(forwardSpeed: number, dt: number, sighted: boolean): number {
    if (dt <= 0) return this.leanAngle;
    const accel = (forwardSpeed - this.leanSpeed) / dt;
    this.leanSpeed = forwardSpeed;
    this.leanAccel += (accel - this.leanAccel) * (1 - Math.exp(-dt * 10));
    const target = Math.max(-.08, Math.min(.32, .035 * forwardSpeed + .045 * this.leanAccel)) * (sighted ? .3 : 1);
    [this.leanAngle, this.leanVel] = springFree(this.leanAngle, this.leanVel, target, dt, .14);
    return this.leanAngle;
  }

  /** Start stepping on the first displaced frame, paced by distance even while the torso is
   * playing Start Run. Idle breathing phase must never choose a random phase for the first step. */
  private stepLegs(id: string | null, dt: number, speed: number, reverse: boolean, turnRate?: number): MocapLayer[] {
    const clips = this.template.human!.clips;
    const previous = this.legLayers.reduce<MocapLayer | null>((best, l) => !best || l.weight > best.weight ? l : best, null);
    // Departures answer on the first frame; changing an established gait gives the outgoing
    // foot time to release instead of pulling it across the body in one or two frames.
    const changingGait = this.legLayers.some((l) => l.clip !== id && l.weight > .0005);
    const decay = Math.exp(-Math.max(0, dt) * (changingGait ? 18 : 36));
    let active = this.legLayers.find((l) => l.clip === id);
    if (id && !active && clips.has(id)) {
      const phase = previous && clips.has(previous.clip) ? previous.time / clips.get(previous.clip)!.duration % 1 : 0;
      active = { clip: id, time: phase * clips.get(id)!.duration, weight: 0 };
      this.legLayers.push(active);
    }
    const reference = active ?? previous;
    if (reference && turnRate === undefined) {
      this.stepPhase += stepLoops(clips.get(reference.clip)!, speed) * dt * (reverse ? -1 : 1);
    }
    for (const layer of this.legLayers) {
      const clip = clips.get(layer.clip)!;
      const rate = layer === active && turnRate !== undefined ? turnRate : cadence(clip, speed) * (reverse ? -1 : 1);
      // (An outgoing turn holds its last frame while it fades: put on the step clock it snapped
      // the feet back to the turn's first frame.)
      if (turnRate === undefined) { if (clip.loop || layer === active) layer.time = this.stepPhase * clip.duration; }
      else layer.time += dt * rate;
      // One-shot turns repeat while the turn goes on.
      if (!clip.loop) layer.time %= clip.duration;
      layer.rate = rate;
      layer.weight = layer.weight * decay + (layer === active ? 1 - decay : 0);
    }
    this.legLayers = this.legLayers.filter((l) => l.weight > .0005);
    return this.legLayers.map((l) => ({ ...l }));
  }

  /** Lobby: plays a recorded idle (when the model has it) while standing still. */
  setMocapIdle(name: string | null): boolean {
    this.mocapIdle = name && this.template.human?.clips.has(name) ? name : null;
    return !!this.mocapIdle;
  }

  /** Both hands on the held weapon: grip and handguard, or the magazine change of a reload. */
  private holdWeapon(held: { obj: Object3D; visual: WeaponVisual }, grasp: Record<Side, Grasp | null>, hands: Record<Side, HandPreset>, fwd: Vector3, right: Vector3): void {
    const v = held.visual;
    held.obj.updateWorldMatrix(true, false);
    const trig: Side = (v.twoHandGrip?.triggerHand ?? 'right') === 'right' ? 'R' : 'L';
    const sup: Side = trig === 'R' ? 'L' : 'R';
    const sign = trig === 'R' ? 1 : -1;
    if (v.aim) {
      let M = held.obj.matrixWorld;
      const barrel = v.aim.barrel.clone().transformDirection(M);
      const up = v.aim.up.clone().transformDirection(M);
      up.addScaledVector(barrel, -up.dot(barrel)).normalize();
      const side = new Vector3().crossVectors(barrel, up).normalize();
      const recordedReload = usesRifleReload(this.weaponId) && this.template.human?.clips.has('rifle_reload');
      const reload = this.reloadAnim && !recordedReload ? Math.min(1, this.reloadAnim.t / this.reloadAnim.dur) : -1;
      // The block character held guns at arm's length: bring the gun in along its barrel until
      // the support hand reaches the handguard (the firing hand follows the grip).
      const supportAt = v.twoHandGrip?.support ?? (this.stance !== 'pistol' && v.muzzle ? v.aim.grip.clone().lerp(v.muzzle, .45) : null);
      let pull = 0;
      if (supportAt) {
        const shoulder = (sup === 'L' ? this.rig!.armL : this.rig!.armR).getWorldPosition(new Vector3());
        const trigShoulder = (sup === 'L' ? this.rig!.armR : this.rig!.armL).getWorldPosition(new Vector3());
        const reachMax = SUPPORT_REACH * this.model.scale.y;
        const guard = supportAt.clone().applyMatrix4(M), grip = v.aim.grip.clone().applyMatrix4(M);
        for (let it = 0; it < 3; it++) {
          const d = guard.clone().addScaledVector(barrel, -pull).distanceTo(shoulder);
          if (d <= reachMax) break;
          const along = guard.clone().addScaledVector(barrel, -pull).sub(shoulder).normalize().dot(barrel);
          if (along < .2) break;
          pull += (d - reachMax) / along;
        }
        // Never so far that the firing hand is jammed into its own shoulder.
        const room = grip.distanceTo(trigShoulder) - .2;
        pull = Math.max(0, Math.min(pull, room, .4));
      }
      const cant = reload >= 0 ? smooth(0, .1, reload) * (1 - smooth(.86, 1, reload)) : 0;
      if (pull > 0 || cant > 0) {
        // Reloading: the gun also cants towards the support hand and comes in a little.
        const pivot = v.aim.grip.clone().applyMatrix4(M);
        const shift = barrel.clone().multiplyScalar(-pull - .06 * cant).addScaledVector(up, -.03 * cant);
        const world = new Matrix4().makeTranslation(pivot.x + shift.x, pivot.y + shift.y, pivot.z + shift.z)
          .multiply(new Matrix4().makeRotationAxis(barrel, .45 * cant * sign))
          .multiply(new Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z))
          .multiply(M);
        held.obj.matrix.copy(held.obj.parent!.matrixWorld.clone().invert().multiply(world));
        held.obj.updateWorldMatrix(false, true);
        M = held.obj.matrixWorld;
        barrel.copy(v.aim.barrel).transformDirection(M);
        up.copy(v.aim.up).transformDirection(M).addScaledVector(barrel, -up.dot(barrel)).normalize();
        side.crossVectors(barrel, up).normalize();
      }
      const gripC = v.aim.grip.clone().applyMatrix4(M);
      // A pistol grip rakes back: up the grip goes a little forward.
      const handle = up.clone().multiplyScalar(.94).addScaledVector(barrel, .34).normalize();
      grasp[trig] = { center: gripC, axis: handle, approach: side.clone().multiplyScalar(-sign).addScaledVector(barrel, .35).normalize(), radius: .017, trigger: true };
      let guard: Vector3 | null = null;
      if (v.twoHandGrip) guard = v.twoHandGrip.support.clone().applyMatrix4(M).addScaledVector(up, .014);
      else if (this.stance !== 'pistol' && v.muzzle) guard = v.aim.grip.clone().lerp(v.muzzle, .45).applyMatrix4(M).addScaledVector(up, -.01);
      const guardGrasp: Grasp = guard
        ? { center: guard, axis: barrel.clone(), approach: up.clone().addScaledVector(side, .35 * sign).normalize(), radius: .021 }
        // Pistols: the support hand cups the firing hand.
        : { center: gripC.clone().addScaledVector(side, -.03 * sign).addScaledVector(handle, -.012), axis: handle.clone(), approach: side.clone().multiplyScalar(sign).addScaledVector(up, .25).normalize(), radius: .03 };
      grasp[sup] = guardGrasp;
      if (reload >= 0 && reload < 1) {
        const far = v.twoHandGrip?.support ?? v.muzzle ?? v.aim.grip;
        const mag = v.aim.grip.clone().lerp(far, guard ? .3 : 0).applyMatrix4(M).addScaledVector(up, guard ? -.045 : -.09);
        const pouch = this.bones.get('body')!.node.localToWorld(new Vector3(-.17 * sign, -.12, -.08).multiplyScalar(SURVIVOR_SIZE));
        const charge = (v.eject ? v.eject.clone().applyMatrix4(M) : mag.clone().addScaledVector(up, .11)).addScaledVector(side, .02 * sign);
        const keys: Array<[number, Vector3, HandPreset]> = [
          [0, guardGrasp.center, 'ready'], [.12, mag, 'fist'], [.26, mag.clone().addScaledVector(up, -.13), 'fist'],
          [.4, pouch, 'fist'], [.48, pouch, 'fist'], [.62, mag.clone().addScaledVector(up, -.12), 'fist'],
          [.72, mag, 'fist'], [.76, mag.clone().addScaledVector(up, .014), 'open'], [.84, charge, 'pinch'],
          [.9, charge.clone().addScaledVector(barrel, -.07), 'pinch'], [.95, charge, 'pinch'], [1, guardGrasp.center, 'ready'],
        ];
        if (reload > .04 && reload < .97) {
          let i = 0;
          while (i < keys.length - 2 && reload > keys[i + 1]![0]) i++;
          const [t0, p0] = keys[i]!, [t1, p1, preset] = keys[i + 1]!;
          const at = p0.clone().lerp(p1, smooth(t0, t1, reload));
          grasp[sup] = null;
          hands[sup] = preset;
          this.reloadReach = at;
          this.reloadSide = sup;
        }
      }
    } else if (v.melee) {
      const M = held.obj.matrixWorld;
      const axis = v.melee.held.axis.clone().transformDirection(M);
      const center = v.melee.held.grip.clone().applyMatrix4(M);
      const palm = right.clone().multiplyScalar(-sign);
      palm.addScaledVector(axis, -palm.dot(axis));
      if (palm.lengthSq() < 1e-4) palm.copy(fwd).addScaledVector(axis, -fwd.dot(axis));
      palm.normalize();
      grasp[trig] = { center, axis, approach: palm, radius: .016 };
      // Long handles: the other hand lower on the handle whenever the rig brings it close.
      if ((v.spec?.length ?? 0) >= .8) {
        const second = center.clone().addScaledVector(axis, -.13);
        const other = (sup === 'L' ? this.rig!.handL : this.rig!.handR).localToWorld(HAND_GRIP.clone());
        if (other.distanceTo(second) < .4) grasp[sup] = { center: second, axis: axis.clone(), approach: palm.clone(), radius: .016 };
      }
    } else hands[trig] = 'fist';
  }

  private readonly readyTarget = new Vector3();
  private readonly readyShoulder = new Vector3();
  /**
   * Survivor: the firing hand brings the gun's grip in front of the firing shoulder (a rifle low at
   * the chest, raised to the eye when aiming; a pistol pushed out between both hands), following
   * the aim's elevation. The block character's straight arms held guns out at arm's length.
   */
  private holdGunReady(side: 'left' | 'right', weight: number): void {
    const arm = this.bones.get(`arm_${side}`)?.node, hand = this.bones.get(`hand_${side}`)?.node, body = this.bones.get('body')?.node;
    if (!arm || !hand || !body) return;
    const pistol = this.stance === 'pistol', s = side === 'right' ? 1 : -1, a = this.aimBlend;
    const t = this.readyTarget.set(pistol ? .04 * s : (.11 - .015 * a) * s, (pistol ? .3 : .24) + .07 * a, pistol ? -.44 : -.3 + .03 * a).multiplyScalar(SURVIVOR_SIZE);
    // Elevation: turned about the shoulder like the arms.
    t.sub(arm.position).applyAxisAngle(X_AXIS, this.aimPitch).add(arm.position);
    body.updateWorldMatrix(true, false);
    body.localToWorld(t);
    reachFor(arm, hand, t, weight);
    arm.getWorldPosition(this.readyShoulder);
    const length = this.readyShoulder.distanceTo(t) / Math.max(.01, this.model.scale.y) + HAND_GRIP.y;
    hand.position.setLength(hand.position.length() + (length - hand.position.length()) * weight);
  }

  private reloadReach: Vector3 | null = null;
  private reloadSide: Side = 'L';

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
    // Survivor: a gun or blade is held closer than at arm's length, the elbows bent.
    if (this.template.human) {
      const k = this.weaponId ? (this.stance === 'rifle' ? .74 : this.stance === 'pistol' ? .84 : this.stance === 'melee' ? .9 : 1) : 1;
      for (const name of ['hand_left', 'hand_right']) this.bones.get(name)?.node.position.multiplyScalar(k);
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
    this.heldMagazine.clear();
    // Each attachment combination is its own dressed copy of the gun.
    const key = itemId ? `${itemId}|${attachments?.optic ?? ''}|${attachments?.muzzle ?? ''}` : null;
    if (key === this.weaponKey) return;
    // Taking a pistol in hand: it is drawn (recorded), from the start.
    this.pistolDraw = itemId && ITEMS[itemId]?.stance === 'pistol' ? 0 : -1;
    if (this.weaponKey) {
      const old = this.weaponObjects.get(this.weaponKey);
      if (old) {
        old.obj.visible = false;
        this.resetWeaponPose(old.bones);
      }
    }
    this.weaponAnim = null;
    this.reloadAnim = null;
    const visual = itemId ? dressWeapon(weapons, itemId, attachments) : undefined;
    this.weaponId = visual ? itemId : null;
    this.weaponKey = visual ? key : null;
    if (!visual || !itemId || !key) return;
    let entry = this.weaponObjects.get(key);
    if (!entry) {
      const hand = this.bones.get(`hand_${visual.twoHandGrip?.triggerHand ?? 'right'}`)?.node;
      if (!hand) return;
      const obj = visual.object.clone(true);
      obj.matrixAutoUpdate = false;
      // Guns fitted at the survivor's real size are drawn larger on the stylised block characters.
      const attach = visual.attach.clone();
      const grow = !this.template.human && visual.heldScale ? BLOCK_GUN_SCALE / visual.heldScale : 1;
      if (grow !== 1 && visual.aim) {
        const g = visual.aim.grip;
        attach.multiply(new Matrix4().makeTranslation(g.x, g.y, g.z)).multiply(new Matrix4().makeScale(grow, grow, grow)).multiply(new Matrix4().makeTranslation(-g.x, -g.y, -g.z));
      }
      obj.matrix.copy(attach);
      const bones = new Map<string, Bone & { restScale: Vector3 }>();
      obj.traverse((o) => {
        if (o instanceof Mesh) o.castShadow = true;
        else if (o !== obj) bones.set(o.name, { node: o, restPos: o.position.clone(), restRot: o.rotation.clone(), restScale: o.scale.clone() });
      });
      hand.add(obj);
      entry = { obj, visual, attach, bones };
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
  /** One stowed weapon on the back (kept for callers that only know the first one). */
  setBackWeapon(itemId: string | null, weapons: WeaponLibrary | null): void {
    this.setGear({ ...this.gear, back: itemId ? [itemId] : [] }, weapons);
  }

  private gear: CarriedGear = { back: [], holster: null, belt: null, pack: null };
  private gearKey = '';
  private readonly gearObjects: Object3D[] = [];
  private backpack: BackpackInstance | null = null;
  private gearWeapons: WeaponLibrary | null = null;

  /**
   * Everything carried but not in hand: the backpack on the shoulders, long guns on the back
   * (hung muzzle down on the pack's sides and the third across its top when a pack is worn,
   * else slung diagonally), the pistol/SMG on the left belt hook, a grenade/C4 on the right.
   */
  setGear(gear: CarriedGear, weapons: WeaponLibrary | null): void {
    const key = `${gear.back.join(',')}|${gear.holster}|${gear.belt}|${gear.pack}|${weapons ? 1 : 0}`;
    if (key === this.gearKey) return;
    this.gearKey = key;
    this.gear = gear;
    this.gearWeapons = weapons;
    if (gear.pack && !this.backpack) {
      // Its mounts appear once the model has loaded: hang the guns again then.
      this.backpack = new BackpackInstance(() => { this.gearKey = ''; this.setGear(this.gear, this.gearWeapons); });
      (this.carryHooks.get('back_center') ?? this.bones.get('body')?.node)?.add(this.backpack.root);
      // The Studio's adjustment, in the hook's frame (turned about the straps' top).
      const rest = this.hookRest.get('back_center');
      adjustMatrix(adjustFor('military_backpack'), new Vector3(0, -.25, .1), rest ? rest.frame.clone().multiply(rest.q) : new Quaternion())
        .decompose(this.backpack.root.position, this.backpack.root.quaternion, this.backpack.root.scale);
    } else if (!gear.pack && this.backpack) {
      this.backpack.dispose();
      this.backpack = null;
    }
    for (const o of this.gearObjects) o.removeFromParent();
    this.gearObjects.length = 0;
    const scale = this.template.human ? 1 : BACK_SCALE;
    const sling = (itemId: string | null, anchor: Object3D | undefined, place: (g: Group, bounds: Box3, depth: number) => void, key = '') => {
      const display = itemId ? weapons?.get(itemId)?.display : undefined;
      if (!display || !anchor) return;
      const inner = display.clone(true);
      const box = new Box3().setFromObject(inner);
      inner.position.sub(box.getCenter(new Vector3()));
      inner.traverse((o) => { if (o instanceof Mesh) o.castShadow = true; });
      const g = new Group();
      g.name = 'stowed-weapon';
      g.add(inner);
      g.scale.setScalar(scale);
      place(g, box, (box.max.z - box.min.z) * scale);
      // The Studio's adjustment of this place, in the character's axes, about the weapon itself.
      // A weapon's own setting for this place wins over the place's.
      const a = key ? adjustFor(`${key}:${itemId}`) ?? adjustFor(key) : undefined;
      if (a) {
        const frame = this.restFrame(anchor);
        g.updateMatrix();
        adjustMatrix(a, g.position.clone(), frame).multiply(g.matrix).decompose(g.position, g.quaternion, g.scale);
      }
      anchor.add(g);
      this.gearObjects.push(g);
    };
    // Display models point along +X (muzzle), top +Y. In the hooks' frame the back is +Z and the
    // character's left +X. A crossbow (or a pistol stowed as the back item) hangs at the right hip.
    const atHip = (id: string | undefined) => id === 'crossbow' || ITEMS[id ?? '']?.stance === 'pistol';
    const hipRight = (g: Group) => { g.rotation.set(0, 0, -Math.PI / 2); const b = new Box3().setFromObject(g); g.position.set(.06 + b.max.x, -b.max.y, 0); };
    const mounts = this.backpack?.rifleMounts;
    if (gear.pack && mounts) {
      // On the pack's sides, muzzle down, flat against it; the third across the top. (Their own
      // Studio places: separate from the ones without a pack.)
      sling(gear.back[0] ?? null, mounts.right, (g) => { g.quaternion.setFromEuler(new Euler(0, Math.PI / 2, -Math.PI / 2)); }, 'sling:pack_1');
      sling(gear.back[1] ?? null, mounts.left, (g) => { g.quaternion.setFromEuler(new Euler(0, -Math.PI / 2, -Math.PI / 2)); }, 'sling:pack_2');
      sling(gear.back[2] ?? null, mounts.top, (g, _b, depth) => { g.position.z = depth / 2; }, 'sling:pack_3');
    } else if (!gear.pack) {
      // Slung diagonally across the back, the second the other way.
      if (atHip(gear.back[0])) sling(gear.back[0]!, this.carryHooks.get('hip_right'), hipRight, 'sling:back_1');
      else sling(gear.back[0] ?? null, this.carryHooks.get('back_right'), (g, _b, depth) => { g.rotation.set(0, 0, -Math.PI / 2 + .75); g.position.set(0, 0, depth / 2 + .03); }, 'sling:back_1');
      sling(gear.back[1] ?? null, this.carryHooks.get('back_left'), (g, _b, depth) => { g.rotation.set(0, 0, Math.PI / 2 - .75); g.position.set(0, 0, depth / 2 + .06); }, 'sling:back_2');
    }
    // Right hip: the pistol / SMG, muzzle down, outside the hip (the left when a crossbow or a
    // pistol carried as the back item already hangs on the right).
    // (The hip hooks sit wide for the block body: the holster is pulled in onto the survivor's hip.)
    const inset = this.template.human ? .07 : 0;
    const rightTaken = atHip(gear.back[0]) && !gear.pack;
    sling(gear.holster, this.carryHooks.get(rightTaken ? 'hip_left' : 'hip_right'), (g) => {
      g.rotation.set(0, 0, -Math.PI / 2);
      const b = new Box3().setFromObject(g);
      g.position.set(rightTaken ? inset : -inset, -b.max.y * .6, .02);
    }, 'sling:holster');
    // Left hip: a grenade or C4 clipped on.
    if (!(rightTaken && gear.holster)) sling(gear.belt, this.carryHooks.get('hip_left'), (g) => { g.position.set(inset, -.03, .03); }, 'sling:belt');
  }

  /** Put the held weapon on a separate hook while both hands are occupied. */
  private stowForInteraction(stow: boolean): void {
    if (this.interactionWeaponKey !== this.weaponKey) {
      this.interactionWeapon?.removeFromParent();
      this.interactionWeapon = null;
      this.interactionWeaponKey = this.weaponKey;
    }
    if (stow && !this.interactionWeapon && this.weaponKey) {
      const visual = this.weaponObjects.get(this.weaponKey)?.visual;
      const hook = this.carryHooks.get(this.stance === 'pistol' ? 'hip_left' : 'back_left');
      if (visual && hook) {
        const sling = new Group(), inner = visual.display.clone(true);
        inner.position.sub(new Box3().setFromObject(inner).getCenter(new Vector3()));
        sling.name = 'interaction-stowed-weapon';
        sling.add(inner);
        sling.rotation.z = -Math.PI / 2 - .45;
        hook.add(sling);
        this.interactionWeapon = sling;
      }
    }
    if (this.interactionWeapon) this.interactionWeapon.visible = stow;
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
    this.root.updateMatrixWorld(true);
    const entry = this.weaponKey ? this.weaponObjects.get(this.weaponKey) : undefined;
    const p = entry?.visual[kind];
    if (!entry || !p || !entry.obj.visible) return false;
    entry.obj.updateWorldMatrix(true, false);
    out.copy(p).applyMatrix4(entry.obj.matrixWorld);
    return true;
  }

  /** The actual bore in world space, after animation and hand placement. */
  weaponBore(origin: Vector3, direction: Vector3): boolean {
    if (!this.weaponPoint('muzzle', origin)) return false;
    const entry = this.weaponObjects.get(this.weaponKey!);
    if (!entry?.visual.aim) return false;
    direction.copy(entry.visual.aim.barrel).transformDirection(entry.obj.matrixWorld);
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
    this.stopFit();
    this.heldMagazine.clear();
    scene.remove(this.root);
    this.speaker?.material.dispose();
    this.human?.dispose();
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
