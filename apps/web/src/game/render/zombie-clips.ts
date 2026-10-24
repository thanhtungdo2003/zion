import { Quaternion, Vector3, type Object3D } from 'three';
import { cachedFetch } from '@/lib/preload';

/**
 * Motion-capture clips of ordinary zombies (walk, run, scream: scripts/prepare-zombie-anims.mjs),
 * retargeted onto each zombie skin's biped skeleton when it is built. A clip stores, per bone role,
 * the source bone's world turn from its rest; here each role's rest is first lined up with the
 * source's (by bone direction), then turned exactly as the source turns.
 */
export interface ZombieClip { loop: boolean; duration: number; frames: number; stride: number; hipsY: number[]; tracks: Record<string, number[]> }
interface ClipFile { version: number; clips: Record<string, ZombieClip>; restDir: Record<string, [number, number, number]> }

export const ZOMBIE_ANIMS_URL = '/models/mobs/zombie-anims.json';
let file: ClipFile | null = null;
let loading: Promise<ClipFile | null> | null = null;
export function loadZombieClips(): Promise<ClipFile | null> {
  loading ??= cachedFetch(ZOMBIE_ANIMS_URL).then((r) => (r.ok ? r.json() as Promise<ClipFile> : null)).then((f) => (file = f)).catch(() => null);
  return loading;
}
export function zombieClipsReady(): boolean { return !!file; }

/** Role → biped bone name pattern (parents before children). */
const ROLES: Array<[string, RegExp]> = [
  ['pelvis', /^bip[ _]Pelvis/i], ['spine', /^bip[ _]Spine(_|$)/i], ['spine1', /^bip[ _]Spine1/i], ['neck', /^bip[ _]Neck/i], ['head', /^bip[ _]Head(_|$)/i],
  ['clavicle_l', /^bip[ _]L[ _]Clavicle/i], ['upperarm_l', /^bip[ _]L[ _]UpperArm/i], ['forearm_l', /^bip[ _]L[ _]Forearm/i], ['hand_l', /^bip[ _]L[ _]Hand/i],
  ['clavicle_r', /^bip[ _]R[ _]Clavicle/i], ['upperarm_r', /^bip[ _]R[ _]UpperArm/i], ['forearm_r', /^bip[ _]R[ _]Forearm/i], ['hand_r', /^bip[ _]R[ _]Hand/i],
  ['thigh_l', /^bip[ _]L[ _]Thigh/i], ['calf_l', /^bip[ _]L[ _]Calf/i], ['foot_l', /^bip[ _]L[ _]Foot/i], ['toe_l', /^bip[ _]L[ _]Toe0(_|$)/i],
  ['thigh_r', /^bip[ _]R[ _]Thigh/i], ['calf_r', /^bip[ _]R[ _]Calf/i], ['foot_r', /^bip[ _]R[ _]Foot/i], ['toe_r', /^bip[ _]R[ _]Toe0(_|$)/i],
];
/** The bone each role's direction is measured to (the next role, or the bone's first child). */
const NEXT: Record<string, string> = { pelvis: 'spine', spine: 'spine1', spine1: 'neck', neck: 'head', clavicle_l: 'upperarm_l', upperarm_l: 'forearm_l', forearm_l: 'hand_l', clavicle_r: 'upperarm_r', upperarm_r: 'forearm_r', forearm_r: 'hand_r', thigh_l: 'calf_l', calf_l: 'foot_l', foot_l: 'toe_l', thigh_r: 'calf_r', calf_r: 'foot_r', foot_r: 'toe_r' };

interface Joint { role: string; node: Object3D; aligned: Quaternion; restLocal: Quaternion }

const qa = new Quaternion(), qb = new Quaternion(), qc = new Quaternion(), actorInv = new Quaternion(), v = new Vector3();

export class ZombieClips {
  private readonly joints: Joint[] = [];
  private readonly pelvis: Object3D | null;
  private readonly pelvisRest = new Vector3();
  private readonly hipHeight: number;
  private readonly clips: Record<string, ZombieClip>;

