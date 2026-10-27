import {
  Bone,
  type BufferAttribute,
  BufferGeometry,
  Color,
  Euler,
  Float32BufferAttribute,
  Group,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Skeleton,
  SkinnedMesh,
  Sphere,
  type Texture,
  Vector3,
  type InterleavedBufferAttribute,
  type Material,
  type Object3D,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { SkinSurface, bindGarment } from './skin-surface';
import { HAIR_HEAD_AT, HairInstance, loadHairStyle } from './hair-style';
import { beardGeometry, beardMaterial, browMaterial, eyebrowGeometries, type FaceSkin } from './face-hair';
import { settingsStore, type TextureQuality } from '@/lib/settings';
import { handPose } from '../hand-studio';
import { BOOT_COLORS, DEFAULT_APPEARANCE, HAIR_COLORS, PANTS_COLORS, SKIN_TONES, TOP_COLORS, type Appearance, type HairStyle } from '@zion/shared';
import { addLocomotionClips, closeMocapLoop } from './locomotion';

/**
 * The survivor model: a skinned body on a 162-bone Rigify skeleton (hands with three-jointed
 * fingers, a face rig) with each garment and the hairstyle as separate meshes on the same
 * skeleton (models/characters/zion-survivor.glb, from scripts/prepare-character.mjs).
 *
 * Retargeted recordings drive the skin's locomotion, aim and reversible stance transitions.
 * The simple gameplay rig supplies fallback interaction poses and recoil. `HumanBody` blends
 * the recorded layers, shares camera turns through the spine, solves hand contacts with two-bone
 * IK, plants the feet/body on the floor and closes the fingers around the measured handle.
 */

export const HUMAN_MODEL_URL = '/models/characters/zion-survivor.glb';
/** Eye level of the source model (m); scaled so the eyes sit at the first-person camera height. */
export const MODEL_EYE_Y = 1.597;
/**
 * The survivor is drawn larger than a real person with its eyes at the camera's 1.62 m: weapons,
 * buildings and the map are sized for the stylised block character (≈2.2 m with hair).
 */
export const SURVIVOR_SIZE = 1.25;
export const HUMAN_SCALE = (1.62 / MODEL_EYE_Y) * SURVIVOR_SIZE;
/** Half thickness of the palm and fingers (m): the skin between the bones and a held handle. */
const PALM_SKIN = 0.013;
const FINGER_SKIN = 0.009;

export type Side = 'L' | 'R';
/** The standard hand shapes; any Hand Studio pose id is a hand shape too. */
export type BasicHandPreset = 'relaxed' | 'fist' | 'open' | 'ready' | 'pinch';
export type HandPreset = BasicHandPreset | (string & {});

/** A handle held in one hand. All vectors in world space. */
export interface Grasp {
  /** A point on the handle's centre line, where the palm closes. */
  center: Vector3;
  /** Along the handle: the index finger is on the +axis side, the little finger on −axis. */
  axis: Vector3;
  /** Palm normal: from the palm towards the handle's centre line. */
  approach: Vector3;
  /** Handle radius (m). */
  radius: number;
  /** The index finger rests on a trigger instead of wrapping round. */
  trigger?: boolean;
  /** Polar cross-sections measured from the actual weapon mesh, in world metres. */
  profile?: { key: string; rings: Array<{ offset: number; radii: number[] }> };
}

/** A recorded clip on this skeleton: local rotations per bone at evenly spaced frames. */
export interface Mocap {
  name: string; loop: boolean; duration: number; frames: number;
  /** Metres one loop covers on the ground. */
  stride: number;
  bones: Map<number, Float32Array>;
  /** Hips height offset per frame (model metres). */
  hipsY: number[];
}

/** Rigid gun placement in the recorded firing hand (see `HumanBody.rifleFit`). */
export interface RifleFit { inHand: Matrix4; support: Matrix4 | null }

export interface MocapLayer { clip: string; time: number; weight: number; rate?: number }
export interface MocapPose extends MocapLayer {
  arms: boolean; hips: boolean; ground?: boolean;
  /** Actual crossfade weights, retained across interruptions. Sum is at most one. */
  layers?: MocapLayer[];
  /** Responsive steps, independent of upper-body departure/stance preparation. */
  legs?: MocapLayer[];
  upper?: MocapLayer | null;
  /** Crossfading upper-body overlays (weights sum to at most one). */
  uppers?: MocapLayer[];
  /** Local upper-body interaction; retains locomotion hips and legs, including crouch/prone. */
  action?: MocapLayer | null;
  /** Forward lean of the upper body (radians, about the hips' right axis). */
  lean?: number;
  /** 0..1 towards the dominant clip's mean pose: calmer pelvis sway / arm swing. */
  damp?: { hips?: number; arms?: number };
  /** 0..1 of the recording's hip bounce (around its mean height); aiming on the move glides. */
  bob?: number;
  /** Remove the recording's baked sideways stance when locomotion follows the camera. */
  alignForward?: number;
  aim?: { yaw: number; pitch: number; weight: number; rifle?: boolean };
  /** Hips placed outright (body units: height above the feet, distance ahead), by `weight` (a ledge climb as recorded). */
  hipsAt?: { y: number; z: number; weight: number };
}

interface BoneDef { name: string; parent: number; position: Vector3; quaternion: Quaternion; scale: Vector3 }
interface HandFrame { palm: Vector3; normal: Vector3; across: Vector3 }
/** A clothing part; textured garments carry their own colour, normal and occlusion maps. */
interface HumanPart { geometry: BufferGeometry; slot: string; roughness: number; metalness: number; mean: Color; maps?: { map: Texture | null; normalMap: Texture | null; aoMap: Texture | null } }

export interface HumanAssets {
  bones: BoneDef[];
  index: Map<string, number>;
  inverses: Matrix4[];
  parts: Map<string, HumanPart>;
  hair: Map<string, BufferGeometry>;
  /** Forearms and hands only (first-person view). */
  arms: BufferGeometry;
  /** First-person arms in the shirt: the skin it covers left out, and its sleeves (when the model has a shirt). */
  armsDressed?: BufferGeometry;
  sleeves?: BufferGeometry;
  /** The body with the skin under the trousers and boots left out, with and without the top. */
  bodies: { top: BufferGeometry; bare: BufferGeometry };
  /** Bind pose in the model's own space (+Y up, facing +Z, +X = the character's left). */
  restP: Vector3[];
  restQ: Quaternion[];
  hands: Record<Side, HandFrame>;
  /** Motion-capture clips (scripts/add-character-anims.mjs), by name. */
  clips: Map<string, Mocap>;
}

/** A plain standing pose made from the bind pose (upright, level head, straight legs). */
export const STAND_CLIP = 'stand';

/**
 * The bind pose with the arms lowered to the sides, elbows a little bent and the fingers relaxed:
 * a clean neutral stance (recorded frames lean, tip the head back or carry a stance).
 */
function standPose(bones: BoneDef[], index: Map<string, number>, restQ: Quaternion[], restP: Vector3[]): Mocap {
  const world = restQ.map((q) => q.clone()), local = new Map<number, Quaternion>();
  const children = (i: number): number[] => bones.flatMap((b, j) => (b.parent === i ? [j, ...children(j)] : []));
  const turn = (i: number, r: Quaternion) => { for (const j of [i, ...children(i)]) world[j]!.premultiply(r); };
  for (const s of ['L', 'R'] as const) {
    const sign = s === 'L' ? 1 : -1, upper = index.get(`upper_arm_${s}`)!, fore = index.get(`forearm_${s}`)!, hand = index.get(`hand_${s}`)!;
    // Bones point along their +Y. The upper arm hangs down a little out from the body (the
    // model faces +Z, +X is its left); the forearm nearly straight, a touch forward.
    const along = (i: number) => new Vector3(0, 1, 0).applyQuaternion(world[i]!);
    turn(upper, new Quaternion().setFromUnitVectors(along(upper), new Vector3(.18 * sign, -1, -.02).normalize()));
    turn(fore, new Quaternion().setFromUnitVectors(along(fore), new Vector3(.1 * sign, -1, .14).normalize()));
    void restP; void hand;
  }
  const parentWorld = (i: number) => (bones[i]!.parent >= 0 ? world[bones[i]!.parent]! : ID);
  for (const s of ['L', 'R'] as const) for (const n of ['upper_arm', 'forearm', 'hand']) {
    const i = index.get(`${n}_${s}`)!;
    local.set(i, parentWorld(i).clone().invert().multiply(world[i]!).normalize());
  }
  // Fingers loosely curled.
  for (const s of ['L', 'R'] as const) for (const f of ['f_index', 'f_middle', 'f_ring', 'f_pinky', 'thumb']) for (const k of [1, 2, 3]) {
    const i = index.get(`${f}_0${k}_${s}`);
    if (i === undefined) continue;
    const curl = f === 'thumb' ? [.1, .15, .1][k - 1]! : [.25, .4, .3][k - 1]!;
    local.set(i, bones[i]!.quaternion.clone().multiply(new Quaternion().setFromAxisAngle(X_AXIS, curl)));
  }
  const tracks = new Map<number, Float32Array>();
  for (const [i, q] of local) tracks.set(i, Float32Array.from([...q.toArray(), ...q.toArray()]));
  return { name: STAND_CLIP, loop: true, duration: 2, frames: 2, stride: 2, bones: tracks, hipsY: [] };
}

/** Clips whose stride was calibrated in world metres (from a gameplay speed), not measured. */
const WORLD_STRIDES = new Set(['prone_forward']);
/** Maximum axial forearm twist relative to its reference pose (radians). */
const FOREARM_TWIST_MAX = 1.6;
/** Most a wrist bends away from its forearm while holding a handguard (radians). */
const WRIST_BEND_MAX = .52;
const tmpV = Array.from({ length: 12 }, () => new Vector3());
const tmpQ = Array.from({ length: 8 }, () => new Quaternion());
const tmpE = new Euler();
const tmpM = new Matrix4();
const ID = new Quaternion();
const X_AXIS = new Vector3(1, 0, 0);
const Y_AXIS = new Vector3(0, 1, 0);

/* ---------------------------------------------------------------------------------------------- */
/*  Loading                                                                                        */
/* ---------------------------------------------------------------------------------------------- */

const comp = (a: BufferAttribute | InterleavedBufferAttribute, i: number, k: number) => (k === 0 ? a.getX(i) : k === 1 ? a.getY(i) : k === 2 ? a.getZ(i) : a.getW(i));

/** Radial growth per bone (fraction of the distance from the bone's axis) for each body morph. */
const MORPHS: Array<{ name: string; bones: Record<string, number> }> = [
  { name: 'build', bones: { spine: .07, spine_001: .14, spine_002: .12, spine_003: .06, spine_004: .05, pelvis_L: .07, pelvis_R: .07, thigh_L: .1, thigh_R: .1, thigh_L_001: .07, thigh_R_001: .07, shin_L: .04, shin_R: .04, upper_arm_L: .08, upper_arm_R: .08, upper_arm_L_001: .07, upper_arm_R_001: .07, forearm_L: .04, forearm_R: .04 } },
  { name: 'muscle', bones: { spine_002: .04, spine_003: .09, spine_004: .07, shoulder_L: .1, shoulder_R: .1, upper_arm_L: .16, upper_arm_R: .16, upper_arm_L_001: .15, upper_arm_R_001: .15, forearm_L: .1, forearm_R: .1, forearm_L_001: .06, forearm_R_001: .06, thigh_L: .07, thigh_R: .07, thigh_L_001: .06, thigh_R_001: .06, shin_L: .05, shin_R: .05 } },
  { name: 'waist', bones: { spine: .05, spine_001: .15, spine_002: .1, pelvis_L: .06, pelvis_R: .06 } },
];

function addMorphs(geometry: BufferGeometry, assets: Pick<HumanAssets, 'index' | 'restP' | 'restQ'>): void {
  const pos = geometry.getAttribute('position'), si = geometry.getAttribute('skinIndex'), sw = geometry.getAttribute('skinWeight');
  if (!si || !sw) return;
  const axes = assets.restQ.map((q) => Y_AXIS.clone().applyQuaternion(q));
  const v = new Vector3(), d = new Vector3();
  geometry.morphAttributes.position = MORPHS.map(({ bones }) => {
    const coef = new Float32Array(assets.restP.length);
    for (const [name, k] of Object.entries(bones)) { const j = assets.index.get(name); if (j !== undefined) coef[j] = k; }
    const out = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      let x = 0, y = 0, z = 0;
      for (let k = 0; k < 4; k++) {
        const w = comp(sw, i, k), j = comp(si, i, k);
        if (!w || !coef[j]) continue;
        // Away from the bone's centre line, scaled by the bone's growth.
        d.subVectors(v, assets.restP[j]!);
        d.addScaledVector(axes[j]!, -d.dot(axes[j]!));
        x += d.x * w * coef[j]!; y += d.y * w * coef[j]!; z += d.z * w * coef[j]!;
      }
      out[i * 3] = x; out[i * 3 + 1] = y; out[i * 3 + 2] = z;
    }
    return new Float32BufferAttribute(out, 3);
  });
  geometry.morphTargetsRelative = true;
}

function meanColor(geometry: BufferGeometry): Color {
  const c = geometry.getAttribute('color');
  const out = new Color(0, 0, 0);
  if (!c) return out.setRGB(1, 1, 1);
  for (let i = 0; i < c.count; i++) { out.r += c.getX(i); out.g += c.getY(i); out.b += c.getZ(i); }
  return out.multiplyScalar(1 / Math.max(1, c.count));
}

function smooth(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** The model's own hair (no longer worn: the hair pack's styles replaced it). */
function haircuts(source: BufferGeometry): Map<string, BufferGeometry> {
  return new Map([['source', source]]);
}

/** First-person arms: from the collar bone down, so any cut edge stays behind the shoulder. */
/**
 * Body vertices hidden under a garment: within a few centimetres beneath its surface, facing the
 * same way. Skin there would poke through the cloth where the body bends (armpits, hips, knees).
 * Eroded by one ring, so the skin at the garment's edges (neckline, armholes) stays.
 */
function coveredVertices(body: BufferGeometry, garment: BufferGeometry): Uint8Array {
  const surface = new SkinSurface(garment);
  const bp = body.getAttribute('position'), bn = body.getAttribute('normal');
  const covered = new Uint8Array(bp.count), point = new Vector3(), normal = new Vector3();
  for (let i = 0; i < bp.count; i++) {
    point.fromBufferAttribute(bp, i); normal.fromBufferAttribute(bn, i).normalize();
    const hit = surface.nearest(point, .035, normal);
    if (hit && Math.min(hit.weights.x, hit.weights.y, hit.weights.z) > 1e-5
      && point.clone().sub(hit.point).dot(hit.normal) < .004) covered[i] = 1;
  }
  // Erode: keep a ring of skin under the garment's edges.
  const index = body.getIndex()!, deep = covered.slice();
  for (let t = 0; t < index.count; t += 3) {
    const a = index.getX(t), b = index.getX(t + 1), c = index.getX(t + 2);
    if (!covered[a] || !covered[b] || !covered[c]) { deep[a] = deep[b] = deep[c] = 0; }
  }
  return deep;
}

/** The body with the triangles under the given garments left out (shares the body's attributes). */
function bodyUnder(body: BufferGeometry, hidden: Uint8Array[]): BufferGeometry {
  const index = body.getIndex()!, tris: number[] = [];
  for (let t = 0; t < index.count; t += 3) {
    const a = index.getX(t), b = index.getX(t + 1), c = index.getX(t + 2);
    if (hidden.some((h) => h[a] && h[b] && h[c])) continue;
    tris.push(a, b, c);
  }
  const g = new BufferGeometry();
  for (const [name, attr] of Object.entries(body.attributes)) g.setAttribute(name, attr);
  g.morphAttributes = body.morphAttributes;
  g.morphTargetsRelative = body.morphTargetsRelative;
  g.setIndex(tris);
  g.boundingSphere = body.boundingSphere;
  return g;
}

function preparedBody(body: BufferGeometry, encoded: string): BufferGeometry {
  const hidden = atob(encoded), index = body.getIndex()!, triangles: number[] = [];
  if (hidden.length * 3 !== index.count) throw new Error('Survivor skin coverage does not match its topology');
  for (let t = 0; t < hidden.length; t++) if (!hidden.charCodeAt(t)) triangles.push(index.getX(t * 3), index.getX(t * 3 + 1), index.getX(t * 3 + 2));
  const geometry = new BufferGeometry();
  for (const [name, attribute] of Object.entries(body.attributes)) geometry.setAttribute(name, attribute);
  geometry.morphAttributes = body.morphAttributes;
  geometry.morphTargetsRelative = body.morphTargetsRelative;
  geometry.boundingSphere = body.boundingSphere;
  geometry.setIndex(triangles); return geometry;
}

