import { describe, expect, it } from 'vitest';
import { battleFloorLoot, ITEMS } from '@zion/shared';
import { buildingSurfaces } from './building-loot';

const box = (cx: number, cz: number, hx: number, hz: number, y0: number, y1: number) => ({ cx, cz, hx, hz, yaw: 0, y0, y1 });

describe('battle royale: loot lying in buildings', () => {
  it('finds spots on the floor and on a table indoors, none in the walls or outside', () => {
    // A 8 × 8 m room: four walls 3 m high, a roof, a table in the middle.
    const room = [box(0, -4, 4, .1, 0, 3), box(0, 4, 4, .1, 0, 3), box(-4, 0, .1, 4, 0, 3), box(4, 0, .1, 4, 0, 3), box(0, 0, 4, 4, 3, 3.2), box(0, 0, .7, .5, 0, .8)];
    const spots = buildingSurfaces(room, 1);
    expect(spots.some((s) => Math.abs(s.y - .08) < .01)).toBe(true);
    expect(spots.some((s) => Math.abs(s.y - .88) < .01 && Math.abs(s.x) < .7)).toBe(true);
    expect(spots.every((s) => Math.abs(s.x) < 4 && Math.abs(s.z) < 4)).toBe(true);
    // No roof: outdoors, nothing.
    expect(buildingSurfaces(room.slice(0, 4), 1)).toHaveLength(0);
  });

  it('puts guns, ammunition and now and then a backpack on the floor', () => {
    let r = 1; const random = () => { r = (r * 16807) % 2147483647; return r / 2147483647; };
    const all = Array.from({ length: 400 }, () => battleFloorLoot(random)).flat();
    expect(all.every((i) => ITEMS[i.itemId])).toBe(true);
    expect(all.some((i) => ITEMS[i.itemId]!.category === 'ammo')).toBe(true);
    expect(all.some((i) => i.itemId === 'military_backpack')).toBe(true);
    expect(all.some((i) => ['rifle', 'pistol', 'smg', 'shotgun'].includes(ITEMS[i.itemId]!.category))).toBe(true);
  });
});
