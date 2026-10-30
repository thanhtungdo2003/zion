import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { closeMocapLoop, locomotionClip, locomotionGait, stepDirection } from './locomotion';
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

describe('stepping without flicker', () => {
  it('starts and stops stepping with hysteresis, so a wobbling speed keeps one state', () => {
    let gait: ReturnType<typeof locomotionGait> = 'idle';
    // A bot creeping at ~0.3 m/s with network wobble: never starts stepping.
    for (let i = 0; i < 50; i++) { gait = locomotionGait(.3 + Math.sin(i) * .08, false, gait); expect(gait).toBe('idle'); }
    gait = locomotionGait(1.5, false, gait);
    expect(gait).toBe('walk');
    // Slowing down through 0.2 ± 0.05: keeps walking until clearly stopped.
    for (let i = 0; i < 50; i++) { gait = locomotionGait(.22 + Math.sin(i) * .05, false, gait); expect(gait).toBe('walk'); }
    expect(locomotionGait(.05, false, gait)).toBe('idle');
  });

  it('keeps the stepping direction unless another clearly wins', () => {
    // Travel at about 45° between forward and right, wobbling: the first choice holds.
    let dir = stepDirection(.55, .7, null);
    expect(dir).toBe('right');
    for (let i = 0; i < 40; i++) { dir = stepDirection(.7 + Math.sin(i) * .1, .65, dir); expect(dir).toBe('right'); }
    // A clear turn to forward travel switches.
    expect(stepDirection(1, .1, dir)).toBe('forward');
  });
});
