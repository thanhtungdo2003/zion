import { Quaternion, Vector3 } from 'three';
import type { Mocap } from './human-rig';

export type Gait = 'idle' | 'walk' | 'jog' | 'sprint';
export type MoveDirection = 'forward' | 'backward' | 'left' | 'right';

/**
 * Starting and stopping: a body only starts stepping above MOVE_START and only stops below
 * MOVE_STOP, so the small wobble of a networked speed never flips the legs between standing
 * and stepping.
 */
export const MOVE_START = .4, MOVE_STOP = .15;
export const isStepping = (speed: number, wasStepping: boolean): boolean => speed > (wasStepping ? MOVE_STOP : MOVE_START);

/** Thresholds match the controller's normal walk (3.4 m/s), with hysteresis at each boundary. */
export function locomotionGait(speed: number, sprinting: boolean, previous: Gait): Gait {
  if (!isStepping(speed, previous !== 'idle')) return 'idle';
  if (sprinting && speed > (previous === 'sprint' ? 4.35 : 4.8)) return 'sprint';
  if (speed > (previous === 'jog' ? 3.65 : 3.95)) return 'jog';
  return 'walk';
}

/**
 * Which way the legs step relative to the body: the dominant component of travel, but a new
 * direction must beat the current one by a clear margin (a bot drifting at 45° does not flicker
 * between a forward and a sideways cycle).
 */
export function stepDirection(ahead: number, sideways: number, previous: MoveDirection | null): MoveDirection {
  const score: Record<MoveDirection, number> = { forward: ahead, backward: -ahead, right: sideways, left: -sideways };
  const strafe = Math.abs(sideways) > Math.abs(ahead) + .1;
  const best: MoveDirection = strafe ? sideways > 0 ? 'right' : 'left' : ahead < 0 ? 'backward' : 'forward';
  if (previous && previous !== best && score[previous] > .2 && score[best] < score[previous] + .35) return previous;
  return best;
}

export function locomotionClip(gait: Gait, direction: MoveDirection, gun: boolean): string | null {
  if (gait === 'idle') return null;
  if (gait === 'walk') return `walk_${direction}`;
  if (direction === 'left' || direction === 'right') return `run_${direction}`;
  if (direction === 'backward') return 'rifle_sprint_backward';
  return gait === 'sprint' ? gun ? 'rifle_sprint_forward' : 'fast_run' : gun ? 'rifle_run' : 'jog_forward';
}

/** Close recorded loop endpoints once at load, keeping the interior and source contact timing. */
export function closeMocapLoop(clip: Mocap): void {
  if (!clip.loop || clip.frames < 4) return;
  const last = clip.frames - 1, window = Math.max(2, Math.min(5, Math.floor(last * .12)));
  const a = new Quaternion(), b = new Quaternion(), seam = new Quaternion();
  for (const track of clip.bones.values()) {
    a.fromArray(track, 0); b.fromArray(track, last * 4);
    if (a.angleTo(b) < .0001) continue;
    seam.copy(a).slerp(b, .5);
    for (let i = 0; i <= window; i++) {
      const u = 1 - i / window, weight = u * u * (3 - 2 * u);
      a.fromArray(track, i * 4).slerp(seam, weight).normalize().toArray(track, i * 4);
      b.fromArray(track, (last - i) * 4).slerp(seam, weight).normalize().toArray(track, (last - i) * 4);
    }
  }
  if (clip.hipsY.length === clip.frames) {
    const seamY = (clip.hipsY[0]! + clip.hipsY[last]!) / 2;
    for (let i = 0; i <= window; i++) {
      const u = 1 - i / window, w = u * u * (3 - 2 * u);
      clip.hipsY[i]! += (seamY - clip.hipsY[i]!) * w;
      clip.hipsY[last - i]! += (seamY - clip.hipsY[last - i]!) * w;
    }
  }
}

/** Directional walks use the real walk, never slowed run clips. Strafe rotates the lower body
 * and counter-rotates the chest; backpedalling reverses the walk's planted steps. The file named
 * rifle_aim_walk.fbx duplicates Start Run in this repo, so it is deliberately not used.
 */
export function addLocomotionClips(clips: Map<string, Mocap>, bones: Array<{ parent: number; quaternion: Quaternion }>, index: Map<string, number>): void {
  const source = clips.get('melee_walk');
  if (!source || !index.has('spine') || !index.has('spine_001')) return;
  const upper = new Set<number>([index.get('spine_001')!]);
  const order: number[] = [];
  const visit = (i: number) => { if (order.includes(i)) return; const p = bones[i]!.parent; if (p >= 0) visit(p); order.push(i); };
  bones.forEach((_, i) => visit(i));
  for (const i of order) if (upper.has(bones[i]!.parent)) upper.add(i);
  // The jog's shorter, grounded strides differ from the fast sprint. Empty hands retain the
  // free arm swing of Fast Run rather than the rifle recording's imaginary weapon hold.
  const jog = clips.get('rifle_run'), sprint = clips.get('fast_run');
  if (jog && sprint) {
    const tracks = new Map(jog.bones);
    for (const i of upper) {
      const sourceTrack = sprint.bones.get(i);
      if (!sourceTrack) continue;
      const track = new Float32Array(jog.frames * 4);
      for (let f = 0; f < jog.frames; f++) {
        const frame = f / (jog.frames - 1) * (sprint.frames - 1), a = Math.floor(frame), b = Math.min(sprint.frames - 1, a + 1);
        new Quaternion().fromArray(sourceTrack, a * 4).slerp(new Quaternion().fromArray(sourceTrack, b * 4), frame - a).normalize().toArray(track, f * 4);
      }
      tracks.set(i, track);
    }
    clips.set('jog_forward', { ...jog, name: 'jog_forward', bones: tracks, hipsY: [...jog.hipsY] });
  }
  for (const direction of ['forward', 'backward', 'left', 'right'] as const) {
    const tracks = new Map<number, Float32Array>();
    const yaw = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), direction === 'left' ? Math.PI / 2 : direction === 'right' ? -Math.PI / 2 : 0);
    for (let frame = 0; frame < source.frames; frame++) {
      const f = direction === 'backward' ? source.frames - 1 - frame : frame;
      const world: Quaternion[] = [], target: Quaternion[] = [];
      for (const i of order) {
        const b = bones[i]!, track = source.bones.get(i);
        const local = track ? new Quaternion().fromArray(track, f * 4) : b.quaternion;
        world[i] = (b.parent >= 0 ? world[b.parent]! : new Quaternion()).clone().multiply(local);
        target[i] = world[i]!.clone();
        if (!upper.has(i)) target[i]!.premultiply(yaw);
        const q = (b.parent >= 0 ? target[b.parent]! : new Quaternion()).clone().invert().multiply(target[i]!);
        let out = tracks.get(i);
        if (!out) tracks.set(i, (out = new Float32Array(source.frames * 4)));
        q.toArray(out, frame * 4);
      }
    }
    clips.set(`walk_${direction}`, { ...source, name: `walk_${direction}`, bones: tracks,
      hipsY: direction === 'backward' ? [...source.hipsY].reverse() : [...source.hipsY] });
  }
}
