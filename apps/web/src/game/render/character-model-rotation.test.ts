import { describe, expect, it } from 'vitest';
import { Box3, type Mesh } from 'three';
import { buildBBModel, BB_UNITS_PER_METER, type RawModel } from './character-model';

/** One 4×1×1 px cube in one group; `rotation` is the element's own Blockbench rotation. */
function model(rotation?: unknown): RawModel {
  return {
    resolution: { width: 16, height: 16 },
    elements: [{ uuid: 'c', from: [0, 0, 0], to: [4, 1, 1], origin: [0, 0, 0], ...(rotation ? { rotation } : {}) } as RawModel['elements'][number]],
    outliner: [{ name: 'root', origin: [0, 0, 0], children: ['c'] }],
    textures: [],
  };
}

async function size(rotation?: unknown) {
  const { root } = await buildBBModel(model(rotation));
  const mesh = root.getObjectByName('root_mesh') as Mesh;
  mesh.geometry.computeBoundingBox();
  const box = mesh.geometry.boundingBox as Box3;
  return box.max.clone().sub(box.min).multiplyScalar(BB_UNITS_PER_METER);
}

describe('buildBBModel element rotation', () => {
  it('leaves an unrotated cube as authored', async () => {
    const s = await size();
    expect(s.x).toBeCloseTo(4); expect(s.y).toBeCloseTo(1);
  });

  it('rotates a cube about its origin like Blockbench (Euler ZYX, degrees)', async () => {
    const s = await size([0, 0, 90]);
    expect(s.x).toBeCloseTo(1); expect(s.y).toBeCloseTo(4); // the long side now points up
  });

  it('supports the legacy single-axis rotation object', async () => {
    const s = await size({ angle: 90, axis: 'z', origin: [0, 0, 0] });
    expect(s.x).toBeCloseTo(1); expect(s.y).toBeCloseTo(4);
  });
});
