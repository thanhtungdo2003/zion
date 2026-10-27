import { BufferAttribute, Bone, Matrix4, Quaternion, Skeleton, Vector3, type SkinnedMesh, type AnimationClip, type BufferGeometry, type Object3D } from 'three';
import type { HumanAssets, HumanBody } from './human-rig';

/**
 * The third character skeleton (Studio "Người · xương Mixamo"): the survivor's skin re-bound to a
 * Mixamo skeleton (Hips … ToeBase, three joints a finger) with its joints where the survivor's are.
 * A Mixamo recording plays on it one to one: each bone turns in the world exactly as the recorded
 * bone turns from its own rest pose (the survivor's A-pose matched to Mixamo's T-pose bone by
 * bone), nothing layered on top. Walking forward is the recorded walk (models/characters/mocap/
 * walking.fbx); everything else copies the regular survivor skeleton, so every other action, the
 * held weapon's hands and the ragdoll keep working. The other two skeletons are untouched.
 */
export const MIXAMO_WALK_URL = '/models/characters/mocap/walking.fbx';

type Side = 'L' | 'R';
interface JointDef { name: string; parent: number; from: string }

/** Mixamo joints and the survivor bone each one stands on. */
function mixamoJoints(): JointDef[] {
  const out: JointDef[] = [];
  const add = (name: string, parent: string | null, from: string) => out.push({ name, parent: parent === null ? -1 : out.findIndex((j) => j.name === parent), from });
  add('Hips', null, 'spine'); add('Spine', 'Hips', 'spine_001'); add('Spine1', 'Spine', 'spine_002'); add('Spine2', 'Spine1', 'spine_003');
  add('Neck', 'Spine2', 'spine_004'); add('Head', 'Neck', 'spine_006');
  for (const s of ['L', 'R'] as Side[]) {
    const S = s === 'L' ? 'Left' : 'Right';
    add(`${S}Shoulder`, 'Spine2', `shoulder_${s}`); add(`${S}Arm`, `${S}Shoulder`, `upper_arm_${s}`);
    add(`${S}ForeArm`, `${S}Arm`, `forearm_${s}`); add(`${S}Hand`, `${S}ForeArm`, `hand_${s}`);
    for (const [m, f] of [['Thumb', 'thumb'], ['Index', 'f_index'], ['Middle', 'f_middle'], ['Ring', 'f_ring'], ['Pinky', 'f_pinky']]) {
      for (let k = 1; k <= 3; k++) add(`${S}Hand${m}${k}`, k === 1 ? `${S}Hand` : `${S}Hand${m}${k - 1}`, `${f}_0${k}_${s}`);
    }
    add(`${S}UpLeg`, 'Hips', `thigh_${s}`); add(`${S}Leg`, `${S}UpLeg`, `shin_${s}`);
    add(`${S}Foot`, `${S}Leg`, `foot_${s}`); add(`${S}ToeBase`, `${S}Foot`, `toe_${s}`);
  }
  return out;
}

/** The child a bone points at (its direction in the rest poses). */
function aimChild(name: string): string | null {
  const finger = /^(.*Hand(?:Thumb|Index|Middle|Ring|Pinky))(\d)$/.exec(name);
  if (finger) return Number(finger[2]) < 3 ? `${finger[1]}${Number(finger[2]) + 1}` : null;
  const side = /^(Left|Right)(.*)$/.exec(name);
  const next: Record<string, string> = { Shoulder: 'Arm', Arm: 'ForeArm', ForeArm: 'Hand', Hand: 'HandMiddle1', UpLeg: 'Leg', Leg: 'Foot', Foot: 'ToeBase' };
  if (side) return next[side[2]!] ? side[1] + next[side[2]!]! : null;
  return ({ Hips: 'Spine', Spine: 'Spine1', Spine1: 'Spine2', Spine2: 'Neck', Neck: 'Head' } as Record<string, string>)[name] ?? null;
}

const TRUNK = new Set(['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head']);
const ARM = /^(Left|Right)(Shoulder|Arm|ForeArm|Hand)/;

