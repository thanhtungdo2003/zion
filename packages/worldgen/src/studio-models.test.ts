import { describe, expect, it } from 'vitest';
import { CHUNK_SIZE } from '@zion/shared';
import { createDefaultRegistry, type AssetDefinitionInput } from '@zion/assets';
import { WorldGenerator } from './generator';
import { battleStructures } from './battle-map';

/** A Model Studio house as published: one GLB, a solid collision box, garden and furniture models along. */
const house: AssetDefinitionInput = {
  id: 'studio.model_3000', numericId: 3000, name: 'Nhà thử', category: 'structure',
  model: { kind: 'glb', path: 'uploads/model-studio-3000.glb', scale: 1, offset: [0, 0, 0] },
  colliders: [{ type: 'box', center: [0, 4, 0], halfExtents: [8, 4, 10], solid: true }], collisionLayer: 'static',
  bounds: { radius: 12, height: 8 }, render: { maxDistance: 700 }, tags: ['model-studio'],
  composite: [{ asset: 2850, x: 1, y: .15, z: -2, yaw: 0, scale: 1 }, { asset: 2440, x: 6, y: 0, z: -9, yaw: 1, scale: .8 }],
} as AssetDefinitionInput;

describe('Model Studio models in the battle royale world', () => {
  it('puts trial houses on every other outskirts plot and places their furniture and garden with them', () => {
    const registry = createDefaultRegistry();
    registry.registerUploaded(house);
    const gen = new WorldGenerator({ seed: 1234, sizeChunks: 160, mode: 'battle-royale', studioHouses: [{ asset: 3000, radius: 12 }] }, registry);
    const sites = battleStructures(gen).filter((s) => s.parts.some((p) => p.asset === 3000));
    expect(sites).toHaveLength(3);
    const site = sites[0]!;
    // The chunks around the site hold the house and both of its companions.
    const props = [];
    for (let cz = Math.floor((site.z - 16) / CHUNK_SIZE); cz <= Math.floor((site.z + 16) / CHUNK_SIZE); cz++)
      for (let cx = Math.floor((site.x - 16) / CHUNK_SIZE); cx <= Math.floor((site.x + 16) / CHUNK_SIZE); cx++) props.push(...gen.generateChunk(cx, cz, 0).props);
    const ids = props.map((p) => p.asset);
    expect(ids.filter((a) => a === 3000)).toHaveLength(1);
    expect(ids).toContain(2850);
    expect(ids).toContain(2440);
    // Without the trial the island is unchanged.
    const plain = new WorldGenerator({ seed: 1234, sizeChunks: 160, mode: 'battle-royale' }, registry);
    expect(battleStructures(plain).some((s) => s.parts.some((p) => p.asset === 3000))).toBe(false);
  });
});
