import { describe, expect, it } from 'vitest';
import { buildChunkCollision, createDefaultRegistry } from '@zion/assets';
import { CollisionWorld } from '@zion/physics';
import { WorldGenerator, normalizeSeed } from '@zion/worldgen';
import { WalkingMap } from './navigation';

describe('bridge entrances', () => {
  it('walks from the road across each type of bridge and down onto the opposite shore', () => {
    const registry = createDefaultRegistry();
    const gen = new WorldGenerator({ seed: normalizeSeed('zion-alpha'), sizeChunks: 128 }, registry);
    for (const kind of ['large', 'wood', 'stone', 'asphalt'] as const) {
      const bridge = gen.roads!.bridges.find(b => b.kind === kind)!;
      expect(bridge).toBeDefined();
      const world = new CollisionWorld({ worldSize: gen.worldSize, seaLevel: gen.seaLevel });
      const minX = Math.floor((Math.min(bridge.a.x, bridge.b.x) - 8) / 32), maxX = Math.floor((Math.max(bridge.a.x, bridge.b.x) + 8) / 32);
      const minZ = Math.floor((Math.min(bridge.a.z, bridge.b.z) - 8) / 32), maxZ = Math.floor((Math.max(bridge.a.z, bridge.b.z) + 8) / 32);
      for (let cz = minZ; cz <= maxZ; cz++) for (let cx = minX; cx <= maxX; cx++) {
        const collision = buildChunkCollision(gen.generateChunk(cx, cz, 0), registry);
        world.addChunk(cx, cz, collision.heightfield, collision.colliders);
      }
      const ux = (bridge.b.x - bridge.a.x) / bridge.length, uz = (bridge.b.z - bridge.a.z) / bridge.length;
      const from = { x: bridge.a.x - ux * 2, z: bridge.a.z - uz * 2, y: 0 };
      from.y = gen.heightAt(from.x, from.z) + .02;
      const to = { x: bridge.b.x + ux * 2, z: bridge.b.z + uz * 2, y: 0 };
      to.y = gen.heightAt(to.x, to.z) + .02;
      const map = new WalkingMap(world);
      expect(map.reaches(from, to), JSON.stringify({ kind, bridge, from, to })).toBe(true);
      expect(map.reaches(to, from), JSON.stringify({ kind, bridge, from, to })).toBe(true);
    }
  });
});
