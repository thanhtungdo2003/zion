import { describe, expect, it } from 'vitest';
import { WorldGenerator } from '@zion/worldgen';
import { createDefaultRegistry } from '@zion/assets';
import { atlasProvider } from './atlas';

describe('world cartography', () => {
  it('caches concurrent requests and produces bounded terrain data without the seed', async () => {
    const world = new WorldGenerator({ seed: 123456789, sizeChunks: 16 }, createDefaultRegistry());
    const get = atlasProvider(world, 'atlas-world');
    const a = get(), b = get(); expect(a).toBe(b);
    const atlas = await a;
    expect(atlas.worldId).toBe('atlas-world'); expect(atlas.size).toBe(512);
    expect(Buffer.from(atlas.rgb, 'base64')).toHaveLength(atlas.pixels ** 2 * 3);
    expect(atlas).not.toHaveProperty('seed');
    expect(get()).toBe(a);
  });
});
