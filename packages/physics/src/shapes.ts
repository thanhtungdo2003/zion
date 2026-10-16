import type { HitRef } from './hit-mesh';
export interface AABB {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

export interface SphereShape {
  type: 'sphere';
  cx: number;
  cy: number;
  cz: number;
  r: number;
}

/** Capsule = all points within r of segment AB. */
export interface CapsuleShape {
  type: 'capsule';
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
  r: number;
}

/**
 * Box rotated about the vertical axis only (yaw). Every man-made structure in the game stands
 * upright, so yaw-only OBBs cover buildings, walls, crates and rock slabs while keeping tests cheap.
 * yaw = 0 is an axis-aligned box. Rotation convention matches three.js `rotation.y`.
 */
export interface BoxShape {
  type: 'box';
  cx: number;
  cy: number;
  cz: number;
  hx: number;
  hy: number;
  hz: number;
  yaw: number;
  /** Cached cos(yaw) / sin(yaw). Use makeBox() to construct. */
  cos: number;
  sin: number;
  /** Optional full rotation for dynamic bodies; buildings retain the yaw-only fast path. */
  basis?: readonly number[];
}

export type ColliderShape = SphereShape | CapsuleShape | BoxShape;

export function makeSphere(cx: number, cy: number, cz: number, r: number): SphereShape {
  return { type: 'sphere', cx, cy, cz, r };
}

export function makeCapsule(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  r: number,
): CapsuleShape {
  return { type: 'capsule', ax, ay, az, bx, by, bz, r };
}

export function makeBox(
  cx: number,
  cy: number,
  cz: number,
  hx: number,
  hy: number,
  hz: number,
  yaw = 0,
): BoxShape {
  return { type: 'box', cx, cy, cz, hx, hy, hz, yaw, cos: Math.cos(yaw), sin: Math.sin(yaw) };
}

export function shapeAABB(s: ColliderShape, out: AABB = emptyAABB()): AABB {
  switch (s.type) {
    case 'sphere':
      out.minX = s.cx - s.r;
      out.minY = s.cy - s.r;
      out.minZ = s.cz - s.r;
      out.maxX = s.cx + s.r;
      out.maxY = s.cy + s.r;
      out.maxZ = s.cz + s.r;
      return out;
    case 'capsule':
      out.minX = Math.min(s.ax, s.bx) - s.r;
      out.minY = Math.min(s.ay, s.by) - s.r;
      out.minZ = Math.min(s.az, s.bz) - s.r;
      out.maxX = Math.max(s.ax, s.bx) + s.r;
      out.maxY = Math.max(s.ay, s.by) + s.r;
      out.maxZ = Math.max(s.az, s.bz) + s.r;
      return out;
    case 'box': {
      if (s.basis) {
        const b=s.basis,ex=Math.abs(b[0]!)*s.hx+Math.abs(b[3]!)*s.hy+Math.abs(b[6]!)*s.hz,
          ey=Math.abs(b[1]!)*s.hx+Math.abs(b[4]!)*s.hy+Math.abs(b[7]!)*s.hz,
          ez=Math.abs(b[2]!)*s.hx+Math.abs(b[5]!)*s.hy+Math.abs(b[8]!)*s.hz;
        Object.assign(out,{minX:s.cx-ex,maxX:s.cx+ex,minY:s.cy-ey,maxY:s.cy+ey,minZ:s.cz-ez,maxZ:s.cz+ez});
        return out;
      }
      const ex = Math.abs(s.cos) * s.hx + Math.abs(s.sin) * s.hz;
      const ez = Math.abs(s.sin) * s.hx + Math.abs(s.cos) * s.hz;
      out.minX = s.cx - ex;
      out.minY = s.cy - s.hy;
      out.minZ = s.cz - ez;
      out.maxX = s.cx + ex;
      out.maxY = s.cy + s.hy;
      out.maxZ = s.cz + ez;
      return out;
    }
  }
}

export function emptyAABB(): AABB {
  return { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 };
}

export function aabbOverlap(a: AABB, b: AABB): boolean {
  return (
    a.minX <= b.maxX &&
    a.maxX >= b.minX &&
    a.minY <= b.maxY &&
    a.maxY >= b.minY &&
    a.minZ <= b.maxZ &&
    a.maxZ >= b.minZ
  );
}

export interface Collider {
  /** Unique id inside a CollisionWorld. */
  readonly id: number;
  readonly shape: ColliderShape;
  readonly layer: number;
  readonly aabb: AABB;
  /** Owner handle (chunk key for world props, entity id for dynamic objects). */
  readonly owner: number;
  /** Free-form tag, e.g. numeric asset id. */
  readonly tag: number;
  /** Placed model whose own triangles decide whether a shot really hits (props). */
  readonly hit?: HitRef;
  /** Internal query de-duplication stamp. */
  stamp: number;
}

export interface Contact {
  /** Unit normal pointing out of the obstacle, towards the query shape. */
  nx: number;
  ny: number;
  nz: number;
  /** Penetration depth along the normal (> 0). */
  depth: number;
  layer: number;
  colliderId: number;
  /** The collider's tag (asset id), 0 for terrain. */
  tag: number;
}

export function makeContact(): Contact {
  return { nx: 0, ny: 1, nz: 0, depth: 0, layer: 0, colliderId: -1, tag: 0 };
}

export interface RayHit {
  t: number;
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
  layer: number;
  /** -1 for terrain hits. */
  colliderId: number;
  tag: number;
}

export function makeRayHit(): RayHit {
  return { t: Infinity, x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0, layer: 0, colliderId: -1, tag: 0 };
}