const ARM_BONE = /^(shoulder_|upper_arm|forearm|hand_|f_|thumb|palm)/;
const HAND_BONE = /^(hand_|f_|thumb|palm)/;
// (also matched against bone names with a side suffix: hand_L, f_index_01_R…)

/** Tactical gloves made from the hands' skin: pushed out along its normals, over the wrist at the cuff. */
function gloveGeometry(body: BufferGeometry, names: string[]): BufferGeometry {
  const si = body.getAttribute('skinIndex'), sw = body.getAttribute('skinWeight'), index = body.getIndex()!;
  const pos = body.getAttribute('position'), nrm = body.getAttribute('normal');
  const weightOn = (i: number, re: RegExp) => { let w = 0; for (let k = 0; k < 4; k++) if (re.test(names[comp(si, i, k)] ?? '')) w += comp(sw, i, k); return w; };
  const hand = new Float32Array(si.count);
  for (let i = 0; i < si.count; i++) hand[i] = weightOn(i, HAND_BONE);
  const tris: number[] = [];
  for (let t = 0; t < index.count; t += 3) {
    const a = index.getX(t), b = index.getX(t + 1), c = index.getX(t + 2);
    // The hand and a short cuff over the wrist (any part of the triangle on the hand).
    if (Math.max(hand[a]!, hand[b]!, hand[c]!) > .5 && Math.min(hand[a]!, hand[b]!, hand[c]!) > .15) tris.push(a, b, c);
  }
  const out = new Float32Array(pos.count * 3), n = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    n.fromBufferAttribute(nrm, i).normalize();
    // Thin over the fingers, thicker on the back of the hand and at the cuff.
    const d = hand[i]! > .95 ? .0022 : .0032;
    out[i * 3] = pos.getX(i) + n.x * d; out[i * 3 + 1] = pos.getY(i) + n.y * d; out[i * 3 + 2] = pos.getZ(i) + n.z * d;
  }
  const g = new BufferGeometry();
  for (const [name, attr] of Object.entries(body.attributes)) if (name !== 'position' && name !== 'color' && name !== 'uv') g.setAttribute(name, attr);
  g.setAttribute('position', new Float32BufferAttribute(out, 3));
  // Dark olive-black synthetic leather, a shade lighter over the knuckles' back.
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) { col[i * 3] = .042; col[i * 3 + 1] = .045; col[i * 3 + 2] = .038; }
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
  g.morphAttributes = body.morphAttributes;
  g.morphTargetsRelative = body.morphTargetsRelative;
  g.setIndex(tris);
  g.computeBoundingSphere();
  return g;
}

/** The skin without the hands (worn gloves cover them): triangles mostly weighted to hand / finger bones left out. */
function withoutHands(body: BufferGeometry, names: string[]): BufferGeometry {
  const si = body.getAttribute('skinIndex'), sw = body.getAttribute('skinWeight'), index = body.getIndex()!;
  const hand = new Uint8Array(si.count);
  for (let i = 0; i < si.count; i++) {
    let best = 0, bone = 0;
    for (let k = 0; k < 4; k++) { const w = comp(sw, i, k); if (w > best) { best = w; bone = comp(si, i, k); } }
    hand[i] = HAND_BONE.test(names[bone] ?? '') ? 1 : 0;
  }
  const tris: number[] = [];
  for (let t = 0; t < index.count; t += 3) {
    const a = index.getX(t), b = index.getX(t + 1), c = index.getX(t + 2);
    if (!(hand[a] && hand[b] && hand[c])) tris.push(a, b, c);
  }
  const g = new BufferGeometry();
  for (const [name, attr] of Object.entries(body.attributes)) g.setAttribute(name, attr);
  g.morphAttributes = body.morphAttributes;
  g.morphTargetsRelative = body.morphTargetsRelative;
  g.boundingSphere = body.boundingSphere;
  g.setIndex(tris);
  return g;
}

/** The body's arms and hands (triangles whose every vertex is mostly weighted to them). */
function armsOnly(body: BufferGeometry, names: string[]): BufferGeometry {
  const si = body.getAttribute('skinIndex'), sw = body.getAttribute('skinWeight'), index = body.getIndex()!;
  const arm = (i: number) => {
    let best = 0, bone = 0;
    for (let k = 0; k < 4; k++) { const w = comp(sw, i, k); if (w > best) { best = w; bone = comp(si, i, k); } }
    return ARM_BONE.test(names[bone] ?? '');
  };
  const keep = new Uint8Array(si.count);
  for (let i = 0; i < si.count; i++) keep[i] = arm(i) ? 1 : 0;
  const tris: number[] = [];
  for (let t = 0; t < index.count; t += 3) {
    const a = index.getX(t), b = index.getX(t + 1), c = index.getX(t + 2);
    if (keep[a] && keep[b] && keep[c]) tris.push(a, b, c);
  }
  const g = new BufferGeometry();
  for (const [name, attr] of Object.entries(body.attributes)) g.setAttribute(name, attr);
  g.morphAttributes = body.morphAttributes;
  g.morphTargetsRelative = body.morphTargetsRelative;
  g.setIndex(tris);
  return g;
}

function handFrame(assets: Pick<HumanAssets, 'index' | 'restP' | 'restQ'>, side: Side): HandFrame {
  const at = (n: string) => assets.restP[assets.index.get(`${n}_${side}`)!]!;
  const q = (n: string) => assets.restQ[assets.index.get(`${n}_${side}`)!]!;
  const wrist = at('hand');
  const knuckles = new Vector3();
  for (const f of ['f_index_01', 'f_middle_01', 'f_ring_01', 'f_pinky_01']) knuckles.add(at(f));
  knuckles.multiplyScalar(.25);
  // The fingers curl about their X axis towards +Z: the palm faces the first phalanges' +Z.
  const normal = new Vector3();
  for (const f of ['f_index_01', 'f_middle_01', 'f_ring_01']) normal.add(new Vector3(0, 0, 1).applyQuaternion(q(f)));
  normal.normalize();
  // Across the knuckles, from the index finger to the little finger.
  const across = at('f_pinky_01').clone().sub(at('f_index_01')).normalize();
  // The palm's grip line lies near the knuckles, one palm thickness in front of the bones.
  const palm = wrist.clone().lerp(knuckles, .74).addScaledVector(normal, PALM_SKIN);
  const inv = q('hand').clone().invert();
  return { palm: palm.sub(wrist).applyQuaternion(inv), normal: normal.applyQuaternion(inv), across: across.applyQuaternion(inv) };
}

let loading: Promise<HumanAssets> | null = null;

/** Downloads and prepares the survivor model once (geometry is shared by every survivor). */
export function loadHumanAssets(fetchBuffer: (url: string) => Promise<ArrayBuffer>, url = HUMAN_MODEL_URL): Promise<HumanAssets> {
  loading ??= fetchBuffer(url).then((buf) => parseHumanAssets(buf)).catch((err: unknown) => { loading = null; throw err; });
  return loading;
}

export async function parseHumanAssets(buffer: ArrayBuffer, options: { rebuildSkin?: boolean } = {}): Promise<HumanAssets> {
  const gltf = await new GLTFLoader().parseAsync(buffer, '');
  const prepared = options.rebuildSkin ? undefined : gltf.parser.json.extras?.zion_skin as { version: number; hidden: { bare: string; top: string } } | undefined;
  const preparedSkin = prepared?.version === 1 ? prepared : undefined;
  const rawClips = (gltf.parser.json as { animations?: Array<{ name: string; extras?: { loop?: boolean; stride?: number; hipsY?: number[] } }> }).animations ?? [];
  const meshes: SkinnedMesh[] = [];
  gltf.scene.traverse((o) => { if ((o as SkinnedMesh).isSkinnedMesh) meshes.push(o as SkinnedMesh); });
  if (!meshes.length) throw new Error('survivor model has no skinned meshes');
  const skeleton = meshes[0]!.skeleton;
  const index = new Map(skeleton.bones.map((b, i) => [b.name, i]));
  const bones: BoneDef[] = skeleton.bones.map((b) => ({
    name: b.name, parent: b.parent && (b.parent as Bone).isBone ? index.get(b.parent.name) ?? -1 : -1,
    position: b.position.clone(), quaternion: b.quaternion.clone(), scale: b.scale.clone(),
  }));
  // Bind pose in model space, from the bones as authored.
  const restM: Matrix4[] = [];
  const rest = (i: number): Matrix4 => {
    if (restM[i]) return restM[i]!;
    const d = bones[i]!, local = new Matrix4().compose(d.position, d.quaternion, d.scale);
    return (restM[i] = d.parent >= 0 ? rest(d.parent).clone().multiply(local) : local);
  };
  bones.forEach((_, i) => rest(i));
  const restP = restM.map((m) => new Vector3().setFromMatrixPosition(m));
  const restQ = restM.map((m) => new Quaternion().setFromRotationMatrix(new Matrix4().extractRotation(m)));
  const base = { index, restP, restQ };
  const parts = new Map<string, HumanPart>();
  for (const mesh of meshes) {
    const extras = (mesh.geometry.userData ?? {}) as { part?: string; slot?: string };
    const part = mesh.userData.part as string | undefined ?? extras.part ?? mesh.name;
    const slot = mesh.userData.slot as string | undefined ?? extras.slot ?? part;
    const material = mesh.material as MeshStandardMaterial;
    const geometry = mesh.geometry;
    geometry.computeBoundingSphere();
    // Textured garments: the texture's own mean colour (the vertex colours are plain white).
    const mean = (mesh.userData.mean ?? (geometry.userData as { mean?: number[] }).mean) as number[] | undefined;
    const maps = material.map ? { map: material.map, normalMap: material.normalMap, aoMap: material.aoMap } : undefined;
    parts.set(slot, { geometry, slot, roughness: material.roughness ?? .8, metalness: material.metalness ?? 0, mean: maps && mean ? new Color(mean[0], mean[1], mean[2]) : meanColor(geometry), ...(maps ? { maps } : {}) });
    if (!maps) material.dispose();
  }
  const body = parts.get('body');
  const hairPart = parts.get('hair');
  if (!body) throw new Error('survivor model has no body');
  const shirt = parts.get('top');
  if (shirt && !preparedSkin) bindGarment(body.geometry, shirt.geometry);
  for (const [slot, part] of parts) if (slot !== 'hair' && slot !== 'eyes' && slot !== 'feet') addMorphs(part.geometry, base);
  const names = bones.map((b) => b.name);
  const under = (slot: string) => { const g = parts.get(slot)?.geometry; return g ? coveredVertices(body.geometry, g) : null; };
  const always = preparedSkin ? [] : [under('legs'), under('feet')].filter((h): h is Uint8Array => !!h);
  const top = preparedSkin ? null : under('top');
  const clipMap = new Map(gltf.animations.map((clip, k) => {
    const extras = rawClips[k]?.extras ?? {}, frames = clip.tracks[0]?.times.length ?? 2;
    const bones = new Map<number, Float32Array>();
    for (const t of clip.tracks) {
      const [name, prop] = t.name.split('.');
      const i = index.get(name ?? '');
      if (i !== undefined && prop === 'quaternion') bones.set(i, Float32Array.from(t.values));
    }
    // Strides were measured on the source-sized skeleton; the survivor is drawn HUMAN_SCALE
    // larger, so its steps cover that much more ground (else the feet patter too fast).
    const stride = (extras.stride ?? 2) * (WORLD_STRIDES.has(clip.name) ? 1 : HUMAN_SCALE);
    return [clip.name, { name: clip.name, loop: !!extras.loop, duration: clip.duration, frames, stride, bones, hipsY: extras.hipsY ?? [] }] as const;
  }));
  for (const clip of clipMap.values()) closeMocapLoop(clip);
  addLocomotionClips(clipMap, bones, index);
  clipMap.set(STAND_CLIP, standPose(bones, index, restQ, restP));
  // The pistol draw's held one-handed frames play as their own layers (see avatars.ts).
  const draw = clipMap.get('pistol_draw');
  if (draw) { clipMap.set('pistol_hold', draw); clipMap.set('pistol_hip', draw); }
  const skinPrepared = preparedSkin ? { bare: preparedBody(body.geometry, preparedSkin.hidden.bare), top: preparedBody(body.geometry, preparedSkin.hidden.top) }
    : { bare: bodyUnder(body.geometry, always), top: bodyUnder(body.geometry, top ? [...always, top] : always) };
  // Gloves worn: the hands' skin under them is left out (it would show through as the fingers bend).
  // Gloves: the hands' own skin a few millimetres out (the cuff a little more over the wrist),
  // skinned exactly like the hands, so they follow every finger.
  if (!parts.has('gloves')) parts.set('gloves', { geometry: gloveGeometry(body.geometry, names), slot: 'gloves', roughness: .82, metalness: 0, mean: new Color(.035, .037, .032) });
  const gloved = parts.has('gloves');
  const bodies = gloved ? { bare: withoutHands(skinPrepared.bare, names), top: withoutHands(skinPrepared.top, names) } : skinPrepared;
  const skinArms = gloved ? withoutHands(armsOnly(body.geometry, names), names) : armsOnly(body.geometry, names);
  return {
    bones, index, inverses: skeleton.boneInverses.map((m) => m.clone()), parts,
    hair: hairPart ? haircuts(hairPart.geometry) : new Map(),
    arms: skinArms,
    ...(shirt ? { sleeves: armsOnly(shirt.geometry, names), armsDressed: armsOnly(bodies.top, names) } : {}),
    bodies,
    restP, restQ,
    hands: { L: handFrame(base, 'L'), R: handFrame(base, 'R') },
    clips: clipMap,
  };
}

/* ---------------------------------------------------------------------------------------------- */
/*  Materials                                                                                      */
/* ---------------------------------------------------------------------------------------------- */

const materialCache = new Map<string, MeshStandardMaterial>();

/** A vertex-coloured material whose colours are recoloured so their mean becomes `target`. */
/** Longest side (px) of garment textures for each texture quality (high: as shipped). */
const TEXTURE_LIMIT: Record<TextureQuality, number> = { low: 256, medium: 512, high: Infinity };
const limited = new Map<string, Texture>();

/** A garment texture at the player's texture quality: downscaled copies for low / medium. */
function atQuality(tex: Texture | null, quality: TextureQuality): Texture | null {
  const image = tex?.image as { width?: number; height?: number } | undefined;
  const max = TEXTURE_LIMIT[quality];
  if (!tex || !image?.width || !image.height || Math.max(image.width, image.height) <= max || typeof document === 'undefined') return tex;
  const id = `${tex.uuid}|${max}`;
  let out = limited.get(id);
  if (!out) {
    const k = max / Math.max(image.width, image.height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * k)); canvas.height = Math.max(1, Math.round(image.height * k));
    canvas.getContext('2d')?.drawImage(tex.image as CanvasImageSource, 0, 0, canvas.width, canvas.height);
    out = tex.clone(); out.image = canvas; out.needsUpdate = true;
    limited.set(id, out);
  }
  return out;
}

function partMaterial(part: HumanPart, target: string | null, key: string): MeshStandardMaterial {
  const quality = settingsStore.get().textureQuality;
  const id = `${key}|${target ?? ''}|${part.maps ? quality : ''}`;
  let m = materialCache.get(id);
  if (!m) {
    const tint = new Color(1, 1, 1);
    if (target) {
      const want = new Color(target);
      tint.setRGB(want.r / Math.max(.02, part.mean.r), want.g / Math.max(.02, part.mean.g), want.b / Math.max(.02, part.mean.b));
    }
    // Clothes and hair lie on the skin: drawn in front of it where they nearly touch.
    const layered = part.slot !== 'body' && part.slot !== 'eyes';
    // Skin is matte (no plastic sheen under lights); clothes keep the model's own finish.
    const skin = part.slot === 'body';
    m = new MeshStandardMaterial({ vertexColors: true, color: tint, roughness: skin ? Math.max(.82, part.roughness) : part.roughness, metalness: skin ? 0 : part.metalness, polygonOffset: layered, polygonOffsetFactor: layered ? -1.5 : 0, polygonOffsetUnits: layered ? -3 : 0 });
    if (part.maps) {
      // The garment's own textures (tinted by the chosen colour).
      m.map = atQuality(part.maps.map, quality); m.normalMap = atQuality(part.maps.normalMap, quality); m.aoMap = atQuality(part.maps.aoMap, quality);
    }
    m.name = `survivor-${key}`;
    materialCache.set(id, m);
  }
  return m;
}

/* ---------------------------------------------------------------------------------------------- */
/*  One survivor                                                                                   */
/* ---------------------------------------------------------------------------------------------- */

