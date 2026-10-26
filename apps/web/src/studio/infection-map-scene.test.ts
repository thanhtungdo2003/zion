import { afterEach, describe, expect, it, vi } from 'vitest';
import { Box3, BoxGeometry, MeshBasicMaterial } from 'three';
import { createDefaultRegistry } from '@zion/assets';
import { modelInfectionMap } from '@zion/shared';
import type { InfectionMapPreview } from '@/lib/api';
import { AssetLibrary } from '@/game/render/asset-library';
import { buildInfectionMapScene } from './infection-map-scene';

afterEach(() => vi.restoreAllMocks());

describe('infection map scene', () => {
  it('loads the replacement base and its transform when preview counts stay the same', async () => {
    const registry = createDefaultRegistry();
    const [first, second] = registry.all();
    const load = vi.spyOn(AssetLibrary.prototype, 'load').mockImplementation((id) => Promise.resolve({
      def: registry.byNumericId(id)!,
      parts: [{ geometry: new BoxGeometry(4, 6, 8), material: new MeshBasicMaterial() }],
    }));
    const draft = modelInfectionMap('imported', 'Imported', second!.numericId);
    const preview: InfectionMapPreview = {
      half: 30, step: 60, size: 2, origin: -30, heights: [20, 20, 20, 20], grass: [0, 0, 0, 0],
      base: [{ asset: first!.numericId, x: 0, y: 20, z: 0, yaw: 0, scale: 1 }],
      wall: [], nature: [], spawns: [], zombieSpawns: [], ground: 20,
    };
    await buildInfectionMapScene(preview, draft, registry);
    const next = { ...preview, base: [{ asset: second!.numericId, x: 12, y: 24, z: -9, yaw: 0, scale: 2 }] };
    const root = await buildInfectionMapScene(next, draft, registry);
    expect(load.mock.calls.map(([id]) => id)).toEqual([first!.numericId, second!.numericId]);
    const model = root.children.find((o) => o.userData.asset === second!.numericId)!;
    expect(model.position.toArray()).toEqual([12, 24, -9]);
    const bounds = new Box3().setFromObject(model);
    expect(bounds.min.toArray()).toEqual([8, 18, -17]);
    expect(bounds.max.toArray()).toEqual([16, 30, -1]);
    expect(root.userData.failed).toEqual([]);
  });

  it('reports an unregistered uploaded model instead of silently showing only ground', async () => {
    vi.spyOn(AssetLibrary.prototype, 'load').mockReturnValue(undefined);
    const draft = modelInfectionMap('imported', 'Imported', 2900);
    const preview: InfectionMapPreview = {
      half: 30, step: 60, size: 2, origin: -30, heights: [20, 20, 20, 20], grass: [0, 0, 0, 0],
      base: [{ asset: 2900, x: 0, y: 20, z: 0, yaw: 0, scale: 1 }],
      wall: [], nature: [], spawns: [], zombieSpawns: [],
    };
    const root = await buildInfectionMapScene(preview, draft);
    expect(root.userData.failed).toEqual([expect.stringContaining('#2900')]);
  });
});
