import { describe, expect, it } from 'vitest';
import { AimSway } from './aim-sway';

/** Turns at `rate` rad/s for `turn` s, then holds still; returns the view yaw each frame. */
function run(aim: number, rate: number, turn: number, total: number): number[] {
  const sway = new AimSway(), dt = 1 / 60, out: number[] = [];
  let yaw = 0;
  sway.settle(0, 0);
  for (let t = 0; t < total; t += dt) {
    if (t < turn) yaw += rate * dt; // the mouse
    yaw += sway.step(yaw, 0, dt, aim, 0).yaw;
    sway.settle(yaw, 0);
    out.push(yaw);
  }
  return out;
}

describe('aim sway', () => {
  it('hip fire follows the mouse exactly', () => {
    const v = run(0, 2, .3, 1.5);
    expect(v.at(-1)).toBeCloseTo(.6, 6);
  });
  it('aimed, the gun lags a turn, swings past the mark and settles on it', () => {
    const v = run(1, 2, .3, 3);
    const atStop = v[Math.round(.3 * 60) - 1]!;
    expect(atStop).toBeLessThan(.6 - .005); // dragging behind
    expect(Math.max(...v)).toBeGreaterThan(.6 + .002); // overshoot
    expect(v.at(-1)).toBeCloseTo(.6, 3); // settled where the mouse put it
  });
});
