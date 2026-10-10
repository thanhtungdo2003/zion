import { describe, expect, it } from 'vitest';
import { mapMarker } from './minimap';

describe('persistent map directions', () => {
  it('keeps nearby teammates at their relative map positions', () => {
    expect(mapMarker(12, -8, 0, 90)).toEqual({ x: 12, y: -8, off: false });
    expect(mapMarker(0, 0, 0, 90)).toEqual({ x: 0, y: 0, off: false });
  });
  it('pins distant teammates to the edge while preserving the direction', () => {
    expect(mapMarker(2000, -1000, 0, 90)).toEqual({ x: 90, y: -45, off: true });
    expect(mapMarker(-2000, 1000, 0, 90)).toEqual({ x: -90, y: 45, off: true });
  });
  it('rotates markers with camera orientation before clamping', () => {
    const marker = mapMarker(1000, 0, Math.PI / 2, 90);
    expect(marker.x).toBeCloseTo(0); expect(marker.y).toBeCloseTo(90); expect(marker.off).toBe(true);
  });
});
