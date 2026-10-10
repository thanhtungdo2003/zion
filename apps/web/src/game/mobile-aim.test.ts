import { describe, expect, it } from 'vitest';
import { mobileAimScore } from './mobile-aim';

describe('mobile aim acquisition', () => {
  it('rejects targets behind, beside, too close, or beyond weapon range', () => {
    for (const [x, z] of [[0, 10], [10, 0], [0, -0.1], [0, -31]]) {
      expect(mobileAimScore(x!, z!, 0, 30)).toBe(Infinity);
    }
    expect(mobileAimScore(0, -10, 0, 30)).toBeLessThan(Infinity);
  });
  it('follows the manual heading and favours close targets near its centre', () => {
    expect(mobileAimScore(-10, 0, Math.PI / 2, 30)).toBeLessThan(Infinity);
    expect(mobileAimScore(10, 0, Math.PI / 2, 30)).toBe(Infinity);
    expect(mobileAimScore(0, -10, 0, 30)).toBeLessThan(mobileAimScore(4, -10, 0, 30));
    expect(mobileAimScore(0, -10, 0, 30)).toBeLessThan(mobileAimScore(0, -20, 0, 30));
  });
});
