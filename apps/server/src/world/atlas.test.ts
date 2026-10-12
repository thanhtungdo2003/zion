import { describe, expect, it } from 'vitest';
import { WorldGenerator } from '@zion/worldgen';
import { CAMP_ASSET, createDefaultRegistry } from '@zion/assets';
import { atlasProvider, atlasTileProvider, campFootprints } from './atlas';

describe('world cartography', () => {
  it('caches concurrent requests and produces bounded terrain data without the seed', async () => {
    const world = new WorldGenerator({ seed: 123456789, sizeChunks: 16 }, createDefaultRegistry());
    const get = atlasProvider(world, 'atlas-world');
    const a = get(), b = get(); expect(a).toBe(b);
    const atlas = await a;
    expect(atlas.worldId).toBe('atlas-world'); expect(atlas.size).toBe(512);
    expect(Buffer.from(atlas.rgb, 'base64')).toHaveLength(atlas.pixels ** 2 * 3);
    expect(atlas).not.toHaveProperty('seed');
    expect(atlas.roads).toEqual(world.roads!.segments.map(s => ({ ax: s.a.x, az: s.a.z, bx: s.b.x, bz: s.b.z, width: s.halfWidth * 2, bridge: !!s.bridge })));
    expect(get()).toBe(a);
  });
  it('maps scaled and rotated camp geometry and refreshes when Studio replaces the layout', async () => {
    const world = new WorldGenerator({ seed: 123456789, sizeChunks: 16 }, createDefaultRegistry());
    expect(world.camp).toBeTruthy();
    let parts = [{ asset: CAMP_ASSET['barbed-wire-fence'], x: 10, y: 0, z: -5, scale: 2, yaw: Math.PI / 2 }];
    const footprints = campFootprints(world, parts);
    expect(footprints).toHaveLength(1);
    expect(footprints[0]).toEqual({ x: world.camp!.x + 10, z: world.camp!.z - 5, halfX: 4, halfZ: 0.625, yaw: Math.PI / 2 });
    const get = atlasProvider(world, 'test', () => parts);
    const first = await get();
    parts = [{ ...parts[0]!, x: 25 }];
    const second = await get();
    expect(second.rgb).toBe(first.rgb);
    expect(second.campParts![0]!.x).toBe(world.camp!.x + 25);
    parts = [];
    expect((await get()).campParts).toEqual([]);
  });
  it('deduplicates detail tiles with one metre samples and rejects out-of-world tiles', async () => {
    const world = new WorldGenerator({ seed: 123456789, sizeChunks: 16 }, createDefaultRegistry());
    const get = atlasTileProvider(world, 'test');
    const first = get(1, 0);
    expect(get(1, 0)).toBe(first);
    const tile = await first;
    expect(tile).toMatchObject({ x: 256, z: 0, size: 256, pixels: 256, worldId: 'test' });
    expect(Buffer.from(tile.rgb, 'base64')).toHaveLength(256 * 256 * 3);
    for (const [x, z] of [[-1, 0], [2, 0], [0, 2], [0.5, 0], [NaN, 0]]) await expect(get(x!, z!)).rejects.toThrow(RangeError);
  });
});
