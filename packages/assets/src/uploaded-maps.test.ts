import { describe, expect, it } from 'vitest';
import { solidMaterial, uploadedMapFit, voxelColliders } from './uploaded-maps';

type V = [number, number, number];
/** A vertical wall (two triangles) in the x = `x` plane, z 0…4, y 0…3. */
const wall = (x: number): V[][] => [[[x, 0, 0], [x, 3, 0], [x, 0, 4]], [[x, 3, 0], [x, 3, 4], [x, 0, 4]]];
const ground: V[][] = [[[-5, 0, -5], [5, 0, -5], [-5, 0, 5]], [[5, 0, -5], [5, 0, 5], [-5, 0, 5]]];

describe('uploaded map collision', () => {
  it('hugs the surfaces: a 70 cm gap between two walls stays open', () => {
    const boxes = voxelColliders([...ground, ...wall(0), ...wall(.7)], .08);
    const solidAt = (x: number, y: number, z: number) => boxes.some((b) => b.type === 'box' && [0, 1, 2].every((c) => Math.abs([x, y, z][c]! - b.center[c]!) <= b.halfExtents[c]!));
    expect(solidAt(.35, 1, 2)).toBe(false);
    expect(solidAt(0, 1, 2) || solidAt(.04, 1, 2)).toBe(true);
    expect(solidAt(2, .02, 2)).toBe(true);
  });
  it('fits a map in metres with fine cells, within the box budget', () => {
    const fit = uploadedMapFit([...ground, ...wall(0), ...wall(.7)]);
    expect(fit.colliders.length).toBeGreaterThan(0);
    expect(Math.max(...fit.colliders.map((b) => (b.type === 'box' ? Math.min(...b.halfExtents) : 1)))).toBeLessThan(.1);
  });
  it('collides only with textured, opaque materials', () => {
    expect(solidMaterial({ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } })).toBe(true);
    expect(solidMaterial({ pbrMetallicRoughness: { baseColorTexture: { index: 0 } }, alphaMode: 'MASK' })).toBe(false);
    expect(solidMaterial({ pbrMetallicRoughness: {} })).toBe(false);
    expect(solidMaterial(undefined)).toBe(false);
  });
});
