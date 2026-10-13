import { describe, expect, it } from 'vitest';
import { mapHeading, mapToScreen, screenToMap, zoomMap } from './map-camera';

describe('player heading on the north-up world map', () => {
  it.each([0, Math.PI / 2, Math.PI, -Math.PI / 2, .73])('points toward the projected look direction for yaw %s', yaw => {
    const camera = { x: 500, z: 500, scale: .5 };
    const origin = mapToScreen(500, 500, 800, 600, camera);
    const ahead = mapToScreen(500 - Math.sin(yaw) * 20, 500 - Math.cos(yaw) * 20, 800, 600, camera);
    const angle = mapHeading(yaw);
    expect(Math.sin(angle)).toBeCloseTo((ahead.x - origin.x) / 10);
    expect(-Math.cos(angle)).toBeCloseTo((ahead.y - origin.y) / 10);
  });
});

describe('map dragging and zoom coordinates', () => {
  it('converts a map click to the correct world position after panning', () => {
    const camera = { x: 1200, z: 1900, scale: 0.5 };
    const pixel = mapToScreen(1300, 1800, 800, 600, camera);
    expect(pixel).toEqual({ x: 450, y: 250 });
    expect(screenToMap(pixel.x, pixel.y, 800, 600, camera)).toEqual({ x: 1300, z: 1800 });
  });
  it('keeps the point under the cursor fixed while zooming', () => {
    const camera = { x: 1200, z: 1900, scale: 0.5 };
    const point = screenToMap(100, 50, 800, 600, camera);
    const zoomed = zoomMap(camera, 2, 100, 50, 800, 600);
    expect(zoomed.scale).toBe(1);
    expect(screenToMap(100, 50, 800, 600, zoomed)).toEqual(point);
  });
  it('limits zoom so the map cannot collapse or grow without bound', () => {
    expect(zoomMap({ x: 0, z: 0, scale: 1 }, 1e9, 0, 0, 800, 600).scale).toBe(8);
    expect(zoomMap({ x: 0, z: 0, scale: 1 }, 1e-9, 0, 0, 800, 600).scale).toBe(0.025);
  });
});