const FINGERS = ['f_index', 'f_middle', 'f_ring', 'f_pinky', 'thumb'] as const;
/** Curl (rad) of a hand shape: the three finger joints (knuckle, middle, end) and the thumb's three. */
export interface HandShapeCurl { finger: [number, number, number]; thumb: [number, number, number] }
/** Extra curl (rad) of the three finger joints and the thumb for each hand shape. */
const PRESETS: Record<BasicHandPreset, HandShapeCurl> = {
  open: { finger: [-.05, -.05, 0], thumb: [0, 0, 0] },
  relaxed: { finger: [.22, .38, .28], thumb: [.1, .18, .12] },
  ready: { finger: [.7, .9, .6], thumb: [.35, .4, .3] },
  // A loose fist: the fingertips meet the palm without passing into it.
  fist: { finger: [1.25, 1.3, .85], thumb: [.5, .6, .55] },
  pinch: { finger: [.45, .55, .35], thumb: [.45, .5, .4] },
};
export const HAND_SHAPES: Readonly<Record<BasicHandPreset, HandShapeCurl>> = PRESETS;
const TRIGGER_CURL: [number, number, number] = [.42, .52, .3];
/** Most each joint may curl round a handle (rad): knuckle, middle and end joint; thumb. */
const MAX_CURL: [number, number, number] = [1.55, 1.75, 1.25];
const MAX_THUMB: [number, number, number] = [.9, .95, .95];

interface SideBones {
  shoulder: number; upperArm: number; upperArm1: number; forearm: number; forearm1: number; hand: number;
  fingers: number[][];
  thigh: number; thigh1: number; shin: number; shin1: number; foot: number; toe: number;
}

/** What the gameplay rig hands over each frame. */
export interface DriverRig {
  /** The character model: parent of the rig and of this body. */
  model: Object3D;
  root: Object3D; body: Object3D; head: Object3D;
  armL: Object3D; armR: Object3D; handL: Object3D; handR: Object3D;
  legL: Object3D; legR: Object3D;
  bodyRest: Vector3;
  rootRest: Matrix4;
  /** Point of the rig's hand that held things close round (its grip), in hand space. */
  handGrip: Vector3;
}

export interface PoseRequest {
  dt: number;
  grasp: Record<Side, Grasp | null>;
  /** Where an empty hand's palm should go instead of the rig's hand (world), e.g. planted on a ledge. */
  reach?: Partial<Record<Side, Vector3 | null>>;
  hands: Record<Side, HandPreset>;
  /** 0..1: feet flat on the ground (standing, walking) or following the leg (air, prone, swimming). */
  plant: number;
  /** Physics contact, independent of the smoothed ankle pose. */
  grounded?: boolean;
  crouch: number;
  /** 0..1: knees to the chest (rolls, the top of a jump). */
  tuck: number;
  /** 0..1: knees giving on landing. */
  land: number;
  moving: boolean;
  ground?: ((x: number, z: number) => number) | null;
  /** The hips drop this far (m), e.g. a seated pose. */
  hipDrop?: number;
  /**
   * A recorded clip mixed over the pose: the trunk and legs (and the arms when `arms`, else they
   * keep holding what they hold), at `time` seconds, by `weight`; `hips` keeps its hip bob.
   */
  mocap?: MocapPose | null;
}

export class HumanBody {
  /** Holder in the character model: turns the source model (facing +Z) to face −Z and scales it. */
  readonly group = new Group();
  readonly bones: Bone[];
  readonly skeleton: Skeleton;
  private readonly meshes = new Map<string, SkinnedMesh>();
  private readonly worldQ: Quaternion[];
  private readonly side: Record<Side, SideBones>;
  private readonly spine: number[];
  private readonly neck: number[];
  /** Bones parents first. */
  private readonly order: number[] = [];
  private appearance: Appearance = DEFAULT_APPEARANCE;
  get look(): Appearance { return this.appearance; }
  private tinted = false;
  /** Hand shapes of the gun in hand (Studio), in place of the standard ones. */
  shapeOverrides: Partial<Record<HandPreset, HandShapeCurl>> | null = null;
  private readonly fingerCache: Record<Side, { key: string; angles: number[] }> = { L: { key: '', angles: [] }, R: { key: '', angles: [] } };
  private readonly gripBasisCache = new Map<string, { axis: Vector3; approach: Vector3 }>();
  private readonly upperPoseWorld = new Map<number, Quaternion>();
  private readonly upperHeading = new Quaternion();
  private readonly legState: Record<Side, { pitch: number; swing: number }> = { L: { pitch: 0, swing: 0 }, R: { pitch: 0, swing: 0 } };
  /** Rest position of the hips under the group; legs longer than the base model raise them. */
  private hipLift = 0;

  /** First-person arms only (no torso to keep the elbows out of). */
  private readonly armsOnly: boolean;
  constructor(readonly assets: HumanAssets, options: { shadows?: boolean; receiveShadows?: boolean; armsOnly?: boolean } = {}) {
    this.armsOnly = !!options.armsOnly;
    this.group.name = 'survivor';
    this.group.rotation.y = Math.PI;
    this.group.scale.setScalar(HUMAN_SCALE);
    this.bones = assets.bones.map((d) => {
      const b = new Bone();
      b.name = d.name;
      b.position.copy(d.position); b.quaternion.copy(d.quaternion); b.scale.copy(d.scale);
      return b;
    });
    assets.bones.forEach((d, i) => { if (d.parent >= 0) this.bones[d.parent]!.add(this.bones[i]!); else this.group.add(this.bones[i]!); });
    this.skeleton = new Skeleton(this.bones, assets.inverses);
    const visit = (i: number) => { this.order.push(i); assets.bones.forEach((d, j) => { if (d.parent === i) visit(j); }); };
    assets.bones.forEach((d, i) => { if (d.parent < 0) visit(i); });
    this.worldQ = this.bones.map(() => new Quaternion());
    const at = (n: string) => { const i = assets.index.get(n); if (i === undefined) throw new Error(`survivor rig lacks ${n}`); return i; };
    const sideBones = (s: Side): SideBones => ({
      shoulder: at(`shoulder_${s}`), upperArm: at(`upper_arm_${s}`), upperArm1: at(`upper_arm_${s}_001`), forearm: at(`forearm_${s}`), forearm1: at(`forearm_${s}_001`), hand: at(`hand_${s}`),
      fingers: FINGERS.map((f) => [1, 2, 3].map((k) => at(`${f}_0${k}_${s}`))),
      thigh: at(`thigh_${s}`), thigh1: at(`thigh_${s}_001`), shin: at(`shin_${s}`), shin1: at(`shin_${s}_001`), foot: at(`foot_${s}`), toe: at(`toe_${s}`),
    });
    this.side = { L: sideBones('L'), R: sideBones('R') };
    this.spine = ['spine', 'spine_001', 'spine_002', 'spine_003'].map(at);
    this.neck = ['spine_004', 'spine_005', 'spine_006'].map(at);
    const bound = new Sphere(new Vector3(0, .9, 0), 2.2);
    const add = (slot: string, geometry: BufferGeometry) => {
      const part = assets.parts.get(slot);
      if (!part) return;
      const mesh = new SkinnedMesh(geometry, partMaterial(part, null, slot));
      mesh.name = `survivor-${slot}`;
      mesh.bind(this.skeleton, new Matrix4());
      mesh.boundingSphere = bound;
      mesh.castShadow = options.shadows ?? true;
      mesh.receiveShadow = options.receiveShadows ?? false;
      if (options.armsOnly) mesh.frustumCulled = false;
      if (geometry.morphAttributes.position?.length) mesh.morphTargetInfluences = geometry.morphAttributes.position.map(() => 0);
      this.group.add(mesh);
      this.meshes.set(slot, mesh);
    };
    // First person: the forearms and hands, in the shirt's sleeves when there is one.
    if (options.armsOnly) {
      add('body', assets.armsDressed ?? assets.arms);
      if (assets.sleeves) add('top', assets.sleeves);
      const gloves = assets.parts.get('gloves');
      if (gloves) add('gloves', gloves.geometry);
    }
    else for (const [slot, part] of assets.parts) add(slot, slot === 'hair' ? assets.hair.get('source') ?? part.geometry : slot === 'body' ? assets.bodies.top : part.geometry);
    this.setAppearance(DEFAULT_APPEARANCE);
  }

  /** All rendered meshes (outlines, tints). */
  get meshList(): SkinnedMesh[] { return [...this.meshes.values()]; }

  private hairCovered = false;
  /** The hair pack style worn, and which one it is (loads once per style). */
  private hairStyle: HairInstance | null = null;
  private hairStyleId: HairStyle | null = null;
  /** A helmet or hood over the head presses the hair under it in. */
  setHairCovered(on: boolean): void {
    this.hairCovered = on;
    this.hairStyle?.setHelmet(on);
    this.applyInfectedSkin();
  }

  private static readonly faceSkins = new WeakMap<HumanAssets, FaceSkin>();
  /** The head's skin, which eyebrows and beards are fitted to and skinned like. */
  private faceSkin(): FaceSkin {
    let skin = HumanBody.faceSkins.get(this.assets);
    if (!skin) {
      const g = this.assets.bodies.top;
      skin = { position: g.getAttribute('position') as BufferAttribute, normal: g.getAttribute('normal') as BufferAttribute, skinIndex: g.getAttribute('skinIndex') as BufferAttribute, skinWeight: g.getAttribute('skinWeight') as BufferAttribute, index: g.getIndex()! };
      HumanBody.faceSkins.set(this.assets, skin);
    }
    return skin;
  }

  private faceHair: { brows: SkinnedMesh | null; beard: SkinnedMesh | null } = { brows: null, beard: null };
  private faceHairKey = '';
  /** Eyebrows and beard in the hair colour (the natural colour: a dark brown). */
  private wearFaceHair(a: Appearance): void {
    const color = HAIR_COLORS[a.hairColor];
    const tone = color && color !== 'natural' ? color : '#2a1d14';
    const key = `${a.brows}|${a.beard}|${tone}`;
    if (key === this.faceHairKey) return;
    this.faceHairKey = key;
    const skin = this.faceSkin();
    const place = (slot: 'brows' | 'beard', geometry: BufferGeometry | null, material: Material | null) => {
      const old = this.faceHair[slot];
      if (old) { old.removeFromParent(); (old.material as Material).dispose(); this.faceHair[slot] = null; }
      if (!geometry || !material) return;
      const mesh = new SkinnedMesh(geometry, material);
      mesh.name = `survivor-${slot}`;
      mesh.bind(this.skeleton, new Matrix4());
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.visible = !this.infectedSkin;
      this.group.add(mesh);
      this.faceHair[slot] = mesh;
    };
    const beard = beardGeometry(skin, a.beard);
    place('beard', beard, beard ? beardMaterial(tone, beard.userData.thin as number) : null);
    const brows = a.brows;
    if (!brows) { place('brows', null, null); return; }
    void eyebrowGeometries(skin).then((shapes) => {
      if (this.disposed || this.faceHairKey !== key) return;
      const g = shapes[(brows - 1) % Math.max(1, shapes.length)];
      place('brows', g ?? null, g ? browMaterial(new Color(tone).multiplyScalar(.8).getStyle()) : null);
    });
  }

  private wearHair(a: Appearance): void {
    const color = HAIR_COLORS[a.hairColor];
    const tint = color && color !== 'natural' ? color : null;
    if (this.hairStyleId === a.hair) { this.hairStyle?.setColor(tint); return; }
    this.hairStyleId = a.hair;
    this.hairStyle?.dispose(); this.hairStyle = null;
    const want = a.hair;
    void loadHairStyle(want).then((template) => {
      if (!template || this.hairStyleId !== want || this.disposed) return;
      const hair = new HairInstance(template);
      hair.setColor(tint); hair.setHelmet(this.hairCovered);
      this.group.add(hair.root);
      this.hairStyle = hair;
      this.applyInfectedSkin();
    });
  }

  private readonly hairHeadRest = new Matrix4();
  private hairHeadReady = false;
  /**
   * The hair on the head (call once the body is posed for the frame): its head bone onto the
   * survivor's (or `head`, another skeleton's head with its rest matrix in body space), the strands
   * stepped by `dt`.
   */
  updateHair(dt: number, head?: { obj: Object3D; rest: Matrix4 }): void {
    const hair = this.hairStyle;
    if (!hair || !hair.root.visible) return;
    if (!this.hairHeadReady) {
      const i = this.assets.index.get('spine_006')!;
      this.hairHeadRest.compose(this.assets.restP[i]!, this.assets.restQ[i]!, new Vector3(1, 1, 1));
      this.hairHeadReady = true;
    }
    const obj = head?.obj ?? this.bones[this.assets.index.get('spine_006')!]!, rest = head?.rest ?? this.hairHeadRest;
    // bip_head in the body's space sits at HAIR_HEAD_AT (unrotated); relative to the head bone at rest:
    const rel = rest.clone().invert().multiply(new Matrix4().makeTranslation(HAIR_HEAD_AT.x, HAIR_HEAD_AT.y, HAIR_HEAD_AT.z));
    hair.update(this.group, obj.matrixWorld.clone().multiply(rel), dt);
  }

  private readonly outfitCovered = new Set<string>();
  /** Trousers / boots worn over the default ones hide them. */
  setOutfitCovered(slot: 'top' | 'legs' | 'feet', on: boolean): void {
    if (on === this.outfitCovered.has(slot)) return;
    if (on) this.outfitCovered.add(slot); else this.outfitCovered.delete(slot);
    const mesh = this.meshes.get(slot);
    if (mesh) mesh.visible = !on;
    this.applyInfectedSkin();
  }

  setAppearance(a: Appearance): void {
    this.appearance = a;
    const A = this.assets;
    const set = (slot: string, color: string | null, visible = true, key = slot) => {
      const mesh = this.meshes.get(slot), part = A.parts.get(slot);
      if (!mesh || !part) return;
      mesh.visible = visible && !this.outfitCovered.has(slot);
      mesh.material = partMaterial(part, color, key);
      if (this.tinted) this.tint(mesh, true);
      const inf = mesh.morphTargetInfluences;
      if (inf) MORPHS.forEach((m, k) => { inf[k] = (a.body[m.name as 'build' | 'muscle' | 'waist'] ?? 0) / 100; });
    };
    set('body', SKIN_TONES[a.skin] ?? SKIN_TONES[1]!);
    const body = this.meshes.get('body');
    if (body && this.armsOnly) body.geometry = a.top === 'none' || !A.sleeves ? A.arms : A.armsDressed ?? A.arms;
    else if (body) body.geometry = a.top === 'none' ? A.bodies.bare : A.bodies.top;
    set('eyes', null);
    set('top', TOP_COLORS[a.topColor] ?? null, a.top !== 'none');
    set('legs', PANTS_COLORS[a.pantsColor] ?? null);
    set('belt', null, a.belt);
    set('feet', BOOT_COLORS[a.bootsColor] ?? null);
    // The model's own hair is no longer worn: a style from the hair pack is.
    const oldHair = this.meshes.get('hair');
    if (oldHair) oldHair.visible = false;
    if (!this.armsOnly) { this.wearHair(a); this.wearFaceHair(a); }
    set('infected', null, this.infectedSkin);
    this.applyInfectedSkin();
    this.proportions(a);
  }

  private infectedSkin = false;
  /** Infection mode: the zombie model (same skeleton and animations) in place of the survivor. */
  private applyInfectedSkin(): void {
    const zombie = this.meshes.get('infected');
    if (!zombie) return;
    zombie.visible = this.infectedSkin;
    if (this.infectedSkin) for (const [slot, mesh] of this.meshes) if (slot !== 'infected') mesh.visible = false;
    if (this.hairStyle) this.hairStyle.root.visible = !this.infectedSkin;
    for (const m of [this.faceHair.brows, this.faceHair.beard]) if (m) m.visible = !this.infectedSkin;
  }