/** One recorded loop on the Mixamo skeleton: world turns per frame, the hips' sway and bob. */
interface MixamoLoop { duration: number; frames: Quaternion[][]; hips: Vector3[]; /** Asset units one loop covers (0: recorded on the spot). */ stride: number }

export interface MixamoMotion {
  joints: JointDef[];
  /** Joint positions in the survivor asset's space (all rest rotations are the identity). */
  rest: Vector3[];
  /** Survivor bone index → Mixamo joint its skin follows. */
  skinMap: Int16Array;
  /** Survivor bone each joint copies outside the recording. */
  source: number[];
  walk: MixamoLoop;
}

const stripPrefix = (n: string) => n.replace(/^mixamorig\d*:?/, '');

/** Plays `clip` on the Mixamo hierarchy `src` (FBX) and re-expresses it on the survivor's joints. */
export function buildMixamoMotion(assets: HumanAssets, src: Object3D, clip: AnimationClip, mixer: { setTime(t: number): void }): MixamoMotion {
  const joints = mixamoJoints();
  const at = (n: string) => { const i = assets.index.get(n); if (i === undefined) throw new Error(`survivor rig lacks ${n}`); return i; };
  const source = joints.map((j) => at(j.from));
  const rest = source.map((i) => assets.restP[i]!.clone());
  // Every other survivor bone follows its nearest ancestor that a joint stands on.
  const owner = new Map(source.map((s, k) => [s, k]));
  const skinMap = new Int16Array(assets.bones.length);
  assets.bones.forEach((_, i) => {
    let b = i;
    while (b >= 0 && !owner.has(b)) b = assets.bones[b]!.parent;
    skinMap[i] = b >= 0 ? owner.get(b)! : 0;
  });

  const bones = new Map<string, Object3D>();
  src.traverse((o) => { if ((o as Bone).isBone) bones.set(stripPrefix(o.name), o); });
  const need = (n: string) => { const b = bones.get(n); if (!b) throw new Error(`recording lacks ${n}`); return b; };
  const worldQ = (o: Object3D) => o.getWorldQuaternion(new Quaternion());
  const worldP = (o: Object3D) => o.getWorldPosition(new Vector3());

  // Rest frames: bone directions (and the trunk's left-right line) in both rest poses.
  src.updateMatrixWorld(true);
  const srcRest = joints.map((j) => worldQ(need(j.name)));
  const srcRestP = joints.map((j) => worldP(need(j.name)));
  const byName = new Map(joints.map((j, k) => [j.name, k]));
  const basis = (dir: Vector3, side: Vector3) => {
    const y = dir.clone().normalize(), z = new Vector3().crossVectors(side, y).normalize(), x = new Vector3().crossVectors(y, z);
    return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, z));
  };
  const align: Quaternion[] = [];
  joints.forEach((j, k) => {
    const c = aimChild(j.name), ck = c ? byName.get(c) : undefined;
    if (ck === undefined) { align[k] = j.parent >= 0 ? align[j.parent]!.clone() : new Quaternion(); return; }
    const tDir = rest[ck]!.clone().sub(rest[k]!), sDir = srcRestP[ck]!.clone().sub(srcRestP[k]!);
    if (TRUNK.has(j.name)) {
      // Upright bones: their heading comes from the hips' left-right line too, not the shortest arc.
      const l = byName.get('LeftUpLeg')!, r = byName.get('RightUpLeg')!;
      const tSide = rest[l]!.clone().sub(rest[r]!), sSide = srcRestP[l]!.clone().sub(srcRestP[r]!);
      align[k] = basis(sDir, sSide).multiply(basis(tDir, tSide).invert());
    } else align[k] = new Quaternion().setFromUnitVectors(tDir.normalize(), sDir.normalize());
  });

  // Bake: 30 frames a second over one loop (the last frame wraps to the first).
  const count = Math.max(2, Math.round(clip.duration * 30));
  const frames: Quaternion[][] = [], hipsRaw: Vector3[] = [];
  const restInv = srcRest.map((q) => q.clone().invert());
  for (let f = 0; f < count; f++) {
    mixer.setTime(clip.duration * f / count);
    src.updateMatrixWorld(true);
    frames.push(joints.map((j, k) => worldQ(need(j.name)).multiply(restInv[k]!).multiply(align[k]!)));
    hipsRaw.push(worldP(need('Hips')));
  }
  // Just short of the end: a looping action wraps the end back to the start.
  mixer.setTime(clip.duration * (1 - 1e-4));
  src.updateMatrixWorld(true);
  const end = worldP(need('Hips'));
  // On the spot: the travel over the loop is taken out (and kept as the stride); sway and bob stay.
  const ratio = rest[0]!.y / Math.max(1e-6, srcRestP[0]!.y);
  const travel = end.clone().sub(hipsRaw[0]!); travel.y = 0;
  const hips = hipsRaw.map((p, f) => {
    const o = p.clone().sub(hipsRaw[0]!).addScaledVector(travel, -f / count);
    return new Vector3(o.x * ratio, (p.y - srcRestP[0]!.y) * ratio, o.z * ratio);
  });
  // Keep the mean height where the recording carried it, and the sway centred.
  const mean = hips.reduce((s, p) => s.add(p), new Vector3()).multiplyScalar(1 / hips.length);
  for (const p of hips) { p.x -= mean.x; p.z -= mean.z; }
  return { joints, rest, skinMap, source, walk: { duration: clip.duration, frames, hips, stride: travel.length() * ratio } };
}

