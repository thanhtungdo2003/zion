import { readFile } from 'node:fs/promises';
import { Box3, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { CAMP_ASSET, VEHICLE_ASSET, createDefaultRegistry } from '@zion/assets';
import { loadBBModel } from './bbmodel-loader';

describe('real-scale vehicle models', () => {
  const registry = createDefaultRegistry();
  it.each([
    { id: VEHICLE_ASSET.motorcycle, size: [.85, 1.25, 2.15] },
    { id: VEHICLE_ASSET.car, size: [2.4, 1.75, 4.5] },
    { id: VEHICLE_ASSET.bus, size: [10.5, 3.2, 2.5] },
    { id: CAMP_ASSET['old-rusty-tank'], size: [4.2, 3.6, 9] },
  ])('loads model $id at human-relative dimensions with matching collision', async ({ id, size }) => {
    const def = registry.byNumericId(id)!;
    if (def.model.kind !== 'bbmodel') throw new Error('vehicle must use its authored model');
    const raw = JSON.parse(await readFile(new URL(`../../../public/models/${def.model.path}`, import.meta.url), 'utf8'));
    raw.textures = [];
    const parts = await loadBBModel(raw, def.model.unitsPerMeter, def.model.offset, def.model.axisScale);
    const bounds = new Box3();
    for (const part of parts) { part.geometry.computeBoundingBox(); bounds.union(part.geometry.boundingBox!); }
    const measured = bounds.getSize(new Vector3());
    // Rotated handlebars and bent panels can protrude a few centimetres beyond cube bounds.
    measured.toArray().forEach((value, axis) => expect(Math.abs(value - size[axis]!)).toBeLessThan(.05));
    expect(bounds.min.y).toBeCloseTo(0, 3);
    const collider = def.colliders[0]!;
    if (collider.type !== 'box') throw new Error('expected vehicle box');
    collider.halfExtents.forEach((value, axis) => expect(value * 2).toBeCloseTo(size[axis]!, 2));
    for (const part of parts) { part.geometry.dispose(); part.material.dispose(); }
  });
});