  /** Face and body proportions: face bones moved and scaled, limbs lengthened, shoulders widened. */
  private proportions(a: Appearance): void {
    const A = this.assets;
    // Back to the bind pose first: these are absolute.
    A.bones.forEach((d, i) => { this.bones[i]!.position.copy(d.position); this.bones[i]!.scale.copy(d.scale); });
    const bone = (n: string) => { const i = A.index.get(n); return i === undefined ? null : this.bones[i]!; };
    const f = (k: keyof Appearance['face']) => (a.face[k] ?? 0) / 100;
    const b = (k: keyof Appearance['body']) => (a.body[k] ?? 0) / 100;
    // Moves a bone in model space (bind directions), so its skin follows.
    const shift = (n: string, dx: number, dy: number, dz: number) => {
      const i = A.index.get(n), node = bone(n);
      if (i === undefined || !node) return;
      const parent = A.bones[i]!.parent;
      const d = tmpV[0]!.set(dx, dy, dz);
      if (parent >= 0) d.applyQuaternion(tmpQ[0]!.copy(A.restQ[parent]!).invert());
      node.position.add(d);
    };
    const grow = (n: string, s: number) => bone(n)?.scale.multiplyScalar(s);
    const mirror = (n: string, dx: number, dy = 0, dz = 0) => { shift(`${n}_L`, dx, dy, dz); shift(`${n}_R`, -dx, dy, dz); };

    // Strong enough to make quite different people (the presets push several at once).
    grow('spine_006', 1 + .07 * f('head'));
    // Face width: jaw, cheeks and temples out together.
    for (const n of ['jaw', 'jaw_001', 'temple', 'cheek_B_001', 'cheek_T']) mirror(n, .0045 * f('faceWidth'));
    for (const n of ['jaw', 'jaw_001']) mirror(n, .009 * f('jaw'));
    mirror('chin', .007 * f('jaw'));
    for (const n of ['chin', 'chin_001']) { shift(n, 0, -.015 * f('chin'), .007 * f('chin')); grow(n, 1 + .14 * f('chin')); }
    for (const n of ['cheek_B', 'cheek_B_001', 'cheek_T_001']) { mirror(n, .006 * f('cheeks'), 0, .003 * f('cheeks')); grow(`${n}_L`, 1 + .16 * f('cheeks')); grow(`${n}_R`, 1 + .16 * f('cheeks')); }
    // Cheekbones: high and forward, or flat.
    mirror('cheek_T_001', .004 * f('cheekbones'), .004 * f('cheekbones'), .005 * f('cheekbones'));
    for (const s of ['L', 'R'] as const) grow(`cheek_T_${s}_001`, 1 + .14 * f('cheekbones'));
    for (const n of ['nose', 'nose_001', 'nose_002', 'nose_003', 'nose_004']) grow(n, 1 + .26 * f('nose'));
    for (const n of ['nose_L', 'nose_R', 'nose_L_001', 'nose_R_001']) grow(n, 1 + .2 * f('nose'));
    shift('nose_002', 0, 0, .007 * f('nose'));
    // Nose width (the wings out) and bridge (the line raised forward, or flat).
    for (const n of ['nose_L', 'nose_L_001']) shift(n, .005 * f('noseWidth'), 0, 0);
    for (const n of ['nose_R', 'nose_R_001']) shift(n, -.005 * f('noseWidth'), 0, 0);
    for (const n of ['nose_L', 'nose_R', 'nose_L_001', 'nose_R_001']) grow(n, 1 + .2 * f('noseWidth'));
    for (const n of ['nose', 'nose_001']) shift(n, 0, 0, .007 * f('noseBridge'));
    shift('nose_002', 0, -.002 * f('noseBridge'), .005 * f('noseBridge'));
    // Lips: fuller and forward, or thin.
    for (const t of ['lip_T', 'lip_B']) for (const k of ['', '_001']) {
      mirror(`${t}${k}`, 0, 0, .0025 * f('lips'));
      for (const s of ['L', 'R'] as const) grow(`${t}_${s}${k}`, 1 + .3 * f('lips'));
    }
    shift('lip_T_L', 0, .0015 * f('lips'), 0); shift('lip_B_L', 0, -.0015 * f('lips'), 0);
    for (const n of ['brow_T', 'brow_T_001', 'brow_T_002', 'brow_T_003']) mirror(n, 0, .003 * f('brow'), .008 * f('brow'));
    for (const n of ['forehead', 'forehead_001', 'forehead_002']) mirror(n, 0, .008 * f('forehead'), .005 * f('brow') + .003 * f('forehead'));
    mirror('temple', 0, .006 * f('forehead'), 0);
    for (const n of ['lid_T', 'lid_B', 'brow_B']) for (const k of ['', '_001', '_002', '_003']) mirror(`${n}${k}`, .005 * f('eyes'));
    // Eye size: the lids open wider and the eyes grow a little.
    for (const k of ['', '_001', '_002', '_003']) { mirror(`lid_T${k}`, 0, .002 * f('eyeSize'), 0); mirror(`lid_B${k}`, 0, -.0015 * f('eyeSize'), 0); }
    for (const s of ['L', 'R'] as const) grow(`eye_${s}`, 1 + .1 * f('eyeSize'));
    for (const s of ['L', 'R'] as const) grow(`ear_${s}`, 1 + .3 * f('ears'));
    // Shoulders: the arms sit further out along the collar bones.
    for (const s of ['L', 'R'] as const) bone(`upper_arm_${s}`)?.position.multiplyScalar(1 + .14 * b('shoulders'));
    // Legs: longer thighs and shins, the hips raised to keep the feet on the ground.
    const legs = 1 + .045 * b('legs');
    for (const s of ['L', 'R'] as const) for (const n of [`thigh_${s}_001`, `shin_${s}`, `shin_${s}_001`, `foot_${s}`]) bone(n)?.position.multiplyScalar(legs);
    const ankle = A.restP[A.index.get('foot_L')!]!.y, hip = A.restP[A.index.get('thigh_L')!]!.y;
    this.hipLift = (hip - ankle) * (legs - 1);
  }

  /** Infection: the skin and clothes under a red veil. */
  setTint(on: boolean): void {
    // With the zombie model, being infected swaps the whole body for it instead of a red veil.
    if (this.meshes.has('infected')) {
      if (on === this.infectedSkin) return;
      this.infectedSkin = on;
      this.setAppearance(this.appearance);
      return;
    }
    if (on === this.tinted) return;
    this.tinted = on;
    for (const mesh of this.meshes.values()) this.tint(mesh, on);
  }

  private tint(mesh: SkinnedMesh, on: boolean): void {
    const m = mesh.material as Material;
    if (!on) { mesh.material = (m.userData.untinted as Material | undefined) ?? m; return; }
    if (m.userData.untinted) return;
    const id = `${m.uuid}|infected`;
    let t = materialCache.get(id);
    if (!t) {
      t = (m as MeshStandardMaterial).clone();
      t.color.multiply(new Color(1, .42, .4));
      t.emissive.setRGB(.3, .015, .01);
      t.userData = { untinted: m };
      materialCache.set(id, t);
    }
    mesh.material = t;
  }

  private disposed = false;
  dispose(): void {
    this.disposed = true;
    this.hairStyle?.dispose(); this.hairStyle = null;
    this.group.removeFromParent();
    this.skeleton.dispose();
  }

  /* -------------------------------------------------------------------------------------------- */
  /*  Posing                                                                                       */
  /* -------------------------------------------------------------------------------------------- */

  /** Sets a bone's world rotation (its parent posed already this frame) and updates its matrix. */
  private setWorld(i: number, world: Quaternion): void {
    const parent = this.assets.bones[i]!.parent;
    const node = this.bones[i]!;
    if (parent >= 0) node.quaternion.copy(tmpQ[7]!.copy(this.worldQ[parent]!).invert().multiply(world));
    else node.quaternion.copy(world);
    this.worldQ[i]!.copy(world);
    node.updateWorldMatrix(false, false);
  }

  /** Back to the bind rotation (relative to its parent). */
  private setRest(i: number): void {
    const parent = this.assets.bones[i]!.parent;
    const node = this.bones[i]!;
    node.quaternion.copy(this.assets.bones[i]!.quaternion);
    this.worldQ[i]!.copy(parent >= 0 ? this.worldQ[parent]! : this.groupQ).multiply(node.quaternion);
    node.updateWorldMatrix(false, false);
  }

  private setLocal(i: number, local: Quaternion): void {
    const parent = this.assets.bones[i]!.parent;
    this.bones[i]!.quaternion.copy(local);
    this.worldQ[i]!.copy(parent >= 0 ? this.worldQ[parent]! : this.groupQ).multiply(local);
    this.bones[i]!.updateWorldMatrix(false, false);
  }

  private pos(i: number, out: Vector3): Vector3 { return out.setFromMatrixPosition(this.bones[i]!.matrixWorld); }

  private readonly groupQ = new Quaternion();
  private worldScale = 1;
  /** World height of the floor under the feet (the group's origin). */
  private groundY = 0;
  private bodyFloorOffset: number | null = null;

  /** Starts a frame: the group's world transform and the skeleton root at rest. */
  private begin(): void {
    this.newPoseFrame();
    this.group.updateWorldMatrix(true, false);
    this.group.matrixWorld.decompose(tmpV[0]!, this.groupQ, tmpV[1]!);
    this.worldScale = tmpV[1]!.x;
    this.groundY = tmpV[0]!.y;
    const root = this.assets.bones.findIndex((b) => b.parent < 0);
    this.setRest(root);
  }

  /** Bind-pose world rotation of a bone under the current group rotation, turned by `delta`. */
  private restWorld(i: number, delta: Quaternion, out: Quaternion): Quaternion {
    return out.copy(delta).multiply(this.groupQ).multiply(this.assets.restQ[i]!);
  }

  /** Follows the gameplay rig: spine, neck, arms (IK), hands and legs. */
  poseFromDriver(rig: DriverRig, req: PoseRequest): void {
    this.begin();
    const A = this.assets;
    rig.model.updateWorldMatrix(true, false);
    rig.root.updateMatrixWorld(true);
    const modelQ = rig.model.getWorldQuaternion(tmpQ[0]!).invert();
    const delta = (o: Object3D, out: Quaternion) => o.getWorldQuaternion(out).multiply(modelQ);
    const dRoot = delta(rig.root, new Quaternion()), dBody = delta(rig.body, new Quaternion()), dHead = delta(rig.head, new Quaternion());
    // Hips: where the rig's root carries them, plus the body's own offset (seats, crouch).
    const spine0 = this.spine[0]!;
    const hipsModel = tmpV[2]!.copy(A.restP[spine0]!).applyQuaternion(tmpQ[1]!.setFromAxisAngle(Y_AXIS, Math.PI)).multiplyScalar(HUMAN_SCALE);
    hipsModel.y += this.hipLift * HUMAN_SCALE - (req.hipDrop ?? 0) - .1 * req.land;
    // Recorded layers: the clip being left (crossfading out underneath) and the current one.
    const samples = req.mocap?.layers ?? (req.mocap ? [req.mocap] : []);
    const total = Math.min(1, samples.reduce((sum, m) => sum + m.weight, 0));
    let accumulated = 1 - total;
    const layers = samples.flatMap((m) => {
      const clip = m && m.weight > .001 ? this.assets.clips.get(m.clip) : undefined;
      if (!clip) return [];
      accumulated += m.weight;
      return [{ clip, frame: this.clipFrame(clip, m.time), weight: m.weight / Math.max(.001, accumulated), absolute: m.weight }];
    });
    const recorded = layers.length > 0;
    const legSamples = req.mocap?.legs ?? [];
    let legWeight = 1 - Math.min(1, legSamples.reduce((sum, m) => sum + m.weight, 0));
    const legLayers = legSamples.flatMap((m) => {
      const clip = A.clips.get(m.clip);
      if (!clip) return [];
      legWeight += m.weight;
      return [{ clip, frame: this.clipFrame(clip, m.time), weight: m.weight / Math.max(.001, legWeight) }];
    });
    const mixAll = (bones: number[], k = 1) => { for (const L of layers) for (const i of bones) this.mixClip(i, L.clip, L.frame, L.weight * k); };
    const upper = req.mocap?.upper, upperClip = upper && this.assets.clips.get(upper.clip);
    const upperWorld = new Map<number, Quaternion>();
    if (upper && upperClip) {
      const f = this.clipFrame(upperClip, upper.time);
      for (const i of this.order) {
        const track = upperClip.bones.get(i), p = A.bones[i]!.parent;
        const q = track ? new Quaternion().fromArray(track, f.i0 * 4).slerp(new Quaternion().fromArray(track, f.i1 * 4), f.u) : A.bones[i]!.quaternion.clone();
        upperWorld.set(i, (p >= 0 ? upperWorld.get(p)! : this.groupQ).clone().multiply(q));
      }
      const headingChange = this.groupQ.clone().multiply(this.upperHeading.clone().invert());
      const blend = 1 - Math.exp(-Math.max(0, req.dt) * 18);
      for (const [i, target] of upperWorld) {
        const cached = this.upperPoseWorld.get(i);
        if (cached) target.copy(cached.premultiply(headingChange).slerp(target, blend));
        else this.upperPoseWorld.set(i, target.clone());
      }
      this.upperHeading.copy(this.groupQ);
    } else {
      this.upperPoseWorld.clear(); this.upperHeading.copy(this.groupQ);
    }
    const mixUpper = (bones: number[]) => {
      // World-space overlay cancels the sprint pelvis' forward lean at the chest; applying
      // aiming locals on a differently tilted pelvis would bend the character twice.
      if (upper && upperClip) for (const i of bones) this.setWorld(i, this.bones[i]!.getWorldQuaternion(new Quaternion()).slerp(upperWorld.get(i)!, upper.weight));
    };
    const action = req.mocap?.action, actionClip = action && A.clips.get(action.clip);
    const actionFrame = actionClip && this.clipFrame(actionClip, action!.time);
    const mixAction = (bones: number[]) => {
      if (action && actionClip && actionFrame) for (const i of bones) this.mixClip(i, actionClip, actionFrame, action.weight);
    };
    if (recorded && req.mocap!.hips) {
      let off = 0;
      for (const { clip, frame, absolute } of layers) if (clip.hipsY.length) off += (clip.hipsY[frame.i0]! + (clip.hipsY[frame.i1]! - clip.hipsY[frame.i0]!) * frame.u) * absolute;
      hipsModel.y += off * HUMAN_SCALE;
    }
    // Recorded hips already contain crouch/prone height. The block driver's drop must fade
    // away with its pose, otherwise changing stance lowers the skinned body a second time.
    hipsModel.add(tmpV[3]!.copy(rig.body.position).sub(rig.bodyRest).multiplyScalar(1 - total));
    hipsModel.y -= .24 * SURVIVOR_SIZE * req.crouch * (1 - total);
    const recordedHips = hipsModel.clone().applyMatrix4(rig.rootRest).applyMatrix4(rig.root.parent!.matrixWorld);
    hipsModel.applyMatrix4(rig.root.matrixWorld).lerp(recordedHips, total);
    // Spine: the hips turn with the root, the chest with the body; flexing forward when tucked.
    const rel = tmpQ[2]!.copy(dBody).multiply(tmpQ[3]!.copy(dRoot).invert());
    const right = tmpV[4]!.set(-1, 0, 0).applyQuaternion(this.groupQ).applyQuaternion(dBody);
    const flex = tmpQ[4]!.setFromAxisAngle(right, -(1.05 * req.tuck + .32 * req.land + .12 * req.crouch));
    const node = this.bones[spine0]!;
    this.setWorld(spine0, this.restWorld(spine0, dRoot, tmpQ[5]!));
    node.position.copy(this.bones[spine0]!.parent!.worldToLocal(hipsModel.clone()));
    node.updateWorldMatrix(false, false);
    const share = [0, .3, .65, 1];
    for (let k = 1; k < this.spine.length; k++) {
      const d = tmpQ[5]!.slerpQuaternions(ID, rel, share[k]!).multiply(dRoot);
      d.premultiply(tmpQ[6]!.slerpQuaternions(ID, flex, k / 3));
      this.setWorld(this.spine[k]!, this.restWorld(this.spine[k]!, d, tmpQ[6]!.clone()));
    }
    const chest = tmpQ[3]!.copy(dBody).premultiply(flex);
    const headRel = tmpQ[2]!.copy(dHead).multiply(tmpQ[5]!.copy(dBody).invert());
    const nod = tmpQ[1]!.setFromAxisAngle(right, -.45 * req.tuck);
    this.neck.forEach((i, k) => {
      const d = tmpQ[5]!.slerpQuaternions(ID, headRel, (k + 1) / 3).premultiply(tmpQ[6]!.slerpQuaternions(ID, nod, (k + 1) / 3)).multiply(chest);
      this.setWorld(i, this.restWorld(i, d, tmpQ[6]!.clone()));
    });
    for (const s of ['L', 'R'] as const) this.setWorld(this.side[s].shoulder, this.restWorld(this.side[s].shoulder, chest, tmpQ[6]!.clone()));
    // Recorded trunk: hips, spine, neck, head and collar bones.
    // (Holding a gun the chest and collar bones mostly keep the aim: only part of the clip's turn.)
    if (recorded) {
      const holding = !req.mocap!.arms && (req.grasp.L || req.grasp.R);
      mixAll([spine0]);
      if (req.mocap?.alignForward) this.alignHeading(spine0, req.mocap.alignForward);
      mixAll([...this.spine.slice(1), ...this.neck, this.side.L.shoulder, this.side.R.shoulder], holding ? .35 : 1);
      mixUpper([...this.spine.slice(1), ...this.neck, this.side.L.shoulder, this.side.R.shoulder]);
      mixAction([...this.spine.slice(1), ...this.neck, this.side.L.shoulder, this.side.R.shoulder]);
      if (req.mocap?.alignForward) this.alignHeading(this.spine[this.spine.length - 1]!, req.mocap.alignForward * (1 - (action?.weight ?? 0)));
    }
    // Arms: each hand to what it holds, or where the rig's hand is. Free hands also go along with
    // what the survivor adds to the rig (the spine flexing in a tuck or a landing, the hips dropping).
    const bend = flex.clone(), pelvis = this.pos(spine0, new Vector3()), drop = (req.hipDrop ?? 0) + .1 * req.land;
    const up = new Vector3(0, 1, 0).applyQuaternion(chest);
    const fwd = new Vector3(0, 0, -1).applyQuaternion(rig.model.getWorldQuaternion(tmpQ[1]!)).applyQuaternion(dBody);
    for (const s of ['L', 'R'] as const) {
      const hand = s === 'L' ? rig.handL : rig.handR;
      const out = new Vector3(s === 'L' ? -1 : 1, 0, 0).applyQuaternion(rig.model.getWorldQuaternion(tmpQ[1]!)).applyQuaternion(dBody);
      const pole = up.clone().multiplyScalar(-1).addScaledVector(out, .55).addScaledVector(fwd, -.35);
      const grasp = req.grasp[s];
      if (recorded && req.mocap!.arms && !grasp) {
        // Recorded arms and fingers.
        const S = this.side[s];
        for (const i of [S.upperArm, S.upperArm1, S.forearm, S.forearm1, S.hand, ...S.fingers.flat()]) this.setRest(i);
        this.reachWith(s, req.reach?.[s] ?? rig.handGrip.clone().applyMatrix4(hand.matrixWorld), pole, req.hands[s], true);
        mixAll([S.upperArm, S.upperArm1, S.forearm, S.forearm1, S.hand, ...S.fingers.flat()]);
        mixUpper([S.upperArm, S.upperArm1, S.forearm, S.forearm1, S.hand, ...S.fingers.flat()]);
        mixAction([S.upperArm, S.upperArm1, S.forearm, S.forearm1, S.hand, ...S.fingers.flat()]);
        continue;
      }
      if (grasp) this.holdWith(s, grasp, pole, true);
      else {
        const given = req.reach?.[s];
        const target = given ?? rig.handGrip.clone().applyMatrix4(hand.matrixWorld).sub(pelvis).applyQuaternion(bend).add(pelvis);
        if (!given) target.y -= drop;
        this.reachWith(s, target, pole, req.hands[s], true);
      }
    }
    // Legs.
    for (const s of ['L', 'R'] as const) {
      this.poseLeg(s, s === 'L' ? rig.legL : rig.legR, delta, dRoot, req);
      if (recorded) { const S = this.side[s]; mixAll([S.thigh, S.thigh1, S.shin, S.shin1, S.foot, S.toe]); }
      const S = this.side[s];
      for (const L of legLayers) for (const i of [S.thigh, S.thigh1, S.shin, S.shin1, S.foot, S.toe]) this.mixClip(i, L.clip, L.frame, L.weight);
    }
    // Feet on the ground: a recorded leg is lifted (never pushed) so its foot does not sink below
    // where the rig's planted foot stands; then the ankle is levelled when it is flat on the floor.
    if (recorded && req.mocap?.aim) this.aimTorso(req.mocap.aim);
    if (recorded && req.plant > .5 && !req.mocap?.ground) for (const s of ['L', 'R'] as const) this.groundFoot(s, req.plant);
    // Rolling on the ground: the whole body rests on the floor (never floats, never sinks).
    if (recorded && req.mocap!.ground) this.groundBody(Math.min(1, req.mocap!.weight), req.mocap!.clip.startsWith('prone_') ? req.dt : 0);
    else this.bodyFloorOffset = null;
  }

