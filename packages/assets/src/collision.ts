import { propTransform, type ChunkData, type PropTransform } from '@zion/shared';
import { Heightfield, Layer, makeBox, makeCapsule, makeSphere, type ColliderInit } from '@zion/physics';
import type { AssetRegistry } from './registry';
import type { AssetDefinition } from './schema';

function layerFor(def: AssetDefinition, override?: 'static' | 'vegetation'): number {
  switch (override ?? def.collisionLayer) {
    case 'static':
      return Layer.Static;
    case 'vegetation':
      return Layer.Vegetation;
    case 'none':
      return 0;
  }
}

/** Transforms an asset's local collider definitions by an instance transform (scale → yaw → translate). */
export function assetColliders(def: AssetDefinition, t: PropTransform, out: ColliderInit[] = []): ColliderInit[] {
  if (layerFor(def) === 0) return out;
  const c = Math.cos(t.rotY);
  const s = Math.sin(t.rotY);
  const k = t.scale;
  // Local→world for points: three.js rotation.y convention.
  const tx = (x: number, z: number) => t.x + (x * c + z * s) * k;
  const tz = (x: number, z: number) => t.z + (-x * s + z * c) * k;
  for (const cd of def.colliders) {
    const layer = layerFor(def, cd.layer);
    switch (cd.type) {
      case 'sphere': {
        const [x, y, z] = cd.center;
        out.push({ shape: makeSphere(tx(x, z), t.y + y * k, tz(x, z), cd.radius * k), layer, tag: def.numericId });
        break;
      }
      case 'capsule': {
        const [ax, ay, az] = cd.a;
        const [bx, by, bz] = cd.b;
        out.push({
          shape: makeCapsule(tx(ax, az), t.y + ay * k, tz(ax, az), tx(bx, bz), t.y + by * k, tz(bx, bz), cd.radius * k),
          layer,
          tag: def.numericId,
        });
        break;
      }
      case 'box': {
        const [x, y, z] = cd.center;
        const [hx, hy, hz] = cd.halfExtents;
        out.push({
          shape: makeBox(tx(x, z), t.y + y * k, tz(x, z), hx * k, hy * k, hz * k, cd.yaw + t.rotY),
          layer,
          tag: def.numericId,
        });
        break;
      }
    }
  }
  return out;
}

export interface ChunkCollision {
  heightfield: Heightfield;
  colliders: ColliderInit[];
  /** Props whose asset id is unknown to this registry (version skew); they are skipped. */
  unknownAssets: number;
}

/** Builds collision data for a LOD-0 chunk. Server and client call this with identical input. */
export function buildChunkCollision(chunk: ChunkData, registry: AssetRegistry): ChunkCollision {
  const colliders: ColliderInit[] = [];
  let unknownAssets = 0;
  for (const p of chunk.props) {
    const def = registry.byNumericId(p.asset);
    if (!def) {
      unknownAssets++;
      continue;
    }
    assetColliders(def, propTransform(chunk, p), colliders);
  }
  return { heightfield: Heightfield.fromChunk(chunk), colliders, unknownAssets };
}
