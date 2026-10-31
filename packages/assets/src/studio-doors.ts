import { hash3, propTransform, type ChunkData } from '@zion/shared';
import { Layer, makeBox, type ColliderInit } from '@zion/physics';
import type { AssetRegistry } from './registry';

/**
 * Doors of Model Studio houses in the game. A published house lists its door leaves (hinge,
 * closed direction, size; the leaves are left out of its own mesh), so wherever the house is
 * placed each leaf becomes a door that opens and closes: the server keeps their state and their
 * colliders, every client draws them and collides with them. A door's id comes from where it is
 * (the same on the server and every client, with nothing sent but the doors that were opened).
 */
export interface StudioDoor {
  id: number;
  /** The hinge at the foot of the leaf (world), and the closed leaf's direction along +x by yaw. */
  x: number; y: number; z: number; yaw: number;
  w: number; h: number;
  /** Leaf colour (sRGB hex). */
  color?: string;
}

/** Studio door ids live above the battle doors'. */
export const STUDIO_DOOR_ID_BASE = 0x40000000;
/** Collision owner of a studio door's leaf. */
export const studioDoorOwner = (id: number) => 0x100000000 + id;

/** Every door of the Model Studio houses placed on a chunk. */
export function chunkStudioDoors(chunk: ChunkData, registry: AssetRegistry): StudioDoor[] {
  const out: StudioDoor[] = [];
  for (const p of chunk.props) {
    const def = registry.byNumericId(p.asset);
    if (!def?.doors?.length) continue;
    const t = propTransform(chunk, p), c = Math.cos(t.rotY), s = Math.sin(t.rotY), k = t.scale;
    for (const d of def.doors) {
      const x = t.x + (d.x * c + d.z * s) * k, z = t.z + (-d.x * s + d.z * c) * k, y = t.y + d.y * k;
      const id = STUDIO_DOOR_ID_BASE + ((hash3(0x5d00, Math.round(x * 20), Math.round(y * 20), Math.round(z * 20)) >>> 0) % 0x3fffffff);
      out.push({ id, x, y, z, yaw: t.rotY + d.yaw, w: d.w * k, h: d.h * k, ...(d.color ? { color: d.color } : {}) });
    }
  }
  return out;
}

/** The leaf as a collider: closed across the doorway, or swung 90° into the room. */
export function studioDoorColliders(d: StudioDoor, open: boolean): ColliderInit[] {
  const yaw = d.yaw + (open ? Math.PI / 2 : 0), c = Math.cos(yaw), s = Math.sin(yaw), half = d.w / 2;
  return [{ shape: makeBox(d.x + half * c, d.y + d.h / 2, d.z - half * s, half, d.h / 2, .035, yaw), layer: Layer.Static, tag: 2202 }];
}

/** Whether someone standing at (x, z) is in the leaf's swing (the door is not closed on them). */
export function inStudioDoorSwing(d: StudioDoor, x: number, z: number): boolean {
  const dx = x - d.x, dz = z - d.z, c = Math.cos(d.yaw), s = Math.sin(d.yaw);
  const along = dx * c - dz * s, across = dx * s + dz * c;
  return along > -.2 && along < d.w + .2 && Math.abs(across) < d.w + .2;
}
