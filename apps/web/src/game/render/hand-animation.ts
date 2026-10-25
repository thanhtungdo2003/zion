import { Euler, Quaternion, Vector3 } from 'three';
import { handKeysAt, type HandKey, type HandTrack } from '@zion/shared';

/**
 * Sampling a Hand Studio track at `t` (0…1): positions blend linearly, turns along the shortest
 * arc, sizes linearly and hand poses gradually (the second pose's share `u`), each segment shaped
 * by the ease of the key it arrives at.
 */

const DEG = Math.PI / 180;

export function keyQuat(rot: readonly [number, number, number], out = new Quaternion()): Quaternion {
  return out.setFromEuler(new Euler(rot[0] * DEG, rot[1] * DEG, rot[2] * DEG, 'XYZ'));
}

/** A value both keys have blends; a value only one has holds. */
function pick<T>(a: HandKey, b: HandKey, get: (k: HandKey) => T | undefined): [T | undefined, T | undefined] {
  const va = get(a), vb = get(b);
  return [va ?? vb, vb ?? va];
}

export function samplePos(track: HandTrack, t: number): Vector3 | null {
  const s = handKeysAt(track.keys, t);
  if (!s) return null;
  const [a, b] = pick(s.a, s.b, (k) => k.pos);
  if (!a || !b) return null;
  return new Vector3(...a).lerp(new Vector3(...b), s.u);
}

export function sampleRot(track: HandTrack, t: number): Quaternion | null {
  const s = handKeysAt(track.keys, t);
  if (!s) return null;
  const [a, b] = pick(s.a, s.b, (k) => k.rot);
  if (!a || !b) return null;
  return keyQuat(a).slerp(keyQuat(b, new Quaternion()), s.u);
}

export function sampleScale(track: HandTrack, t: number): number | null {
  const s = handKeysAt(track.keys, t);
  if (!s) return null;
  const [a, b] = pick(s.a, s.b, (k) => k.scale);
  return a === undefined || b === undefined ? null : a + (b - a) * s.u;
}

export function sampleClip(track: HandTrack, t: number): number | null {
  const s = handKeysAt(track.keys, t);
  if (!s) return null;
  const [a, b] = pick(s.a, s.b, (k) => k.clip);
  return a === undefined || b === undefined ? null : a + (b - a) * s.u;
}

/** The hand pose at `t`: the arriving pose's share `u` (fingers turning from one to the other). */
export function samplePose(track: HandTrack, t: number): { a: string; b: string; u: number } | null {
  const s = handKeysAt(track.keys, t);
  if (!s) return null;
  const [a, b] = pick(s.a, s.b, (k) => k.pose);
  if (!a || !b) return null;
  return { a, b, u: s.u };
}

/**
 * Where a hand is at `t` in the gun's frame, each key placed on its own gun part (followed as the
 * part moves) and the two then blended: `place(key)` gives a key's point (null: no position).
 */
export function sampleHandPoint(track: HandTrack, t: number, place: (k: HandKey) => Vector3 | null): Vector3 | null {
  const s = handKeysAt(track.keys, t);
  if (!s) return null;
  const pa = place(s.a), pb = place(s.b);
  if (!pa && !pb) return null;
  return (pa ?? pb)!.clone().lerp(pb ?? pa!, s.u);
}
