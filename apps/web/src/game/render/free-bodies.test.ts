import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { BodyTimeline } from './free-bodies';

describe('free body playback', () => {
  it('interpolates between server poses, holds the ends and reports settling', () => {
    const t = new BodyTimeline(), out = { x: 0, y: 0, z: 0, q: new Quaternion() };
    t.push({ at: 1000, x: 0, y: 1, z: 0, q: new Quaternion(), asleep: false });
    t.push({ at: 1066, x: 2, y: 1, z: 0, q: new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 1), asleep: true });
    t.sample(1033, out);
    expect(out.x).toBeCloseTo(1, 1);
    expect(2 * Math.acos(out.q.w)).toBeCloseTo(.5, 1);
    // No extrapolation past the newest pose: a body never overshoots into a wall.
    t.sample(1500, out);
    expect(out.x).toBe(2);
    expect(t.settled(1033)).toBe(false);
    expect(t.settled(1066)).toBe(true);
    // Late (out-of-order) packets are ignored.
    t.push({ at: 900, x: 9, y: 9, z: 9, q: new Quaternion(), asleep: false });
    expect(t.frames).toHaveLength(2);
  });
});
