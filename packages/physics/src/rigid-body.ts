/**
 * Rigid-body descriptions shared by the server simulation (Jolt) and tests: surface materials,
 * physics proxies built from an asset's collision geometry, and pose/inertia helpers. Nothing here
 * touches Jolt, so it runs anywhere (server, browser, tests).
 */

/** Surface response. Jolt combines friction as sqrt(a·b) and restitution as max(a, b) per contact. */
export interface SurfaceMaterial {
  /** Coulomb friction coefficient (Jolt uses one value for sticking and sliding). */
  friction: number;
  /** Bounce: 0 = dead stop, 1 = perfectly elastic. */
  restitution: number;
  /** kg/m³ of the solid material; hollow props give their mass explicitly instead. */
  density: number;
}

export const SURFACE_MATERIALS = {
  wood: { friction: .55, restitution: .22, density: 600 },
  metal: { friction: .4, restitution: .18, density: 7850 },
  /** Thin steel shells (oil drums, sign plates): ring a little more than a solid block. */
  sheetMetal: { friction: .35, restitution: .3, density: 7850 },
  plastic: { friction: .45, restitution: .32, density: 950 },
  rubber: { friction: .9, restitution: .5, density: 1100 },
  glass: { friction: .3, restitution: .15, density: 2500 },
  concrete: { friction: .75, restitution: .08, density: 2400 },
} as const satisfies Record<string, SurfaceMaterial>;
export type MaterialId = keyof typeof SURFACE_MATERIALS;

/** One convex piece of a physics proxy, in the body's local frame (origin = the model's origin). */
export type ProxyPart =
  | { type: 'box'; cx: number; cy: number; cz: number; hx: number; hy: number; hz: number; yaw: number }
  | { type: 'sphere'; cx: number; cy: number; cz: number; r: number }
  | { type: 'capsule'; ax: number; ay: number; az: number; bx: number; by: number; bz: number; r: number }
  | { type: 'cylinder'; cx: number; cy: number; cz: number; r: number; hh: number };

export interface RigidBodyDef {
  parts: ProxyPart[];
  /** Total mass, kg. Inertia comes from the proxy's shape with this mass. */
  mass: number;
  material: MaterialId;
}

/** Position of the model origin and its orientation. */
export interface BodyPose { x: number; y: number; z: number; qx: number; qy: number; qz: number; qw: number }

export interface BodyState {
  pose: BodyPose;
  /** Linear velocity (m/s) and angular velocity (rad/s), world frame. */
  v: [number, number, number];
  w: [number, number, number];
  awake: boolean;
}

/** The subset of an asset collider definition a proxy is built from (see @zion/assets schema). */
export type AssetColliderLike =
  | { type: 'box'; center: readonly number[]; halfExtents: readonly number[]; yaw?: number }
  | { type: 'sphere'; center: readonly number[]; radius: number }
  | { type: 'capsule'; a: readonly number[]; b: readonly number[]; radius: number };

/** A dynamic proxy keeps at most this many convex parts; beyond that the solver cost is not worth it. */
export const MAX_PROXY_PARTS = 8;
/** Thinner than this (m) and a fast body may tunnel even with CCD margins; proxies are padded to it. */
const MIN_HALF = .025;

/**
 * Physics proxy from the asset's own collision geometry (scaled): each collider becomes one convex
 * part, so an L-shaped barrier or a sign on a pole keeps its shape instead of one bounding box.
 * Assets with more parts than MAX_PROXY_PARTS fall back to the parts' common bounding box.
 */
export function proxyFromColliders(colliders: readonly AssetColliderLike[], scale = 1): ProxyPart[] {
  const parts: ProxyPart[] = colliders.map((c) => {
    if (c.type === 'box') return { type: 'box', cx: c.center[0]! * scale, cy: c.center[1]! * scale, cz: c.center[2]! * scale,
      hx: Math.max(MIN_HALF, c.halfExtents[0]! * scale), hy: Math.max(MIN_HALF, c.halfExtents[1]! * scale), hz: Math.max(MIN_HALF, c.halfExtents[2]! * scale), yaw: c.yaw ?? 0 };
    if (c.type === 'sphere') return { type: 'sphere', cx: c.center[0]! * scale, cy: c.center[1]! * scale, cz: c.center[2]! * scale, r: Math.max(MIN_HALF, c.radius * scale) };
    return { type: 'capsule', ax: c.a[0]! * scale, ay: c.a[1]! * scale, az: c.a[2]! * scale, bx: c.b[0]! * scale, by: c.b[1]! * scale, bz: c.b[2]! * scale, r: Math.max(MIN_HALF, c.radius * scale) };
  });
  if (parts.length <= MAX_PROXY_PARTS) return parts;
  const b = proxyBounds(parts);
  return [{ type: 'box', cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2, cz: (b.minZ + b.maxZ) / 2, hx: (b.maxX - b.minX) / 2, hy: (b.maxY - b.minY) / 2, hz: (b.maxZ - b.minZ) / 2, yaw: 0 }];
}

