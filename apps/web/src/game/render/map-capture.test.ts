import { describe, expect, it } from 'vitest';
import { mapTone } from './map-capture';

describe('map tone', () => {
  it('turns colour to a near-grey that keeps a hint of its hue', () => {
    const px = new Uint8ClampedArray([40, 160, 40, 255, 200, 60, 60, 255]);
    mapTone(px);
    const spread = (i: number) => Math.max(px[i]!, px[i + 1]!, px[i + 2]!) - Math.min(px[i]!, px[i + 1]!, px[i + 2]!);
    expect(spread(0)).toBeGreaterThan(5);
    expect(spread(0)).toBeLessThan(50);
    expect(px[1]!).toBeGreaterThan(px[0]!);
    expect(px[4]!).toBeGreaterThan(px[5]!);
    expect(px[3]).toBe(255);
  });
});
