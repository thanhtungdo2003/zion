import { describe, expect, it } from 'vitest';
import { compassBearing, compassHeading } from './compass';

describe('compass', () => {
  it('reads the heading clockwise from north (−Z); turning left lowers it', () => {
    expect(compassHeading(0)).toBe(0);
    expect(compassHeading(-Math.PI / 2)).toBeCloseTo(90);
    expect(compassHeading(Math.PI / 2)).toBeCloseTo(270);
    expect(compassHeading(Math.PI)).toBeCloseTo(180);
  });
  it('gives the bearing to a marked place the same way', () => {
    expect(compassBearing(0, 0, 0, -10)).toBeCloseTo(0);
    expect(compassBearing(0, 0, 10, 0)).toBeCloseTo(90);
    expect(compassBearing(0, 0, 0, 10)).toBeCloseTo(180);
    expect(compassBearing(0, 0, -10, 0)).toBeCloseTo(270);
  });
});