/** Local axis-aligned bounds of a proxy. */
export function proxyBounds(parts: readonly ProxyPart[]): { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number } {
  const b = { minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity };
  const add = (x: number, y: number, z: number, ex: number, ey: number, ez: number) => {
    b.minX = Math.min(b.minX, x - ex); b.maxX = Math.max(b.maxX, x + ex);
    b.minY = Math.min(b.minY, y - ey); b.maxY = Math.max(b.maxY, y + ey);
    b.minZ = Math.min(b.minZ, z - ez); b.maxZ = Math.max(b.maxZ, z + ez);
  };
  for (const p of parts) {
    if (p.type === 'box') {
      const c = Math.abs(Math.cos(p.yaw)), s = Math.abs(Math.sin(p.yaw));
      add(p.cx, p.cy, p.cz, c * p.hx + s * p.hz, p.hy, s * p.hx + c * p.hz);
    } else if (p.type === 'sphere') add(p.cx, p.cy, p.cz, p.r, p.r, p.r);
    else if (p.type === 'cylinder') add(p.cx, p.cy, p.cz, p.r, p.hh, p.r);
    else { add(p.ax, p.ay, p.az, p.r, p.r, p.r); add(p.bx, p.by, p.bz, p.r, p.r, p.r); }
  }
  return b;
}

/** Solid volume of the proxy (m³), overlaps counted twice. */
export function proxyVolume(parts: readonly ProxyPart[]): number {
  let v = 0;
  for (const p of parts) {
    if (p.type === 'box') v += 8 * p.hx * p.hy * p.hz;
    else if (p.type === 'sphere') v += 4 / 3 * Math.PI * p.r ** 3;
    else if (p.type === 'cylinder') v += Math.PI * p.r * p.r * 2 * p.hh;
    else v += Math.PI * p.r * p.r * Math.hypot(p.bx - p.ax, p.by - p.ay, p.bz - p.az) + 4 / 3 * Math.PI * p.r ** 3;
  }
  return v;
}

/** Mass of a proxy filled with its material (for solid props that do not state a mass). */
export function solidMass(parts: readonly ProxyPart[], material: MaterialId): number {
  return proxyVolume(parts) * SURFACE_MATERIALS[material].density;
}

/** Principal moments of a solid box (kg·m²) about its centre: the reference the solver must match. */
export function boxInertia(mass: number, hx: number, hy: number, hz: number): [number, number, number] {
  return [mass * (hy * hy + hz * hz) / 3, mass * (hx * hx + hz * hz) / 3, mass * (hx * hx + hy * hy) / 3];
}

/** Rotates local (x, y, z) by the pose's quaternion and adds its position. */
export function poseTransform(p: BodyPose, x: number, y: number, z: number): [number, number, number] {
  const { qx, qy, qz, qw } = p;
  const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
  return [p.x + x + qw * tx + (qy * tz - qz * ty), p.y + y + qw * ty + (qz * tx - qx * tz), p.z + z + qw * tz + (qx * ty - qy * tx)];
}

/** Column-major 3×3 rotation of a quaternion (same layout as BoxShape.basis). */
export function quatToBasis(x: number, y: number, z: number, w: number): number[] {
  return [1 - 2 * (y * y + z * z), 2 * (x * y + w * z), 2 * (x * z - w * y), 2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x), 2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y)];
}

/** Yaw about +Y as a pose quaternion. */
export function yawPose(x: number, y: number, z: number, yaw: number): BodyPose {
  return { x, y, z, qx: 0, qy: Math.sin(yaw / 2), qz: 0, qw: Math.cos(yaw / 2) };
}

/** CollisionWorld tags of dynamic bodies: above every asset id, so a hit is never taken for a prop. */
export const DYNAMIC_BODY_TAG = 0x10000;
export const isDynamicBodyTag = (tag: number | undefined): boolean => tag !== undefined && tag >= DYNAMIC_BODY_TAG && tag < DYNAMIC_BODY_TAG * 2;
/** CollisionWorld owner handle of a dynamic body's colliders. */
export const dynamicBodyOwner = (id: number): number => 0xb0000000 + id;