  /** Keep source lean/roll, but make the anatomical forward axis share the gameplay heading. */
  private alignHeading(i: number, weight: number): void {
    const q = this.bones[i]!.getWorldQuaternion(new Quaternion());
    const forward = new Vector3(0, 0, 1).applyQuaternion(this.assets.restQ[i]!.clone().invert()).applyQuaternion(q);
    const desired = new Vector3(0, 0, 1).applyQuaternion(this.groupQ);
    const angle = Math.atan2(Math.sin(Math.atan2(desired.x, desired.z) - Math.atan2(forward.x, forward.z)), Math.cos(Math.atan2(desired.x, desired.z) - Math.atan2(forward.x, forward.z)));
    this.setWorld(i, new Quaternion().setFromAxisAngle(Y_AXIS, angle * weight).multiply(q));
    this.group.updateMatrixWorld(true);
    for (const j of this.order) this.bones[j]!.getWorldQuaternion(this.worldQ[j]!);
  }

  /** Share camera elevation and residual heading through the spine. Descendant arms keep
   * their local pose; final gun alignment handles only the remaining wrist-to-bore error. */
  private aimTorso(aim: { yaw: number; pitch: number; weight: number; rifle?: boolean }): void {
    const right = new Vector3(-1, 0, 0).applyQuaternion(this.groupQ);
    for (const [k, share] of [.2, .3, .5].entries()) {
      const i = this.spine[k + 1]!;
      const turn = new Quaternion().setFromAxisAngle(Y_AXIS, aim.yaw * share * aim.weight)
        .multiply(new Quaternion().setFromAxisAngle(right, (aim.pitch - (aim.rifle ? .12 : 0)) * share * aim.weight));
      this.setWorld(i, turn.multiply(this.bones[i]!.getWorldQuaternion(new Quaternion())));
      this.bones[i]!.updateMatrixWorld(true);
    }
    if (aim.rifle) for (const i of this.neck) {
      // A small chin tuck is shared along the neck, instead of resetting the head upright.
      this.setWorld(i, new Quaternion().setFromAxisAngle(right, -.18 * aim.weight / this.neck.length).multiply(this.bones[i]!.getWorldQuaternion(new Quaternion())));
      this.bones[i]!.updateMatrixWorld(true);
    }
    for (const j of this.order) this.bones[j]!.getWorldQuaternion(this.worldQ[j]!);
  }

  /** Moves the hips up or down until the lowest point of the body touches the floor. */
  private groundBody(weight: number, smoothDt = 0): void {
    const S = this.side, p = tmpV[9]!;
    let low = Infinity;
    for (const i of [...this.spine, ...this.neck, S.L.hand, S.R.hand, S.L.forearm, S.R.forearm, S.L.shin, S.R.shin, S.L.foot, S.R.foot, S.L.toe, S.R.toe]) low = Math.min(low, this.pos(i, p).y);
    // Bone centres sit inside the body: about a limb's thickness above the skin.
    const desired = this.groundY + .07 * this.worldScale - low;
    this.bodyFloorOffset = smoothDt > 0 && this.bodyFloorOffset !== null
      ? this.bodyFloorOffset + (desired - this.bodyFloorOffset) * (1 - Math.exp(-smoothDt * 10)) : desired;
    const shift = this.bodyFloorOffset * weight;
    const hips = this.bones[this.spine[0]!]!;
    hips.position.add(hips.parent!.worldToLocal(this.pos(this.spine[0]!, p).add(tmpV[10]!.set(0, shift, 0))).sub(hips.position));
    hips.updateMatrixWorld(true);
  }

  /** Keeps a foot from going through the floor (the hips' rest height above the ground). */
  private groundFoot(s: Side, plant: number): void {
    const S = this.side[s];
    const A = this.assets, ground = this.groundY;
    // Model units to world: the thigh's length now against its rest length.
    const k = this.pos(S.thigh, tmpV[9]!.clone()).distanceTo(this.pos(S.shin, tmpV[10]!.clone())) / Math.max(1e-6, A.restP[S.thigh]!.distanceTo(A.restP[S.shin]!));
    const sole = Math.min(A.restP[S.foot]!.y, A.restP[S.toe]!.y);
    const toe = this.pos(S.toe, tmpV[9]!.clone()), ankle = this.pos(S.foot, tmpV[10]!.clone());
    const low = Math.min(toe.y - (A.restP[S.toe]!.y - sole) * k, ankle.y - (A.restP[S.foot]!.y - sole) * k);
    if (low >= ground - 1e-3) return;
    // Bend the knee a little more (the thigh up) until the foot clears.
    const thigh = this.pos(S.thigh, tmpV[11]!.clone());
    const len = Math.max(.1, thigh.y - low);
    const lift = Math.min(.5, (ground - low) / len) * plant;
    const hipFrame = tmpQ[3]!.copy(this.worldQ[this.spine[0]!]!).multiply(tmpQ[4]!.copy(A.restQ[this.spine[0]!]!).invert());
    const right = tmpV[11]!.set(1, 0, 0).applyQuaternion(hipFrame);
    this.setWorld(S.thigh, tmpQ[1]!.copy(this.worldQ[S.thigh]!).premultiply(tmpQ[2]!.setFromAxisAngle(right, -lift)));
    for (const i of [S.thigh1, S.shin]) this.setLocal(i, tmpQ[1]!.copy(this.bones[i]!.quaternion));
    this.setLocal(S.shin, tmpQ[1]!.copy(this.bones[S.shin]!.quaternion).multiply(tmpQ[2]!.setFromAxisAngle(X_AXIS, lift * 2)));
    for (const i of [S.shin1, S.foot, S.toe]) this.setLocal(i, tmpQ[1]!.copy(this.bones[i]!.quaternion));
  }

  /** Poses one leg: the thigh as the rig's leg, the knee bent with the swing, the foot planted. */
  private poseLeg(s: Side, leg: Object3D, delta: (o: Object3D, out: Quaternion) => Quaternion, dRoot: Quaternion, req: PoseRequest): void {
    const S = this.side[s];
    const dLeg = delta(leg, tmpQ[1]!);
    const hips = this.worldQ[this.spine[0]!]!;
    // Pitch of the leg forward in the hips' frame (the source model faces +Z).
    const dir = tmpV[5]!.set(0, -1, 0).applyQuaternion(tmpQ[2]!.copy(dLeg).multiply(this.groupQ));
    const hipFrame = tmpQ[3]!.copy(hips).multiply(tmpQ[4]!.copy(this.assets.restQ[this.spine[0]!]!).invert());
    const fwd = tmpV[6]!.set(0, 0, 1).applyQuaternion(hipFrame), down = tmpV[7]!.set(0, -1, 0).applyQuaternion(hipFrame);
    let pitch = Math.atan2(dir.dot(fwd), dir.dot(down));
    const st = this.legState[s];
    const rate = req.dt > 0 ? (pitch - st.pitch) / req.dt : 0;
    st.pitch = pitch;
    // The knee lifts the foot while the leg swings forward through a step.
    const swingTarget = req.moving && req.plant > .5 ? Math.min(1, Math.max(0, rate * .16)) : 0;
    st.swing += (swingTarget - st.swing) * (1 - Math.exp(-req.dt * 14));
    let knee = pitch > 0 ? pitch * (.3 + .62 * smooth(.25, .95, pitch)) : -pitch * .55;
    knee += st.swing;
    // Crouch: the front leg's shin upright, the back knee down near the ground.
    const front = pitch >= 0;
    let hipBend = 0;
    if (req.crouch > .001) {
      const want = front ? 1.15 : -.28;
      hipBend += (want - pitch) * req.crouch;
      pitch = pitch + (want - pitch) * req.crouch;
      knee += ((front ? 1.2 : 1.75) - knee) * req.crouch;
    }
    // Tuck: knees up to the chest; landing: knees give.
    hipBend += (1.55 - pitch) * req.tuck + .5 * req.land;
    knee += (2.25 - knee) * req.tuck + .85 * req.land;
    knee = Math.min(2.45, Math.max(0, knee));
    const right = tmpV[8]!.set(1, 0, 0).applyQuaternion(hipFrame);
    const thighW = this.restWorld(S.thigh, dLeg, tmpQ[5]!).premultiply(tmpQ[6]!.setFromAxisAngle(right, -hipBend));
    this.setWorld(S.thigh, thighW);
    this.setRest(S.thigh1);
    this.setLocal(S.shin, tmpQ[6]!.copy(this.assets.bones[S.shin]!.quaternion).multiply(tmpQ[2]!.setFromAxisAngle(X_AXIS, knee)));
    this.setRest(S.shin1);
    // Foot: flat on the ground (heading only) when planted, else following the shin.
    const follow = tmpQ[3]!.copy(this.worldQ[S.shin1]!).multiply(this.assets.bones[S.foot]!.quaternion);
    const heading = tmpQ[4]!.copy(dRoot);
    heading.x = 0; heading.z = 0;
    if (heading.lengthSq() < 1e-8) heading.identity(); else heading.normalize();
    const flat = this.restWorld(S.foot, heading, tmpQ[6]!);
    // Pushing off: the heel rises as the leg goes back.
    const plant = req.plant * (1 - smooth(.25, .7, -pitch) * .7) * (1 - req.tuck);
    this.setWorld(S.foot, follow.slerp(flat, plant));
    this.setRest(S.toe);
  }

  /** Frame of a clip at time t (wrapping for loops). */
  private clipFrame(clip: Mocap, t: number): { i0: number; i1: number; u: number } {
    const last = clip.frames - 1;
    let f = (t / Math.max(1e-6, clip.duration)) * last;
    f = clip.loop ? ((f % last) + last) % last : Math.min(last, Math.max(0, f));
    const i0 = Math.floor(f);
    return { i0, i1: Math.min(last, i0 + 1), u: f - i0 };
  }

  /** Turns one bone's local rotation towards the clip's (by weight) and updates its matrix. */
  private mixClip(i: number, clip: Mocap, f: { i0: number; i1: number; u: number }, weight: number): void {
    const q = clip.bones.get(i);
    // Not in the clip: keep the pose, but under its (maybe moved) parent.
    if (!q) { this.setLocal(i, tmpQ[3]!.copy(this.bones[i]!.quaternion)); return; }
    const a = tmpQ[1]!.fromArray(q, f.i0 * 4), b = tmpQ[2]!.fromArray(q, f.i1 * 4);
    a.slerp(b, f.u).normalize();
    this.setLocal(i, tmpQ[3]!.copy(this.bones[i]!.quaternion).slerp(a, Math.min(1, weight)).normalize());
  }

  /* ---------------------------------------- arms ---------------------------------------- */

  /** Analytic two-bone correction in the reference pose's frames. The animated
   * roll is transported by shortest swings; IK never invents a new absolute arm basis. */
  private solveArm(s: Side, wrist: Vector3, pole: Vector3, handW: Quaternion | null, alignWrist = false, preservePose = false): void {
    const S = this.side[s], A = this.assets;
    if (!preservePose) for (const i of [S.upperArm, S.upperArm1, S.forearm, S.forearm1, S.hand]) this.setRest(i);
    const shoulder = this.pos(S.upperArm, new Vector3());
    const referenceElbow = this.pos(S.forearm, new Vector3());
    const referenceWrist = this.pos(S.hand, new Vector3());
    const referenceUpper = this.bones[S.upperArm]!.getWorldQuaternion(new Quaternion());
    const referenceLower = this.bones[S.forearm]!.getWorldQuaternion(new Quaternion());
    const referenceHand = this.bones[S.hand]!.getWorldQuaternion(new Quaternion());
    const upperDirection = referenceElbow.clone().sub(shoulder), lowerDirection = referenceWrist.clone().sub(referenceElbow);
    const a = upperDirection.length(), b = lowerDirection.length();
    const toTarget = wrist.clone().sub(shoulder);
    const d = Math.min(a + b - 1e-4, Math.max(Math.abs(a - b) + 1e-4, toTarget.length()));
    const u = toTarget.lengthSq() > 1e-10 ? toTarget.normalize() : new Vector3(0, -1, 0);
    const v = pole.clone().addScaledVector(u, -pole.dot(u));
    if (v.lengthSq() < 1e-8) {
      v.copy(referenceElbow).sub(shoulder).addScaledVector(u, -referenceElbow.clone().sub(shoulder).dot(u));
      if (v.lengthSq() < 1e-8) v.set(0, -1, 0).addScaledVector(u, u.y);
      if (v.lengthSq() < 1e-8) v.set(1, 0, 0).addScaledVector(u, -u.x);
    }
    v.normalize();
    if (alignWrist && handW) {
      const rest = A.restQ[S.forearm]!.clone().invert().multiply(A.restQ[S.hand]!);
      const desired = Y_AXIS.clone().applyQuaternion(handW.clone().multiply(rest.invert())).negate();
      desired.addScaledVector(u, -desired.dot(u));
      if (desired.lengthSq() > 1e-8) {
        desired.normalize();
        // Wrist placement may refine an authored elbow, but must not swing it across the chest.
        const angle = Math.atan2(new Vector3().crossVectors(v, desired).dot(u), v.dot(desired));
        const limit = preservePose ? .35 : Math.PI;
        v.applyAxisAngle(u, Math.max(-limit, Math.min(limit, angle)));
      }
    }
    const cosine = Math.min(1, Math.max(-1, (a * a + d * d - b * b) / (2 * a * d)));
    const elbow = shoulder.clone().addScaledVector(u, a * cosine).addScaledVector(v, a * Math.sqrt(1 - cosine * cosine));
    const end = shoulder.clone().addScaledVector(u, d);
    const upper = new Quaternion().setFromUnitVectors(upperDirection.normalize(), elbow.clone().sub(shoulder).normalize()).multiply(referenceUpper);
    const lower = new Quaternion().setFromUnitVectors(lowerDirection.normalize(), end.clone().sub(elbow).normalize()).multiply(referenceLower);
    this.setWorld(S.upperArm, upper);
    this.setRest(S.upperArm1);
    this.setWorld(S.forearm, lower);
    this.setRest(S.forearm1);
    if (!handW) { this.setRest(S.hand); return; }
    const referenceWristLocal = referenceLower.clone().invert().multiply(referenceHand);
    const difference = lower.clone().invert().multiply(handW).multiply(referenceWristLocal.invert()).normalize();
    // Swing/twist decomposition about the forearm's longitudinal Y axis.
    const angle = Math.max(-FOREARM_TWIST_MAX, Math.min(FOREARM_TWIST_MAX,
      2 * Math.atan2(difference.y * (difference.w < 0 ? -1 : 1), Math.abs(difference.w))));
    this.setLocal(S.forearm, this.bones[S.forearm]!.quaternion.clone().multiply(new Quaternion().setFromAxisAngle(Y_AXIS, angle * .5)));
    this.setLocal(S.forearm1, A.bones[S.forearm1]!.quaternion.clone().multiply(new Quaternion().setFromAxisAngle(Y_AXIS, angle * .5)));
    this.setWorld(S.hand, handW);
  }

