import { describe, expect, it } from 'vitest';
import { PostureMotion } from './posture-motion';

const duration = (clip: string) => clip === 'stand_to_crouch' ? 1.5 : 1.8;

describe('recorded posture transitions', () => {
  it('chains standing to prone through crouch and uses both recordings in reverse to stand', () => {
    const motion = new PostureMotion();
    expect(motion.step(2, .7, duration)).toEqual({ clip: 'stand_to_crouch', time: .7, rate: 1 });
    const down = motion.step(2, 1, duration)!;
    expect(down.clip).toBe('crouch_to_prone'); expect(down.time).toBeCloseTo(.2);
    expect(motion.step(2, 2, duration)).toBeNull();
    expect(motion.step(0, .3, duration)).toEqual({ clip: 'crouch_to_prone', time: 1.5, rate: -1 });
    const up = motion.step(0, 1.7, duration)!;
    expect(up.clip).toBe('stand_to_crouch'); expect(up.time).toBeCloseTo(1.3); expect(up.rate).toBe(-1);
    expect(motion.step(0, 2, duration)).toBeNull();
  });

  it('reverses an interrupted transition at its current source time, including repeated toggles', () => {
    const motion = new PostureMotion();
    motion.step(1, .8, duration);
    expect(motion.step(0, .1, duration)!.time).toBeCloseTo(.7);
    expect(motion.step(2, .2, duration)!.time).toBeCloseTo(.9);
    motion.step(2, 1, duration);
    const reversed = motion.step(1, .1, duration)!;
    expect(reversed.clip).toBe('crouch_to_prone'); expect(reversed.time).toBeCloseTo(.3); expect(reversed.rate).toBe(-1);
    expect(motion.step(1, .5, duration)).toBeNull();
    expect(motion.step(1, 10, duration)).toBeNull();
  });

  it('handles long frames, missing assets and interaction resets without an invalid time', () => {
    const motion = new PostureMotion();
    expect(motion.step(2, 20, duration)).toBeNull();
    motion.reset(1);
    expect(motion.step(1, .1, duration)).toBeNull();
    expect(motion.step(0, .1, () => 0)).toBeNull();
    expect(motion.step(0, .1, duration)).toBeNull();
  });
});
