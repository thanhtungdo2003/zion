import { describe, expect, it, vi } from 'vitest';
import { MeleeFeel } from './melee-feel';

describe('melee feel', () => {
  it('freezes on a hit, punches the view, then settles; combos count up and rise in pitch', () => {
    const play = vi.fn();
    const feel = new MeleeFeel(play);
    feel.swing(1, 400, 3.5, 0);
    expect(play).toHaveBeenCalledWith('swordSlash', expect.any(Number), expect.any(Number));
    feel.impact(200, { head: false, damage: 65, slash: true });
    expect(feel.update(1 / 60, 210).timeScale).toBe(0);
    let frame = feel.update(1 / 60, 400);
    expect(frame.timeScale).toBe(1);
    for (let t = 400; t < 900; t += 16) frame = feel.update(1 / 60, t);
    expect(Math.abs(frame.yaw) + Math.abs(frame.roll) + Math.abs(frame.fov)).toBeGreaterThan(0);
    for (let t = 900; t < 3000; t += 16) frame = feel.update(1 / 60, t);
    expect(Math.abs(frame.yaw) + Math.abs(frame.roll) + Math.abs(frame.fov) + frame.shake).toBeLessThan(.01);
    feel.impact(3000, { head: true, damage: 65, slash: true });
    feel.impact(3500, { head: false, damage: 65, slash: true });
    expect(feel.combo).toBe(2);
    const rates = play.mock.calls.filter((c) => c[0] === 'hitFlesh').map((c) => c[2] as number);
    expect(rates.at(-1)!).toBeGreaterThan(rates[0]! - .06);
    feel.impact(6000, { head: false, damage: 20, slash: false });
    expect(feel.combo).toBe(1);
  });
});