  /** The hand closed round a handle, the arm reaching for it. */
  holdWith(s: Side, grasp: Grasp, pole: Vector3, fingers = true, alignWrist = false, preservePose = false): void {
    const frame = this.assets.hands[s];
    const handW = graspRotation(frame, grasp, new Quaternion());
    // The palm's grip line one handle radius from the handle's centre line.
    const wrist = grasp.center.clone().addScaledVector(grasp.approach, -grasp.radius * this.handleFit())
      .sub(frame.palm.clone().multiplyScalar(this.worldScale).applyQuaternion(handW));
    this.solveArm(s, wrist, pole, handW, alignWrist, preservePose);
    if (fingers) this.wrapFingers(s, grasp);
  }

  /**
   * The hand onto a grip from wherever the arm is now: the elbow stays on the side it is (a
   * recorded arm keeps its shape) unless `pole` says otherwise; the fingers close round it.
   */
  regrip(s: Side, grasp: Grasp, pole?: Vector3, weight = 1, alignWrist = false): void {
    if (weight < .001) return;
    const S = this.side[s];
    const chain = [S.upperArm, S.upperArm1, S.forearm, S.forearm1, S.hand, ...S.fingers.flat()];
    const before = weight < .999 ? chain.map((i) => this.bones[i]!.quaternion.clone()) : null;
    const elbow = pole ?? this.pos(S.forearm, new Vector3()).sub(this.pos(S.upperArm, new Vector3()).lerp(this.pos(S.hand, new Vector3()), .5));
    this.holdWith(s, grasp, elbow, true, alignWrist, true);
    if (before) {
      chain.forEach((i, k) => this.bones[i]!.quaternion.slerpQuaternions(before[k]!, this.bones[i]!.quaternion.clone(), weight));
      this.group.updateMatrixWorld(true);
      for (const i of this.order) this.bones[i]!.getWorldQuaternion(this.worldQ[i]!);
      this.fingerCache[s].key = '';
    }
  }

  /** Handles are gripped a little inside their radius (the palm's skin gives). */
  private handleFit(): number { return .92; }

  /** An empty hand: the palm towards `palm`, relaxed along the forearm, fingers in `preset`. */
  reachWith(s: Side, palm: Vector3, pole: Vector3, preset: HandPreset, fingers = true): void {
    const S = this.side[s];
    // The wrist sits a hand's length before the palm point, along the line from the shoulder.
    this.setRest(S.upperArm);
    const shoulder = this.pos(S.upperArm, tmpV[0]!.clone());
    const reach = palm.clone().sub(shoulder);
    const len = this.assets.hands[s].palm.length() * this.worldScale;
    const wrist = palm.clone().addScaledVector(reach.lengthSq() > 1e-8 ? reach.normalize() : new Vector3(0, -1, 0), -len);
    this.solveArm(s, wrist, pole, null);
    // A loose wrist: a little bend towards the palm.
    this.setLocal(S.hand, tmpQ[1]!.copy(this.assets.bones[S.hand]!.quaternion).multiply(tmpQ[2]!.setFromAxisAngle(X_AXIS, preset === 'fist' ? .05 : .15)));
    if (fingers) this.shapeFingers(s, preset);
  }

  /**
   * Where an object goes when this hand holds it: `grasp` is the handle in the object's own frame
   * without scale (as it would be with the object at the origin, unturned), `scale` the object's
   * scale. The object follows the hand (the body drives what it holds), never the other way round.
   */
  objectInHand(s: Side, grasp: Grasp, scale: Vector3): Matrix4 {
    const frame = this.assets.hands[s];
    const r0 = graspRotation(frame, grasp, new Quaternion());
    const wrist0 = grasp.center.clone().addScaledVector(grasp.approach, -grasp.radius * this.handleFit())
      .sub(frame.palm.clone().multiplyScalar(this.worldScale).applyQuaternion(r0));
    const h0 = new Matrix4().compose(wrist0, r0, new Vector3(this.worldScale, this.worldScale, this.worldScale));
    return this.bones[this.side[s].hand]!.matrixWorld.clone().multiply(h0.invert()).multiply(new Matrix4().makeScale(scale.x, scale.y, scale.z));
  }

  /** World position of a named bone (after posing). */
  bonePosition(name: string, out = new Vector3()): Vector3 { return this.pos(this.assets.index.get(name)!, out); }

  /** World matrix of a hand bone (after posing). */
  handMatrix(s: Side): Matrix4 { return this.bones[this.side[s].hand]!.matrixWorld.clone(); }

  /** Palm contact frame for props carried by this hand. */
  palmMatrix(s: Side): Matrix4 {
    return this.handMatrix(s).multiply(new Matrix4().makeTranslation(...this.assets.hands[s].palm.toArray()));
  }

  /** First-person support hand follows the recording relative to the hand holding the gun.
   * The camera weapon can sway/recoil independently; fixed bone lengths are solved by IK. */
  reloadSupport(layer: MocapLayer): void {
    const clip = this.assets.clips.get(layer.clip);
    if (!clip || layer.weight < .001) return;
    const frame = this.clipFrame(clip, layer.time), matrices: Matrix4[] = [], rotations: Quaternion[] = [];
    for (const i of this.order) {
      const b = this.assets.bones[i]!, track = clip.bones.get(i);
      const q = track ? new Quaternion().fromArray(track, frame.i0 * 4).slerp(new Quaternion().fromArray(track, frame.i1 * 4), frame.u) : b.quaternion.clone();
      rotations[i] = q;
      const local = new Matrix4().compose(b.position, q, b.scale);
      matrices[i] = b.parent >= 0 ? matrices[b.parent]!.clone().multiply(local) : local;
    }
    const S = this.side.L;
    const mapping = this.handMatrix('R').multiply(matrices[this.side.R.hand]!.clone().invert());
    const target = mapping.clone().multiply(matrices[S.hand]!);
    const wrist = new Vector3().setFromMatrixPosition(target), rotation = new Quaternion();
    target.decompose(new Vector3(), rotation, new Vector3());
    const elbow = new Vector3().setFromMatrixPosition(matrices[S.forearm]!).applyMatrix4(mapping);
    const pole = elbow.sub(this.pos(S.upperArm, new Vector3()).lerp(wrist, .5));
    const chain = [S.upperArm, S.upperArm1, S.forearm, S.forearm1, S.hand, ...S.fingers.flat()];
    const before = chain.map((i) => this.bones[i]!.quaternion.clone());
    this.solveArm('L', wrist, pole, rotation, true, true);
    for (const i of S.fingers.flat()) this.setLocal(i, rotations[i]!);
    chain.forEach((i, k) => this.bones[i]!.quaternion.slerpQuaternions(before[k]!, this.bones[i]!.quaternion.clone(), layer.weight));
    this.group.updateMatrixWorld(true);
    for (const i of this.order) this.bones[i]!.getWorldQuaternion(this.worldQ[i]!);
    this.fingerCache.L.key = '';
  }

  /** Follow the bore relative to the recorded neck, preserving its crouch and cheek tilt. */
  lookAlong(direction: Vector3, weight: number): void {
    const forward = new Vector3(0, 0, 1).applyQuaternion(this.groupQ);
    const turn = new Quaternion().setFromUnitVectors(forward, direction.clone().normalize());
    // Keep the recorded lower neck and its lowered head position. Only orient the skull onto
    // the sights; copying all source head pitch would leave the eyes looking at the ground.
    const i = this.neck[this.neck.length - 1]!;
    const right = new Vector3(-1, 0, 0).applyQuaternion(this.groupQ);
    const goal = new Quaternion().setFromAxisAngle(direction.clone().normalize(), -.10)
      .multiply(new Quaternion().setFromAxisAngle(right, -.10)).multiply(turn).multiply(this.groupQ).multiply(this.assets.restQ[i]!);
    this.setWorld(i, this.bones[i]!.getWorldQuaternion(new Quaternion()).slerp(goal, weight));
    this.bones[i]!.updateMatrixWorld(true);
  }

  /**
   * Looking round as a person does: the eyes lead, the head and neck take most of the turn and
   * the chest follows with `chestShare` of it (the feet turn later, at the root). `yaw` is
   * relative to the body, `pitch` up positive (radians).
   */
  lookAround(yaw: number, pitch: number, chestShare = .3): void {
    if (Math.abs(yaw) < 1e-4 && Math.abs(pitch) < 1e-4) return;
    if (chestShare > 0) this.turnChest(new Quaternion().setFromAxisAngle(Y_AXIS, yaw * chestShare).multiply(
      new Quaternion().setFromAxisAngle(X_AXIS.clone().applyQuaternion(this.groupQ), -pitch * .25 * chestShare)));
    const n = this.neck.length, headYaw = yaw * (1 - chestShare), headPitch = pitch * (1 - .25 * chestShare);
    this.neck.forEach((i, k) => {
      // Lower joints take less; the skull the most.
      const share = (k + 1) / (n * (n + 1) / 2);
      const forward = new Vector3(0, 0, 1).applyQuaternion(this.groupQ).applyAxisAngle(Y_AXIS, headYaw);
      const axis = new Vector3().crossVectors(forward, Y_AXIS).normalize();
      const turn = new Quaternion().setFromAxisAngle(Y_AXIS, headYaw * share).premultiply(new Quaternion().setFromAxisAngle(axis, headPitch * share));
      this.setWorld(i, turn.multiply(this.bones[i]!.getWorldQuaternion(new Quaternion())));
      this.bones[i]!.updateMatrixWorld(true);
    });
    for (const i of this.order) this.bones[i]!.getWorldQuaternion(this.worldQ[i]!);
  }

  /** Head carried upright, looking along `direction`: the neck straightens towards its bind
   * shape (lower joints less), so a recording's lowered sighting head does not read as a hunch. */
  headUp(direction: Vector3, weight: number): void {
    if (weight < .001) return;
    const forward = new Vector3(0, 0, 1).applyQuaternion(this.groupQ);
    const look = direction.clone().normalize();
    // Eyes level with the aim, but never tipped back past it.
    const turn = new Quaternion().setFromUnitVectors(forward, look);
    this.neck.forEach((i, k) => {
      const goal = turn.clone().multiply(this.groupQ).multiply(this.assets.restQ[i]!);
      this.setWorld(i, this.bones[i]!.getWorldQuaternion(new Quaternion()).slerp(goal, weight * (k + 1) / this.neck.length));
      this.bones[i]!.updateMatrixWorld(true);
    });
    for (const i of this.order) this.bones[i]!.getWorldQuaternion(this.worldQ[i]!);
  }

  /** Cheek skin beside the firing eye, in the actual posed/scaled head frame. */
  rifleCheek(side: Side): Vector3 {
    return this.cheekLocal(side).applyMatrix4(this.bones[this.assets.index.get('spine_006')!]!.matrixWorld);
  }

  /** The firing cheek in the head bone's own frame. */
  private cheekLocal(side: Side): Vector3 {
    const A = this.assets, head = A.index.get('spine_006')!;
    const eyes = A.parts.get('eyes')!.geometry;
    if (!eyes.boundingBox) eyes.computeBoundingBox();
    const p = eyes.boundingBox!.getCenter(new Vector3());
    p.x += side === 'R' ? -.045 : .045;
    p.y -= .04; p.z -= .015;
    return p.sub(A.restP[head]!).applyQuaternion(A.restQ[head]!.clone().invert());
  }

