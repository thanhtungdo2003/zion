import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeHitMeshes, type HitMeshData } from '@zion/assets';

/**
 * Model triangles for precise shots (packages/assets/data/hit-meshes.bin), found from the source
 * tree, the built dist folder or the working directory. Empty when missing (coarse colliders only).
 */
export function loadHitMeshes(): Map<number, HitMeshData> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, '../../../../packages/assets/data/hit-meshes.bin'),
    path.resolve(here, '../../../packages/assets/data/hit-meshes.bin'),
    path.resolve(process.cwd(), 'packages/assets/data/hit-meshes.bin'),
    path.resolve(process.cwd(), '../../packages/assets/data/hit-meshes.bin'),
  ];
  const file = candidates.find((f) => existsSync(f));
  return file ? decodeHitMeshes(readFileSync(file)) : new Map();
}