/** Loads the walk recording and builds the Mixamo motion for this survivor. */
export async function loadMixamoMotion(assets: HumanAssets, fetchBuffer: (url: string) => Promise<ArrayBuffer>): Promise<MixamoMotion> {
  const [{ FBXLoader }, { AnimationMixer }, buffer] = await Promise.all([
    import('three/examples/jsm/loaders/FBXLoader.js'), import('three'), fetchBuffer(MIXAMO_WALK_URL),
  ]);
  const src = new FBXLoader().parse(buffer, '');
  const clip = src.animations[0];
  if (!clip) throw new Error('walking.fbx has no animation');
  const mixer = new AnimationMixer(src);
  mixer.clipAction(clip).play();
  return buildMixamoMotion(assets, src, clip, mixer);
}

const remapped = new WeakMap<BufferGeometry, BufferGeometry>();
const onMixamo = new WeakSet<BufferGeometry>();
function remapSkin(geometry: BufferGeometry, map: Int16Array): BufferGeometry {
  if (onMixamo.has(geometry)) return geometry;
  let out = remapped.get(geometry);
  if (out) return out;
  const index = geometry.getAttribute('skinIndex');
  out = geometry.clone();
  if (index) {
    const next = new Uint16Array(index.count * 4);
    for (let i = 0; i < index.count; i++) for (let c = 0; c < 4; c++) next[i * 4 + c] = map[index.getComponent(i, c)] ?? 0;
    out.setAttribute('skinIndex', new BufferAttribute(next, 4));
  }
  remapped.set(geometry, out);
  onMixamo.add(out);
  return out;
}

export interface MixamoFrame {
  dt: number;
  /** Ground speed (m/s) and whether the walk recording should play (walking forward, nothing else). */
  speed: number;
  walking: boolean;
  /** Arms keep the regular pose (a weapon or item in hand). */
  armsBusy: boolean;
}

/** The Mixamo skeleton on one survivor body: the skin follows it instead of the survivor's bones. */
export class MixamoSkin {
  readonly bones: Bone[];
  private readonly skeleton: Skeleton;
  private readonly bound = new WeakSet<SkinnedMesh>();
  private phase = 0;
  private weight = 0;
  private armWeight = 0;
  private readonly world: Quaternion[];
  private readonly restInvOld: Quaternion[];
  private readonly scratch = { m: new Matrix4(), inv: new Matrix4(), p: new Vector3(), q: new Quaternion(), s: new Vector3(), a: new Quaternion(), b: new Quaternion() };