  /** `model`: the zombie's skeleton; `actor`: its root (the character's frame). Null if the skin has no biped. */
  static create(model: Object3D, actor: Object3D): ZombieClips | null {
    if (!file) return null;
    const c = new ZombieClips(model, actor, file);
    return c.joints.length >= 12 ? c : null;
  }

  private constructor(model: Object3D, private readonly actor: Object3D, data: ClipFile) {
    this.clips = data.clips;
    actor.updateWorldMatrix(true, true);
    const inv = actor.getWorldQuaternion(new Quaternion()).invert();
    const found = new Map<string, Object3D>();
    model.traverse((o) => { for (const [role, re] of ROLES) if (!found.has(role) && re.test(o.name)) found.set(role, o); });
    const at = (o: Object3D) => actor.worldToLocal(o.getWorldPosition(new Vector3()));
    for (const [role] of ROLES) {
      const node = found.get(role), dir = data.restDir[role];
      if (!node || !dir) continue;
      const restWorld = inv.clone().multiply(node.getWorldQuaternion(new Quaternion()));
      const next = found.get(NEXT[role] ?? '') ?? node.children.find((c) => c.type === 'Bone') ?? null;
      let aligned = restWorld;
      if (next) {
        const tDir = at(next).sub(at(node)).normalize();
        if (tDir.lengthSq() > .5) aligned = new Quaternion().setFromUnitVectors(tDir, new Vector3(...dir).normalize()).multiply(restWorld);
      }
      this.joints.push({ role, node, aligned, restLocal: node.quaternion.clone() });
    }
    this.pelvis = found.get('pelvis') ?? null;
    if (this.pelvis) this.pelvisRest.copy(this.pelvis.position);
    const feet = ['foot_l', 'foot_r'].map((r) => found.get(r)).filter((o): o is Object3D => !!o);
    const hips = this.pelvis ? at(this.pelvis).y : 1;
    this.hipHeight = Math.max(.2, hips - (feet.length ? Math.min(...feet.map((f) => at(f).y)) : 0));
  }

  /** Ground one loop of a clip covers (actor metres), for distance-driven playback. */
  stride(name: string): number { return (this.clips[name]?.stride ?? 1.5) * this.hipHeight * this.actorScale(); }
  duration(name: string): number { return this.clips[name]?.duration ?? 1; }
  private actorScale(): number { return Math.max(.01, this.actor.getWorldScale(v).x); }

  /**
   * Poses the skeleton at `time` (seconds) of a clip, blended over the current pose by `weight`
   * (0 keeps it, 1 is the clip). Parents first, so each bone's local turn follows its posed parent.
   */
  pose(name: string, time: number, weight: number): void {
    const clip = this.clips[name];
    if (!clip || weight <= 0) return;
    const span = clip.duration, t = clip.loop ? ((time % span) + span) % span : Math.min(span, Math.max(0, time));
    const f = t / span * (clip.frames - 1), i0 = Math.floor(f), i1 = Math.min(clip.frames - 1, i0 + 1), k = f - i0;
    this.actor.updateWorldMatrix(true, false);
    actorInv.copy(this.actor.getWorldQuaternion(qa)).invert();
    for (const j of this.joints) {
      const tr = clip.tracks[j.role];
      if (!tr?.length) continue;
      qb.fromArray(tr, i0 * 4).slerp(qc.fromArray(tr, i1 * 4), k);
      // Target world (actor frame) = source turn · lined-up rest; into the parent's frame.
      const target = qb.multiply(j.aligned);
      const parent = j.node.parent!;
      parent.updateWorldMatrix(true, false);
      const parentWorld = actorInv.clone().multiply(parent.getWorldQuaternion(qa));
      const local = parentWorld.invert().multiply(target).normalize();
      j.node.quaternion.slerp(local, weight);
      j.node.updateMatrixWorld();
    }
    // The hips rise and fall with the steps.
    if (this.pelvis?.parent) {
      const y = (clip.hipsY[i0]! * (1 - k) + clip.hipsY[i1]! * k) * this.hipHeight;
      const parent = this.pelvis.parent, base = parent.localToWorld(this.pelvisRest.clone());
      const lifted = parent.worldToLocal(base.add(v.set(0, y * this.actorScale(), 0)));
      this.pelvis.position.lerp(lifted, weight);
    }
  }
}
