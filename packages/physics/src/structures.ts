import {
  BLUEPRINT_BY_ID,
  MAX_BUILD_SLOPE,
  STRUCTURE_TAG_BASE,
  blueprintPieces,
  structureToWorld,
  type BlueprintDef,
  type StructurePiece,
  type StructureState,
} from '@zion/shared';
import { Layer } from './layers';
import { makeBox, type AABB, type Collider } from './shapes';
import type { ColliderInit, CollisionWorld } from './world';

const PIECES = new Map<string, StructurePiece[]>();
/** A blueprint's pieces (cached). */
export function piecesOf(blueprint: string): StructurePiece[] {
  let list = PIECES.get(blueprint);
  if (!list) {
    const def = BLUEPRINT_BY_ID.get(blueprint);
    list = def ? blueprintPieces(def) : [];
    PIECES.set(blueprint, list);
  }
  return list;
}

/** Colliders of a placed structure: every standing piece but open doors (tagged per piece). */
export function structureColliders(s: StructureState): ColliderInit[] {
  const out: ColliderInit[] = [];
  piecesOf(s.blueprint).forEach((p, i) => {
    if ((s.hp[i] ?? 0) <= 0 || s.open?.includes(i)) return;
    const [x, z] = structureToWorld(s.x, s.z, s.yaw, p.x, p.z);
    out.push({ shape: makeBox(x, s.y + p.y, z, p.hx, p.hy, p.hz, s.yaw), layer: Layer.Static, tag: STRUCTURE_TAG_BASE + s.id * 64 + i });
  });
  return out;
}

/** Collider tag → structure id and piece index (null for anything else). */
export function structurePieceOf(tag: number | undefined): { id: number; piece: number } | null {
  if (tag === undefined || tag < STRUCTURE_TAG_BASE) return null;
  const n = tag - STRUCTURE_TAG_BASE;
  return { id: Math.floor(n / 64), piece: n % 64 };
}

export type PlacementVerdict = { ok: true; y: number } | { ok: false; y: number; reason: 'unloaded' | 'slope' | 'water' | 'blocked' };

const scratch: Collider[] = [];
/**
 * Can a blueprint stand at (x, z) turned by `yaw`? The ground under its corners must be loaded, dry
 * and even enough; nothing solid (props, trees, buildings, other structures) may stand inside.
 * The floor sits at the highest corner; walls reach down into the slope.
 */
export function checkPlacement(world: CollisionWorld, def: BlueprintDef, x: number, z: number, yaw: number): PlacementVerdict {
  const hw = def.w / 2, hd = def.d / 2, r = Math.hypot(hw, hd);
  if (!world.isAreaLoaded(x - r, z - r, x + r, z + r) || !world.inBounds(x - r, z - r) || !world.inBounds(x + r, z + r)) return { ok: false, y: 0, reason: 'unloaded' };
  let lo = Infinity, hi = -Infinity;
  for (const [lx, lz] of [[-hw, -hd], [hw, -hd], [-hw, hd], [hw, hd], [0, 0], [0, -hd], [0, hd], [-hw, 0], [hw, 0]] as const) {
    const [wx, wz] = structureToWorld(x, z, yaw, lx, lz);
    const h = world.terrainHeight(wx, wz);
    if (!Number.isFinite(h)) return { ok: false, y: 0, reason: 'unloaded' };
    if (h < world.waterLevel(wx, wz) + .25) return { ok: false, y: h, reason: 'water' };
    lo = Math.min(lo, h); hi = Math.max(hi, h);
  }
  const y = hi;
  if (hi - lo > MAX_BUILD_SLOPE) return { ok: false, y, reason: 'slope' };
  const box: AABB = { minX: x - r, minY: y + .25, minZ: z - r, maxX: x + r, maxY: y + def.h, maxZ: z + r };
  const n = world.queryAABB(box, Layer.Static, scratch);
  const c = Math.cos(yaw), s = Math.sin(yaw);
  for (let i = 0; i < n; i++) {
    const a = scratch[i]!.aabb;
    // The collider's box against the rotated footprint, in the structure's own frame.
    const cx = (a.minX + a.maxX) / 2 - x, cz = (a.minZ + a.maxZ) / 2 - z;
    const lx = cx * c - cz * s, lz = cx * s + cz * c;
    const ex = Math.min(a.maxX - a.minX, a.maxZ - a.minZ) / 2;
    if (Math.abs(lx) < hw + ex - .05 && Math.abs(lz) < hd + ex - .05) return { ok: false, y, reason: 'blocked' };
  }
  return { ok: true, y };
}
