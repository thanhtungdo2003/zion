import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { createDefaultRegistry } from './builtin';
import { uploadedMapAsset, UPLOADED_MAP_ASSET_MIN } from './uploaded-maps';

describe('uploaded map models', () => {
  it('turn a GLB into a centred asset with voxel colliders, registered into a frozen registry', async () => {
    const glb = new Uint8Array(await readFile(new URL('../../../apps/web/public/models/dists/il-38.glb', import.meta.url)));
    const def = uploadedMapAsset(UPLOADED_MAP_ASSET_MIN, 'plane', glb);
    expect(def.colliders!.length).toBeGreaterThan(50);
    expect(def.bounds.height).toBeGreaterThan(3);
    const registry = createDefaultRegistry();
    registry.registerUploaded(def);
    expect(registry.byNumericId(UPLOADED_MAP_ASSET_MIN)?.name).toBe('plane');
    registry.registerUploaded({ ...def, name: 'again' });
    expect(registry.byNumericId(UPLOADED_MAP_ASSET_MIN)?.name).toBe('again');
    // Lowest point at 0, centred on the footprint.
    const ys = def.colliders!.map((c) => (c as { center: number[]; halfExtents: number[] }).center[1]! - (c as { halfExtents: number[] }).halfExtents[1]!);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(-.01);
  });
});