  /** Wrist-to-gun binding from the supplied rifle aiming reference, independent of gameplay
   * poses. This preserves the FBX elbow/wrist pose instead of calibrating against procedural IK. */
  rifleGripBasis(s: Side, barrel: Vector3, up: Vector3): { axis: Vector3; approach: Vector3 } {
    const key = `${s}:${barrel.toArray()}:${up.toArray()}`;
    let result = this.gripBasisCache.get(key);
    if (result) return { axis: result.axis.clone(), approach: result.approach.clone() };
    const clip = this.assets.clips.get('rifle_aim_idle');
    const rotations: Quaternion[] = [];
    for (const i of this.order) {
      const b = this.assets.bones[i]!, track = clip?.bones.get(i);
      const q = track ? new Quaternion().fromArray(track, 0) : b.quaternion;
      rotations[i] = (b.parent >= 0 ? rotations[b.parent]! : ID).clone().multiply(q);
    }
    const forward = barrel.clone().normalize(), side = new Vector3().crossVectors(forward, up).normalize();
    const vertical = new Vector3().crossVectors(side, forward).normalize();
    const gun = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(new Vector3(0, 0, 1), Y_AXIS, new Vector3(-1, 0, 0))
      .multiply(new Matrix4().makeBasis(forward, vertical, side).transpose()));
    const hand = gun.invert().multiply(rotations[this.side[s].hand]!);
    const frame = this.assets.hands[s];
    result = { axis: frame.across.clone().negate().applyQuaternion(hand).normalize(), approach: frame.normal.clone().applyQuaternion(hand).normalize() };
    this.gripBasisCache.set(key, result);
    return { axis: result.axis.clone(), approach: result.approach.clone() };
  }

  /** Moves a shoulder joint (first-person arms: the shoulders themselves are never seen). */
  placeShoulder(s: Side, world: Vector3): void {
    const node = this.bones[this.side[s].upperArm]!;
    node.position.copy(node.parent!.worldToLocal(world.clone()));
    node.updateWorldMatrix(false, false);
  }

  /**
   * The support hand under a handguard: fingers only lightly bent, so the guard rests across the
   * palm and finger roots instead of the whole hand closing round it.
   */
  cradle(s: Side): void {
    this.shapeFingers(s, 'relaxed');
  }

  /** Every finger joint's local turn for a hand shape: the gun's own curls, a Hand Studio pose, or a standard shape. */
  private poseTurns(preset: HandPreset, out: Quaternion[], trigger = false): Quaternion[] {
    const own = this.shapeOverrides?.[preset];
    const studio = own ? undefined : handPose(preset);
    const P = own ?? PRESETS[preset as BasicHandPreset] ?? PRESETS.relaxed;
    FINGERS.forEach((f, fi) => [1, 2, 3].forEach((k, j) => {
      const q = out[fi * 3 + j] ??= new Quaternion();
      const e = studio && !(fi === 0 && trigger) ? studio.bones[`${f}_0${k}`] : null;
      if (studio) q.setFromEuler(tmpE.set(e?.[0] ?? (fi === 0 && trigger ? TRIGGER_CURL[j]! : 0), e?.[1] ?? 0, e?.[2] ?? 0));
      else q.setFromAxisAngle(X_AXIS, (fi === 4 ? P.thumb : fi === 0 && trigger ? TRIGGER_CURL : P.finger)[j]!);
    }));
    return out;
  }

  /**
   * Hand pose `a`, or on its way from `a` to `b` (`u` 0…1): each finger joint turns smoothly from
   * one to the other, so a fist opens gradually rather than snapping open.
   */
  applyHandPose(s: Side, a: HandPreset, b?: HandPreset, u = 0): void {
    const S = this.side[s];
    const qa = this.poseTurns(a, this.turnsA), qb = b && b !== a && u > 0 ? this.poseTurns(b, this.turnsB) : null;
    // The wrist first (the fingers hang from it).
    const wa = this.wristTurn(a, tmpQ[3]!), wb = qb ? this.wristTurn(b!, tmpQ[4]!) : null;
    this.turnWrist(s, wb ? wa.slerp(wb, Math.min(1, u)) : wa);
    S.fingers.forEach((chain, f) => chain.forEach((i, k) => {
      const q = tmpQ[1]!.copy(qa[f * 3 + k]!);
      if (qb) q.slerp(qb[f * 3 + k]!, Math.min(1, u));
      this.setLocal(i, tmpQ[2]!.copy(this.assets.bones[i]!.quaternion).multiply(q));
    }));
    this.fingerCache[s].key = '';
  }
  /** The wrist's turn in a Hand Studio pose (none for the standard shapes). */
  private wristTurn(preset: HandPreset, out: Quaternion): Quaternion {
    const e = this.shapeOverrides?.[preset] ? undefined : handPose(preset)?.bones.hand;
    return e ? out.setFromEuler(tmpE.set(e[0], e[1], e[2])) : out.identity();
  }
  /** Where the arm put the hand this frame, before a pose's wrist turn (the Studio edits from it). */
  readonly wristBase: Record<Side, Quaternion> = { L: new Quaternion(), R: new Quaternion() };
  private readonly wristTurned: Record<Side, boolean> = { L: false, R: false };
  /** A new frame of posing: the next wrist turn starts from where the arm puts the hand. */
  newPoseFrame(): void { this.wristTurned.L = this.wristTurned.R = false; }
  private turnWrist(s: Side, turn: Quaternion): void {
    const i = this.side[s].hand;
    // A second pose on the same hand this frame (the Studio's) turns from the arm's hand, not on top.
    if (this.wristTurned[s]) this.setLocal(i, tmpQ[6]!.copy(this.wristBase[s]));
    else this.wristBase[s].copy(this.bones[i]!.quaternion);
    this.wristTurned[s] = true;
    if (turn.w < .99999) this.setLocal(i, tmpQ[5]!.copy(this.bones[i]!.quaternion).multiply(turn));
  }
  private readonly turnsA: Quaternion[] = [];
  private readonly turnsB: Quaternion[] = [];

  private readonly fingerPrev = new Map<number, Quaternion>();
  /**
   * First person: each finger eased from where it was last frame toward this frame's pose (`k`
   * the share of the way, from the frame time), so a hand opening or closing round a grip moves
   * smoothly instead of snapping.
   */
  easeFingers(k: number): void {
    for (const s of ['L', 'R'] as const) for (const chain of this.side[s].fingers) for (const i of chain) {
      const now = this.bones[i]!.quaternion, prev = this.fingerPrev.get(i);
      if (prev && k < 1) this.setLocal(i, prev.slerp(now, k).clone());
      if (prev) prev.copy(this.bones[i]!.quaternion); else this.fingerPrev.set(i, this.bones[i]!.quaternion.clone());
    }
  }

  /** The finger bones of a hand (index, middle, ring, pinky, thumb; base to tip) and the hand bone. */
  handBones(s: Side): { hand: Bone; fingers: Bone[][] } {
    const S = this.side[s];
    return { hand: this.bones[S.hand]!, fingers: S.fingers.map((chain) => chain.map((i) => this.bones[i]!)) };
  }

  /** A finger bone's turn from its bind pose (what a Hand Studio pose stores). */
  boneTurn(bone: Bone): Quaternion {
    const i = this.bones.indexOf(bone);
    // The wrist: from where the arm put it this frame.
    for (const s of ['L', 'R'] as const) if (i === this.side[s].hand) return this.wristBase[s].clone().invert().multiply(bone.quaternion);
    return this.assets.bones[i]!.quaternion.clone().invert().multiply(bone.quaternion);
  }

  private shapeFingers(s: Side, preset: HandPreset, trigger = false): void {
    if (!this.shapeOverrides?.[preset] && handPose(preset)) {
      const S = this.side[s], q = this.poseTurns(preset, this.turnsA, trigger);
      this.turnWrist(s, this.wristTurn(preset, tmpQ[3]!));
      S.fingers.forEach((chain, f) => chain.forEach((i, k) => this.setLocal(i, tmpQ[1]!.copy(this.assets.bones[i]!.quaternion).multiply(q[f * 3 + k]!))));
      this.fingerCache[s].key = '';
      return;
    }
    const S = this.side[s], P = this.shapeOverrides?.[preset] ?? PRESETS[preset as BasicHandPreset] ?? PRESETS.relaxed;
    S.fingers.forEach((chain, f) => {
      const curl = f === 4 ? P.thumb : f === 0 && trigger ? TRIGGER_CURL : P.finger;
      chain.forEach((i, k) => this.setLocal(i, tmpQ[1]!.copy(this.assets.bones[i]!.quaternion).multiply(tmpQ[2]!.setFromAxisAngle(X_AXIS, curl[k]!))));
    });
    this.fingerCache[s].key = '';
  }

  /**
   * Closes each finger round the handle: every joint curls just until the next joint (or the
   * finger tip) touches the handle's surface. Cached while the handle stays put in the hand.
   */
  private wrapFingers(s: Side, grasp: Grasp): void {
    const S = this.side[s], A = this.assets, cache = this.fingerCache[s];
    const handM = this.bones[S.hand]!.matrixWorld;
    const inv = tmpM.copy(handM).invert();
    const c = grasp.center.clone().applyMatrix4(inv), ax = grasp.axis.clone().transformDirection(inv);
    const key = `${c.x.toFixed(3)},${c.y.toFixed(3)},${c.z.toFixed(3)},${ax.x.toFixed(2)},${ax.y.toFixed(2)},${ax.z.toFixed(2)},${grasp.radius.toFixed(3)},${grasp.trigger ? 1 : 0},${grasp.profile?.key ?? ''}`;
    const reuse = cache.key === key;
    const angles: number[] = reuse ? cache.angles : [];
    const reach = grasp.radius * this.handleFit() + FINGER_SKIN * this.worldScale;
    const line = grasp.center, dir = grasp.axis;
    const p = new Vector3(), q = new Quaternion();
    const distance = (pt: Vector3) => { p.subVectors(pt, line); p.addScaledVector(dir, -p.dot(dir)); return p.length(); };
    const radial = grasp.approach.clone().addScaledVector(dir, -grasp.approach.dot(dir)).normalize();
    const tangent = new Vector3().crossVectors(dir, radial).normalize();
    const clearance = (pt: Vector3) => {
      if (!grasp.profile) return distance(pt) - reach;
      const delta = pt.clone().sub(line), offset = delta.dot(dir);
      const angle = Math.atan2(delta.dot(tangent), delta.dot(radial));
      const rings = grasp.profile.rings;
      let i = 0;
      while (i < rings.length - 2 && offset > rings[i + 1]!.offset) i++;
      const r0 = rings[i]!, r1 = rings[i + 1]!;
      const sample = (r: typeof r0) => {
        const u = ((angle / (2 * Math.PI) + 1) % 1) * r.radii.length;
        const a = Math.floor(u), b = (a + 1) % r.radii.length;
        return r.radii[a]! + (r.radii[b]! - r.radii[a]!) * (u - a);
      };
      const u = Math.min(1, Math.max(0, (offset - r0.offset) / (r1.offset - r0.offset)));
      const radius = sample(r0) * (1 - u) + sample(r1) * u;
      return distance(pt) - radius * this.handleFit() - FINGER_SKIN * this.worldScale;
    };
    S.fingers.forEach((chain, f) => {
      const max = f === 4 ? MAX_THUMB : MAX_CURL;
      chain.forEach((i, k) => {
        const rest = A.bones[i]!.quaternion;
        if (reuse) { this.setLocal(i, q.copy(rest).multiply(tmpQ[2]!.setFromAxisAngle(X_AXIS, angles[f * 3 + k]!))); return; }
        if (f === 0 && grasp.trigger) { angles[f * 3 + k] = TRIGGER_CURL[k]!; this.setLocal(i, q.copy(rest).multiply(tmpQ[2]!.setFromAxisAngle(X_AXIS, TRIGGER_CURL[k]!))); return; }
        // The point this joint swings: the next joint, or the finger tip.
        const next = k < 2 ? this.bones[chain[k + 1]!]!.position : this.bones[i]!.position.clone().multiplyScalar(.85);
        const tip = new Vector3();
        const at = (theta: number) => {
          this.setLocal(i, q.copy(rest).multiply(tmpQ[2]!.setFromAxisAngle(X_AXIS, theta)));
          tip.copy(k < 2 ? next : Y_AXIS).multiplyScalar(k < 2 ? 1 : next.length()).applyMatrix4(this.bones[i]!.matrixWorld);
          return clearance(tip);
        };
        const STEPS = 10;
        let lo = -.05, best = lo, bestErr = Infinity, found = false;
        for (let n = 0; n <= STEPS; n++) {
          const theta = -.05 + (max[k]! + .05) * (n / STEPS);
          const err = at(theta);
          if (Math.abs(err) < bestErr) { bestErr = Math.abs(err); best = theta; }
          if (err <= 0) {
            // Bisect between the last open angle and this one.
            let hi = theta;
            for (let it = 0; it < 6; it++) { const mid = (lo + hi) / 2; if (at(mid) <= 0) hi = mid; else lo = mid; }
            best = hi; found = true; break;
          }
          lo = theta;
        }
        if (!found && bestErr > reach * 3) best = PRESETS.fist.finger[k]! * (f === 4 ? .5 : .9);
        angles[f * 3 + k] = best;
        this.setLocal(i, q.copy(rest).multiply(tmpQ[2]!.setFromAxisAngle(X_AXIS, best)));
      });
    });
    cache.key = key;
    cache.angles = angles;
  }

  /* ------------------------------- recorded pose (no driver) ------------------------------- */

  private legSet: Set<number> | null = null;
  private upperSet: Set<number> | null = null;
  private readonly localQ: Quaternion[] = [];

  private boneSets(): { legs: Set<number>; upper: Set<number> } {
    if (!this.legSet || !this.upperSet) {
      const S = this.side;
      this.legSet = new Set((['L', 'R'] as const).flatMap((s) => [S[s].thigh, S[s].thigh1, S[s].shin, S[s].shin1, S[s].foot, S[s].toe]));
      // Everything above the lower back: spine, neck, head, collar bones, arms and fingers.
      const upper = new Set<number>([this.spine[1]!]);
      for (const i of this.order) if (upper.has(this.assets.bones[i]!.parent)) upper.add(i);
      this.upperSet = upper;
    }
    return { legs: this.legSet, upper: this.upperSet };
  }

  /**
   * Catmull-Rom between the recording's 30 fps keys (quaternion components on one hemisphere,
   * then normalized). Linear keys put a velocity kink at every key, which reads as stutter on
   * fast clips such as running.
   */
  private sampleInto(out: Quaternion, clip: Mocap, i: number, f: { i0: number; i1: number; u: number }): boolean {
    const track = clip.bones.get(i);
    if (!track) return false;
    const [im, ip] = this.neighbours(clip, f);
    const a = im * 4, b = f.i0 * 4, c = f.i1 * 4, d = ip * 4, u = f.u, u2 = u * u, u3 = u2 * u;
    const sign = (k: number) => (track[k]! * track[b]! + track[k + 1]! * track[b + 1]! + track[k + 2]! * track[b + 2]! + track[k + 3]! * track[b + 3]! < 0 ? -1 : 1);
    const sa = sign(a), sc = sign(c), sd = sign(d);
    const v = [0, 0, 0, 0];
    for (let k = 0; k < 4; k++) {
      const p0 = track[a + k]! * sa, p1 = track[b + k]!, p2 = track[c + k]! * sc, p3 = track[d + k]! * sd;
      v[k] = .5 * (2 * p1 + (p2 - p0) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (3 * p1 - p0 - 3 * p2 + p3) * u3);
    }
    out.set(v[0]!, v[1]!, v[2]!, v[3]!).normalize();
    return true;
  }

  /** Keys before `i0` and after `i1` (wrapping loops, whose last key repeats the first). */
  private neighbours(clip: Mocap, f: { i0: number; i1: number }): [number, number] {
    const last = clip.frames - 1;
    if (clip.loop && last > 1) return [f.i0 > 0 ? f.i0 - 1 : last - 1, f.i1 < last ? f.i1 + 1 : 1];
    return [Math.max(0, f.i0 - 1), Math.min(last, f.i1 + 1)];
  }

  /** Recorded hip height, interpolated like the rotations. */
  private sampleHips(clip: Mocap, f: { i0: number; i1: number; u: number }): number {
    const h = clip.hipsY, [im, ip] = this.neighbours(clip, f), u = f.u;
    const p0 = h[im]!, p1 = h[f.i0]!, p2 = h[f.i1]!, p3 = h[ip]!;
    return .5 * (2 * p1 + (p2 - p0) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (3 * p1 - p0 - 3 * p2 + p3) * u * u * u);
  }

  /**
   * The body exactly as recorded: crossfaded clips blended per bone in local space (whole body,
   * then responsive legs, then the upper-body overlay and an action such as a reload). Nothing
   * procedural is mixed underneath, so joints keep the recording's proportions and roll.
   */
  poseMocap(m: MocapPose, dt: number): void {
    this.begin();
    const A = this.assets, { legs, upper } = this.boneSets();
    const q = this.localQ, s = tmpQ[5]!;
    for (const i of this.order) (q[i] ??= new Quaternion()).copy(A.bones[i]!.quaternion);
    // `whole`: a bone the clip does not animate is at its bind pose in that clip (the plain stand
    // has no leg tracks): blending it in must straighten the legs too, not leave the outgoing
    // clip's legs at full weight until its layer is dropped (the foot then snapped down).
    const blend = (layers: MocapLayer[], only: Set<number> | null, whole = false) => {
      let acc = 1 - Math.min(1, layers.reduce((sum, l) => sum + l.weight, 0));
      for (const l of layers) {
        const clip = l.weight > .001 ? A.clips.get(l.clip) : undefined;
        if (!clip) continue;
        acc += l.weight;
        const k = Math.min(1, l.weight / Math.max(.001, acc)), f = this.clipFrame(clip, l.time);
        for (const i of this.order) {
          if (only && !only.has(i)) continue;
          if (this.sampleInto(s, clip, i, f)) q[i]!.slerp(s, k);
          else if (whole) q[i]!.slerp(A.bones[i]!.quaternion, k);
        }
      }
    };
    const base = m.layers ?? [m];
    blend(base, null, true);
    if (m.legs?.length) blend(m.legs, legs);
    if (m.uppers?.length) blend(m.uppers, upper);
    if (m.damp) {
      // Toward the mean pose of the recordings, crossfaded like the recordings themselves
      // (switching to the dominant one's mean halfway through a crossfade popped the trunk).
      const means: Array<{ mean: Map<number, Quaternion>; weight: number }> = [];
      for (const l of base) { const clip = l.weight > .001 ? A.clips.get(l.clip) : undefined; if (clip) means.push({ mean: this.clipMean(clip), weight: l.weight }); }
      if (means.length) {
        const S = this.side, t = tmpQ[6]!;
        const meanOf = (i: number): Quaternion | null => {
          let acc = 0, found = false;
          for (const m of means) {
            const r = m.mean.get(i);
            if (!r) continue;
            acc += m.weight;
            if (!found) { t.copy(r); found = true; } else t.slerp(r, m.weight / acc);
          }
          return found ? t : null;
        };
        const damp = (bones: number[], k: number) => { for (const i of bones) { const target = meanOf(i); if (target) q[i]!.slerp(target, k); } };
        if (m.damp.hips) damp([this.spine[0]!], m.damp.hips);
        if (m.damp.arms) damp((['L', 'R'] as const).flatMap((sd) => [S[sd].shoulder, S[sd].upperArm, S[sd].upperArm1, S[sd].forearm, S[sd].forearm1, S[sd].hand]), m.damp.arms);
      }
    }
    for (const overlay of [m.upper, m.action]) {
      const clip = overlay && overlay.weight > .001 ? A.clips.get(overlay.clip) : undefined;
      if (!clip) continue;
      const f = this.clipFrame(clip, overlay!.time), w = Math.min(1, overlay!.weight);
      for (const i of upper) if (this.sampleInto(s, clip, i, f)) q[i]!.slerp(s, w);
    }
    for (const i of this.order) this.bones[i]!.quaternion.copy(q[i]!);
    // Hips height: the recording's offset (crouch, prone, bob) over the rest height.
    const spine0 = this.spine[0]!, hips = this.bones[spine0]!;
    let lift = this.hipLift;
    if (m.hips) {
      let total = 0;
      for (const l of base) {
        const clip = A.clips.get(l.clip);
        if (!clip?.hipsY.length || l.weight <= .001) continue;
        const f = this.clipFrame(clip, l.time);
        const mean = clip.hipsY.reduce((sum, y) => sum + y, 0) / clip.hipsY.length;
        lift += (mean + (this.sampleHips(clip, f) - mean) * (m.bob ?? 1)) * l.weight;
        total += l.weight;
      }
      if (total > 1) lift /= total;
    }
    const parent = A.bones[spine0]!.parent;
    const target = tmpV[0]!.copy(A.restP[spine0]!).setY(A.restP[spine0]!.y + lift);
    if (m.hipsAt) target.lerp(tmpV[1]!.set(A.restP[spine0]!.x, m.hipsAt.y, m.hipsAt.z), m.hipsAt.weight);
    if (parent >= 0) target.sub(A.restP[parent]!).applyQuaternion(tmpQ[0]!.copy(A.restQ[parent]!).invert());
    hips.position.copy(target);
    this.group.updateMatrixWorld(true);
    for (const i of this.order) this.bones[i]!.getWorldQuaternion(this.worldQ[i]!);
    if (m.alignForward) {
      this.alignHeading(spine0, m.alignForward);
      this.alignHeading(this.spine[this.spine.length - 1]!, m.alignForward * (1 - (m.action?.weight ?? 0)));
    }
    if (m.lean) this.turnChest(new Quaternion().setFromAxisAngle(X_AXIS.clone().applyQuaternion(this.groupQ), m.lean));
    if (m.ground) this.groundBody(Math.min(1, m.weight), m.clip.startsWith('prone_') ? dt : 0);
    else this.bodyFloorOffset = null;
  }

  private readonly means = new Map<string, Map<number, Quaternion>>();

  /** Average local rotation of each animated bone over a clip (cached). */
  private clipMean(clip: Mocap): Map<number, Quaternion> {
    let mean = this.means.get(clip.name);
    if (mean) return mean;
    mean = new Map();
    for (const [i, track] of clip.bones) {
      const sum = [0, 0, 0, 0], n = track.length / 4;
      for (let f = 0; f < n; f++) {
        const sign = track[f * 4]! * track[0]! + track[f * 4 + 1]! * track[1]! + track[f * 4 + 2]! * track[2]! + track[f * 4 + 3]! * track[3]! < 0 ? -1 : 1;
        for (let k = 0; k < 4; k++) sum[k]! += track[f * 4 + k]! * sign;
      }
      mean.set(i, new Quaternion(sum[0], sum[1], sum[2], sum[3]).normalize());
    }
    this.means.set(clip.name, mean);
    return mean;
  }

  /** Turns the chest (shared by the three upper spine joints) by a world rotation, e.g. to bring
   * a rigidly held gun onto the aim. Arms, hands and the gun follow as children. */
  turnChest(rotation: Quaternion, weight = 1): void {
    if (weight < .001) return;
    const part = tmpQ[4]!.identity().slerp(rotation, weight / 3);
    // Each joint takes a third on top of what its parent already turned.
    for (const i of this.spine.slice(1)) this.setWorld(i, part.clone().multiply(this.bones[i]!.getWorldQuaternion(tmpQ[3]!)));
    this.group.updateMatrixWorld(true);
    for (const i of this.order) this.bones[i]!.getWorldQuaternion(this.worldQ[i]!);
  }

  /**
   * Brings the firing cheek down onto a stock contact point (world) by tilting the neck, bounded
   * to `maxAngle`. The head goes to the gun; the gun stays in the hands.
   */
  cheekTo(side: Side, contact: Vector3, weight: number, maxAngle = .45): void {
    if (weight < .001) return;
    const base = this.pos(this.neck[0]!, new Vector3());
    const from = this.rifleCheek(side).sub(base), to = contact.clone().sub(base);
    if (from.lengthSq() < 1e-8 || to.lengthSq() < 1e-8) return;
    const turn = new Quaternion().setFromUnitVectors(from.normalize(), to.normalize());
    const angle = 2 * Math.acos(Math.min(1, Math.abs(turn.w)));
    const k = angle > maxAngle ? maxAngle / angle : 1;
    const lower = this.neck.slice(0, -1);
    const part = new Quaternion().slerp(turn, k * weight / lower.length);
    for (const i of lower) this.setWorld(i, part.clone().multiply(this.bones[i]!.getWorldQuaternion(tmpQ[3]!)));
    this.group.updateMatrixWorld(true);
    for (const i of this.order) this.bones[i]!.getWorldQuaternion(this.worldQ[i]!);
  }

  /** Pose of every bone (relative to the group, unscaled) at one time of a clip. */
  referencePose(name: string, time = 0): Matrix4[] {
    const clip = this.assets.clips.get(name), out: Matrix4[] = [];
    const f = clip ? this.clipFrame(clip, time) : null, q = new Quaternion();
    for (const i of this.order) {
      const b = this.assets.bones[i]!;
      if (!(clip && f && this.sampleInto(q, clip, i, f))) q.copy(b.quaternion);
      const local = new Matrix4().compose(b.position, q, b.scale);
      out[i] = b.parent >= 0 ? out[b.parent]!.clone().multiply(local) : local;
    }
    return out;
  }

  private readonly fits = new Map<string, RifleFit>();

  /**
   * Gun-in-hand and support-hand-on-gun transforms, calibrated once per weapon from the recorded
   * rifle aiming pose: the grip sits in the firing palm and the bore runs from the firing palm
   * towards the support palm. Every rifle recording then carries the gun the way it was held.
   * `scale` is the gun's world scale; vectors are in the gun's own (unscaled) frame.
   */
  rifleFit(o: { key: string; barrel: Vector3; up: Vector3; grip: Vector3; scale: number; trigger: Side; twoHanded: boolean; gripRadius?: number; stock?: Vector3 | null }): RifleFit {
    const groupScale = this.group.getWorldScale(tmpV[0]!).x;
    const id = `${o.key}|${(o.scale / groupScale).toFixed(4)}|${o.trigger}|${o.twoHanded}|${!!o.stock}`;
    const cached = this.fits.get(id);
    if (cached) return cached;
    const A = this.assets, sup: Side = o.trigger === 'R' ? 'L' : 'R', pose = this.referencePose('rifle_aim_idle', 0);
    const handT = pose[this.side[o.trigger].hand]!, handS = pose[this.side[sup].hand]!;
    const qT = new Quaternion().setFromRotationMatrix(new Matrix4().extractRotation(handT));
    const palmT = A.hands[o.trigger].palm.clone().applyMatrix4(handT), palmS = A.hands[sup].palm.clone().applyMatrix4(handS);
    const normalT = A.hands[o.trigger].normal.clone().applyQuaternion(qT).normalize();
    // Group space: the model facing +Z, unscaled; the gun's own scale relative to it.
    const s = o.scale / groupScale;
    const forward = o.twoHanded ? palmS.clone().sub(palmT).normalize() : new Vector3(0, 0, 1);
    const up = new Vector3(0, 1, 0).addScaledVector(forward, -forward.y).normalize();
    const b = o.barrel.clone().normalize(), u = o.up.clone().addScaledVector(b, -o.up.dot(b)).normalize();
    const rotation = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(forward, up, new Vector3().crossVectors(forward, up))
      .multiply(new Matrix4().makeBasis(b, u, new Vector3().crossVectors(b, u)).transpose()));
    const center = palmT.clone().addScaledVector(normalT, (o.gripRadius ?? .017) / groupScale * .9);
    if (o.stock) {
      // Shouldered: the stock comb swings about the grip onto the recorded firing cheek.
      const head = this.neck[this.neck.length - 1]!;
      const cheek = this.cheekLocal(o.trigger).applyMatrix4(pose[head]!);
      const along = o.stock.clone().sub(o.grip).multiplyScalar(s).applyQuaternion(rotation);
      const want = cheek.sub(center);
      if (along.lengthSq() > 1e-8 && want.lengthSq() > 1e-8) rotation.premultiply(new Quaternion().setFromUnitVectors(along.normalize(), want.normalize()));
    }
    const position = center.sub(o.grip.clone().multiplyScalar(s).applyQuaternion(rotation));
    const gun = new Matrix4().compose(position, rotation, new Vector3(s, s, s));
    const fit = { inHand: handT.clone().invert().multiply(gun), support: o.twoHanded ? gun.clone().invert().multiply(handS) : null };
    this.fits.set(id, fit);
    return fit;
  }

  /** The support hand's wrist transform for a gun at `gun` (world), its palm seated on the
   * handguard point `support` (gun frame) a handguard radius below the centre line. */
  supportTarget(s: Side, gun: Matrix4, fit: RifleFit, support: Vector3, radius: number): Matrix4 | null {
    if (!fit.support) return null;
    const target = gun.clone().multiply(fit.support);
    const rot = new Quaternion().setFromRotationMatrix(new Matrix4().extractRotation(target));
    const palm = this.assets.hands[s].palm.clone().applyMatrix4(target);
    const normal = this.assets.hands[s].normal.clone().applyQuaternion(rot).normalize();
    const shift = support.clone().applyMatrix4(gun).addScaledVector(normal, -radius * .9).sub(palm);
    return target.premultiply(new Matrix4().makeTranslation(shift.x, shift.y, shift.z));
  }


  /**
   * Moves a hand to a world transform (wrist pose) with two-bone IK, keeping the recorded elbow
   * plane and the fingers as recorded; `weight` blends from the recorded arm.
   */
  placeHand(s: Side, target: Matrix4, weight = 1, maxBend = WRIST_BEND_MAX, swing = 0): void {
    if (weight < .001) return;
    const S = this.side[s], A = this.assets;
    const chain = [S.upperArm, S.upperArm1, S.forearm, S.forearm1, S.hand];
    const before = chain.map((i) => this.bones[i]!.quaternion.clone());
    const wrist = new Vector3(), rotation = new Quaternion();
    target.decompose(wrist, rotation, tmpV[1]!);
    // Where the elbow points: as the arm already bends, swung round the shoulder–wrist line by `swing` (Hand Studio).
    const pole = this.pos(S.forearm, new Vector3()).sub(this.pos(S.upperArm, tmpV[2]!).lerp(this.pos(S.hand, tmpV[3]!), .5));
    if (swing) pole.applyAxisAngle(wrist.clone().sub(this.pos(S.upperArm, tmpV[2]!)).normalize(), swing);
    // The palm contact stays put; a wrist bent past its comfortable range turns about it
    // towards the forearm, and the arm is solved again for the new wrist position.
    const palmLocal = A.hands[s].palm.clone().multiplyScalar(this.worldScale);
    const palm = palmLocal.clone().applyQuaternion(rotation).add(wrist);
    const relative = A.restQ[S.forearm]!.clone().invert().multiply(A.restQ[S.hand]!).invert();
    for (let pass = 0; pass < 3; pass++) {
      if (pass > 0) chain.forEach((i, k) => this.setLocal(i, before[k]!));
      this.solveArm(s, wrist, pole, rotation, true, true);
      const line = this.pos(S.hand, new Vector3()).sub(this.pos(S.forearm, tmpV[4]!)).normalize();
      const axis = Y_AXIS.clone().applyQuaternion(rotation.clone().multiply(relative));
      const bend = line.angleTo(axis);
      if (bend <= maxBend || pass === 2) break;
      rotation.premultiply(new Quaternion().slerp(new Quaternion().setFromUnitVectors(axis, line), (bend - maxBend) / bend + .05)).normalize();
      wrist.copy(palm).sub(palmLocal.clone().applyQuaternion(rotation));
    }
    // An elbow that would end up inside the torso (a short gun held close, the support arm reaching
    // across) swings out to the side and down instead, the hand staying where it is.
    if (!this.armsOnly) {
      const low = this.pos(this.spine[0]!, new Vector3()), high = this.pos(this.neck[0]!, new Vector3()), axisV = high.clone().sub(low);
      const elbow = this.pos(S.forearm, new Vector3()), t = Math.max(0, Math.min(1, elbow.clone().sub(low).dot(axisV) / axisV.lengthSq()));
      const centre = low.clone().addScaledVector(axisV, t), away = elbow.clone().sub(centre).setY(0);
      const span = this.pos(this.side.L.upperArm, new Vector3()).distanceTo(this.pos(this.side.R.upperArm, tmpV[5]!));
      if (away.length() < span * .5) {
        const outward = this.pos(s === 'L' ? this.side.L.upperArm : this.side.R.upperArm, new Vector3()).sub(this.pos(s === 'L' ? this.side.R.upperArm : this.side.L.upperArm, tmpV[5]!)).setY(0).normalize();
        const pole2 = outward.multiplyScalar(1).add(new Vector3(0, -.7, 0)).normalize();
        chain.forEach((i, k) => this.setLocal(i, before[k]!));
        this.solveArm(s, wrist, pole2, rotation, true, true);
      }
    }
    if (weight >= .999) { this.group.updateMatrixWorld(true); for (const i of this.order) this.bones[i]!.getWorldQuaternion(this.worldQ[i]!); return; }
    chain.forEach((i, k) => this.bones[i]!.quaternion.slerpQuaternions(before[k]!, this.bones[i]!.quaternion.clone(), weight));
    this.group.updateMatrixWorld(true);
    for (const i of this.order) this.bones[i]!.getWorldQuaternion(this.worldQ[i]!);
  }

  /** Puts the whole body in the bind pose (first-person arms start from it every frame). */
  restPose(): void {
    this.begin();
    for (const i of this.order) if (this.assets.bones[i]!.parent >= 0) this.setRest(i);
  }

}

