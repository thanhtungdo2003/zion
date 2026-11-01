import { describe, expect, it } from 'vitest';
import { battleFloorLoot, ITEMS } from '@zion/shared';
import { createDefaultRegistry } from '@zion/assets';
import { buildingLootSpots, buildingSurfaces } from './building-loot';

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

  it('gives every building some loot: inside when it has rooms, else on the ground round it', () => {
    const registry = createDefaultRegistry();
    const structures = registry.all().filter((d) => d.category === 'structure');
    // A building with rooms (several box colliders) and a solid one (a single box).
    const roomy = structures.find((d) => d.colliders.filter((c) => c.type === 'box').length > 8)!;
    const solid = structures.find((d) => d.colliders.length === 1 && d.colliders[0]!.type === 'box' && d.bounds.radius > 3)!;
    const site = (asset: number, x: number) => ({ x, y: 10, z: 0, yaw: .3, parts: [{ asset, x: 0, y: 0, z: 0, yaw: 0, scale: 1 }] });
    const spots = buildingLootSpots(registry, [site(roomy.numericId, 0), site(solid.numericId, 500)], 6, Math.random, () => 12);
    expect(spots.some((p) => p.x < 100)).toBe(true);
    const outside = spots.filter((p) => p.x > 400);
    expect(outside.length).toBeGreaterThan(0);
    expect(outside.every((p) => Math.abs(p.y - 12.08) < .01)).toBe(true);
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