  constructor(private readonly body: HumanBody, private readonly motion: MixamoMotion) {
    const { joints, rest } = motion;
    this.bones = joints.map((j) => { const b = new Bone(); b.name = `mixamo_${j.name}`; return b; });
    joints.forEach((j, k) => {
      const b = this.bones[k]!;
      if (j.parent >= 0) { this.bones[j.parent]!.add(b); b.position.copy(rest[k]!).sub(rest[j.parent]!); } else { body.group.add(b); b.position.copy(rest[k]!); }
    });
    this.skeleton = new Skeleton(this.bones, rest.map((p) => new Matrix4().makeTranslation(-p.x, -p.y, -p.z)));
    this.world = joints.map(() => new Quaternion());
    this.restInvOld = motion.source.map((i) => body.assets.restQ[i]!.clone().invert());
    this.rebind();
  }

  /**
   * Moves every skin on the survivor's skeleton (body, clothes, armour put on later) to this one,
   * and re-maps a skin whose geometry was swapped since (hair styles, the body under a top).
   */
  private rebind(): void {
    this.body.group.traverse((o) => {
      const mesh = o as SkinnedMesh;
      if (!mesh.isSkinnedMesh) return;
      if (mesh.skeleton === this.body.skeleton) {
        mesh.geometry = remapSkin(mesh.geometry, this.motion.skinMap);
        mesh.bind(this.skeleton, mesh.bindMatrix);
        this.bound.add(mesh);
      } else if (this.bound.has(mesh) && !onMixamo.has(mesh.geometry)) mesh.geometry = remapSkin(mesh.geometry, this.motion.skinMap);
    });
  }

  update(f: MixamoFrame): void {
    this.rebind();
    const { joints, rest, source, walk } = this.motion, s = this.scratch, group = this.body.group;
    const ease = 1 - Math.exp(-Math.max(0, f.dt) * 8);
    this.weight += ((f.walking ? 1 : 0) - this.weight) * ease;
    this.armWeight += ((f.walking && !f.armsBusy ? 1 : 0) - this.armWeight) * ease;
    // Steps follow the ground speed: one loop per stride.
    group.updateMatrixWorld(true);
    const scale = group.getWorldScale(s.s).y;
    const loops = walk.stride > 1e-4 ? f.speed * f.dt / (walk.stride * scale) : f.dt / walk.duration;
    if (this.weight > .001) this.phase = (this.phase + loops) % 1; else this.phase = 0;
    const n = walk.frames.length, x = this.phase * n, i0 = Math.floor(x) % n, i1 = (i0 + 1) % n, u = x - Math.floor(x);
    s.inv.copy(group.matrixWorld).invert();
    let hipsCopy: Vector3 | null = null;
    joints.forEach((j, k) => {
      // The regular survivor pose of the bone this joint stands on, in the body's space.
      s.m.multiplyMatrices(s.inv, this.body.bones[source[k]!]!.matrixWorld).decompose(s.p, s.q, s.s);
      if (k === 0) hipsCopy = s.p.clone();
      const copy = s.q.multiply(this.restInvOld[k]!);
      const w = ARM.test(j.name) ? this.armWeight : this.weight;
      if (w <= .001) { this.world[k]!.copy(copy); return; }
      s.a.copy(walk.frames[i0]![k]!).slerp(walk.frames[i1]![k]!, u);
      this.world[k]!.copy(copy).slerp(s.a, w);
    });
    joints.forEach((j, k) => {
      const b = this.bones[k]!;
      if (j.parent < 0) b.quaternion.copy(this.world[k]!);
      else b.quaternion.copy(s.b.copy(this.world[j.parent]!).invert().multiply(this.world[k]!));
    });
    const hips = rest[0]!.clone().add(s.p.copy(walk.hips[i0]!).lerp(walk.hips[i1]!, u));
    this.bones[0]!.position.copy(hipsCopy ?? rest[0]!).lerp(hips, this.weight);
    group.updateMatrixWorld(true);
  }

  dispose(): void {
    this.bones[0]!.removeFromParent();
  }
}
