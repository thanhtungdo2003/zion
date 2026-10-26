import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { closeMocapLoop, locomotionClip, locomotionGait } from './locomotion';
import type { Mocap } from './human-rig';

describe('locomotion states and loop continuity', () => {
  it('keeps normal controller speed walking in every direction, and separates jog from sprint', () => {
    for (const gun of [false, true]) for (const direction of ['forward', 'backward', 'left', 'right'] as const) {
      const gait = locomotionGait(3.4, false, 'walk');
      expect(gait).toBe('walk');
      expect(locomotionClip(gait, direction, gun)).toBe(`walk_${direction}`);
    }
    expect(locomotionGait(4.4, false, 'walk')).toBe('jog');
    expect(locomotionGait(6.2, true, 'jog')).toBe('sprint');
    expect(locomotionGait(3.8, false, 'jog')).toBe('jog');
    expect(locomotionGait(3.8, false, 'walk')).toBe('walk');
    expect(locomotionGait(0, false, 'sprint')).toBe('idle');
    expect(locomotionClip('jog', 'forward', false)).toBe('jog_forward');
    expect(locomotionClip('sprint', 'forward', false)).toBe('fast_run');
  });

  it('closes real quaternion/hip seams without altering interior frames or one-shot actions', () => {
    const frames = 31, track = new Float32Array(frames * 4);
    for (let i = 0; i < frames; i++) new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), i / frames * .3).toArray(track, i * 4);
    const clip: Mocap = { name: 'test', duration: 1, frames, loop: true, stride: 2, bones: new Map([[0, track]]), hipsY: Array.from({ length: frames }, (_, i) => i / frames) };
    const middle = track.slice(15 * 4, 16 * 4);
    closeMocapLoop(clip);
    expect(new Quaternion().fromArray(track).angleTo(new Quaternion().fromArray(track, (frames - 1) * 4))).toBeLessThan(.001);
    expect(clip.hipsY[0]).toBe(clip.hipsY.at(-1));
    expect(track.slice(15 * 4, 16 * 4)).toEqual(middle);
    clip.loop = false;
    const before = track.slice(); closeMocapLoop(clip); expect(track).toEqual(before);
  });
});