/** World rotation of a hand whose palm faces `grasp.approach` with the index towards +axis. */
function graspRotation(frame: HandFrame, grasp: Grasp, out: Quaternion): Quaternion {
  const n = grasp.approach.clone().normalize();
  const k = grasp.axis.clone().negate().addScaledVector(n, grasp.axis.dot(n)).normalize();
  const t = new Vector3().crossVectors(n, k);
  const nl = frame.normal.clone().normalize();
  const kl = frame.across.clone().addScaledVector(nl, -frame.across.dot(nl)).normalize();
  const tl = new Vector3().crossVectors(nl, kl);
  const world = new Matrix4().makeBasis(n, k, t);
  const local = new Matrix4().makeBasis(nl, kl, tl).transpose();
  return out.setFromRotationMatrix(world.multiply(local));
}

/** Body measurements armour is fitted to (survivor model space: metres, facing +Z, +Y up). */
export interface ArmorAnchors {
  head: { min: Vector3; max: Vector3; centre: Vector3 };
  /** Height of the eyes and how far forward the face reaches. */
  eyes: number; face: number;
  /** The torso between the waist and the neck (arms left out). */
  chest: { min: Vector3; max: Vector3; centre: Vector3 };
  neck: number;
}

const anchorCache = new WeakMap<HumanAssets, ArmorAnchors>();

/** Measures the head and torso of the bare body once (by the bones the skin follows most). */
export function armorAnchors(assets: HumanAssets): ArmorAnchors {
  const cached = anchorCache.get(assets);
  if (cached) return cached;
  const body = assets.parts.get('body')!.geometry, pos = body.getAttribute('position');
  const si = body.getAttribute('skinIndex'), sw = body.getAttribute('skinWeight');
  const head = assets.index.get('spine_006')!, inHead = new Set<number>([head]);
  for (let i = 0; i < assets.bones.length; i++) for (const j of [...inHead]) if (assets.bones[i]!.parent === j) inHead.add(i);
  for (let pass = 0; pass < 4; pass++) for (let i = 0; i < assets.bones.length; i++) if (inHead.has(assets.bones[i]!.parent)) inHead.add(i);
  const torso = new Set(['spine_001', 'spine_002', 'spine_003'].map((n) => assets.index.get(n)!));
  const hMin = new Vector3(Infinity, Infinity, Infinity), hMax = hMin.clone().negate(), cMin = hMin.clone(), cMax = hMax.clone(), v = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    let best = 0, bone = -1;
    for (let k = 0; k < 4; k++) { const w = comp(sw, i, k); if (w > best) { best = w; bone = comp(si, i, k); } }
    v.fromBufferAttribute(pos, i);
    if (inHead.has(bone)) { hMin.min(v); hMax.max(v); }
    else if (torso.has(bone)) { cMin.min(v); cMax.max(v); }
  }
  const eyes = assets.parts.get('eyes')?.geometry;
  eyes?.computeBoundingBox();
  const out: ArmorAnchors = {
    head: { min: hMin, max: hMax, centre: hMin.clone().add(hMax).multiplyScalar(.5) },
    eyes: eyes?.boundingBox ? (eyes.boundingBox.min.y + eyes.boundingBox.max.y) / 2 : hMin.y + (hMax.y - hMin.y) * .55,
    face: hMax.z,
    chest: { min: cMin, max: cMax, centre: cMin.clone().add(cMax).multiplyScalar(.5) },
    neck: assets.restP[assets.index.get('spine_004')!]!.y,
  };
  anchorCache.set(assets, out);
  return out;
}

/** Fetches a binary file with download progress. */
export async function fetchBinary(fetcher: (url: string) => Promise<Response>, url: string, onProgress?: (p: number) => void): Promise<ArrayBuffer> {
  const res = await fetcher(url);
  if (!res.ok || !res.body) throw new Error(`survivor model unavailable (${res.status})`);
  const total = Number(res.headers.get('content-length')) || 0;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (total) onProgress?.(Math.min(1, received / total));
  }
  onProgress?.(1);
  const all = new Uint8Array(received);
  let off = 0;
  for (const c of chunks) { all.set(c, off); off += c.length; }
  return all.buffer;
}

