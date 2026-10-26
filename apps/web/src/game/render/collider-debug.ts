import { Box3, BufferGeometry, Float32BufferAttribute, LineBasicMaterial, LineSegments, Vector3, type Object3D, type Scene } from 'three';
import { Layer, Mask, makeRayHit, type Collider, type CollisionWorld } from '@zion/physics';
import { VEHICLES, wheelCentre, type VehicleState } from '@zion/shared';

/**
 * F4 collision view: every collider near the player drawn as wireframe over the visible models,
 * coloured by layer, so mismatches between what is seen and what collides stand out:
 *
 * - white: static solids (walls, props), green: vegetation, purple: model-triangle solids (only
 *   their finder box is drawn; the triangles themselves collide), orange: free rigid bodies,
 *   red: colliders of different owners overlapping deeply (likely an authoring error).
 * - cyan: vehicles' centre of mass, velocity and each wheel's suspension down to its contact.
 * - yellow: the aim ray to the first thing a shot would meet, with that surface's normal.
 *
 * Rebuilt a few times a second from the CollisionWorld itself (no copies kept), within RADIUS.
 */
const RADIUS = 28;
const REBUILD = .25;
const MAX_SEGMENTS = 24000;

const COLOR = {
  static: [.92, .92, .92], vegetation: [.35, .85, .35], solid: [.7, .4, 1], dynamic: [1, .6, .15], overlap: [1, .15, .15],
  vehicle: [.2, .9, 1], ray: [1, .95, .2], normal: [1, .4, .9],
} as const;

export interface DebugExtras {
  vehicles: Iterable<VehicleState>;
  bodies: Iterable<{ root: Object3D }>;
  /** Aim ray origin and unit direction. */
  aim: { x: number; y: number; z: number; dx: number; dy: number; dz: number } | null;
}

export class ColliderDebug {
  private readonly lines: LineSegments;
  private readonly positions = new Float32Array(MAX_SEGMENTS * 6);
  private readonly colors = new Float32Array(MAX_SEGMENTS * 6);
  private n = 0;
  private wait = 0;
  private readonly found: Collider[] = [];
  private readonly hit = makeRayHit();
  private readonly box = new Box3();
  enabled = false;
  /** Last rebuild: colliders drawn and suspicious overlaps (shown in the console on toggle). */
  readonly stats = { colliders: 0, overlaps: 0 };

  constructor(private readonly scene: Scene) {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.positions, 3));
    g.setAttribute('color', new Float32BufferAttribute(this.colors, 3));
    this.lines = new LineSegments(g, new LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, opacity: .85 }));
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 10;
    this.lines.visible = false;
    scene.add(this.lines);
  }

  toggle(): boolean {
    this.enabled = !this.enabled;
    this.lines.visible = this.enabled;
    this.wait = 0;
    return this.enabled;
  }

  update(dt: number, world: CollisionWorld | undefined, x: number, y: number, z: number, extras: DebugExtras): void {
    if (!this.enabled || !world || (this.wait -= dt) > 0) return;
    this.wait = REBUILD;
    this.n = 0;
    const count = world.queryAABB({ minX: x - RADIUS, minY: y - RADIUS, minZ: z - RADIUS, maxX: x + RADIUS, maxY: y + RADIUS, maxZ: z + RADIUS }, Mask.All, this.found);
    const overlapping = this.overlaps(count);
    for (let i = 0; i < count; i++) {
      const c = this.found[i]!;
      const color = overlapping.has(c) ? COLOR.overlap : c.layer & Layer.Dynamic ? COLOR.dynamic : c.solid ? COLOR.solid : c.layer & Layer.Vegetation ? COLOR.vegetation : COLOR.static;
      this.shape(c, color);
    }
    this.stats.colliders = count; this.stats.overlaps = overlapping.size;
    for (const v of extras.vehicles) if (Math.hypot(v.x - x, v.z - z) < RADIUS * 2) this.vehicle(v);
    for (const b of extras.bodies) {
      this.box.setFromObject(b.root);
      if (!this.box.isEmpty() && this.box.distanceToPoint(new Vector3(x, y, z)) < RADIUS) this.aabb(this.box.min, this.box.max, COLOR.dynamic);
    }
    if (extras.aim) {
      const a = extras.aim, t = world.raycast(a.x, a.y, a.z, a.dx, a.dy, a.dz, 150, Mask.Weapon, this.hit) ? this.hit.t : 150;
      this.seg(a.x, a.y, a.z, a.x + a.dx * t, a.y + a.dy * t, a.z + a.dz * t, COLOR.ray);
      if (t < 150) {
        const h = this.hit;
        this.seg(h.x, h.y, h.z, h.x + h.nx * .6, h.y + h.ny * .6, h.z + h.nz * .6, COLOR.normal);
        this.cross(h.x, h.y, h.z, .08, COLOR.ray);
      }
    }
    const g = this.lines.geometry;
    g.setDrawRange(0, this.n * 2);
    (g.getAttribute('position') as Float32BufferAttribute).needsUpdate = true;
    (g.getAttribute('color') as Float32BufferAttribute).needsUpdate = true;
  }

  /** Pairs of colliders of different owners whose boxes interpenetrate by more than 30 % of the smaller one. */
  private overlaps(count: number): Set<Collider> {
    const out = new Set<Collider>();
    if (count > 600) return out;
    for (let i = 0; i < count; i++) for (let j = i + 1; j < count; j++) {
      const a = this.found[i]!, b = this.found[j]!;
      if (a.owner === b.owner || a.solid || b.solid || (a.layer | b.layer) & Layer.Vegetation) continue;
      const ix = Math.min(a.aabb.maxX, b.aabb.maxX) - Math.max(a.aabb.minX, b.aabb.minX);
      const iy = Math.min(a.aabb.maxY, b.aabb.maxY) - Math.max(a.aabb.minY, b.aabb.minY);
      const iz = Math.min(a.aabb.maxZ, b.aabb.maxZ) - Math.max(a.aabb.minZ, b.aabb.minZ);
      if (ix <= 0 || iy <= 0 || iz <= 0) continue;
      const vol = (c: Collider) => (c.aabb.maxX - c.aabb.minX) * (c.aabb.maxY - c.aabb.minY) * (c.aabb.maxZ - c.aabb.minZ);
      if (ix * iy * iz > .3 * Math.min(vol(a), vol(b))) { out.add(a); out.add(b); }
    }
    return out;
  }

  private shape(c: Collider, color: readonly number[]): void {
    const s = c.shape;
    if (s.type === 'sphere') { this.circle(s.cx, s.cy, s.cz, s.r, 0, color); this.circle(s.cx, s.cy, s.cz, s.r, 1, color); this.circle(s.cx, s.cy, s.cz, s.r, 2, color); return; }
    if (s.type === 'capsule') {
      this.circle(s.ax, s.ay, s.az, s.r, 1, color); this.circle(s.bx, s.by, s.bz, s.r, 1, color);
      for (const [ox, oz] of [[s.r, 0], [-s.r, 0], [0, s.r], [0, -s.r]] as const) this.seg(s.ax + ox, s.ay, s.az + oz, s.bx + ox, s.by, s.bz + oz, color);
      return;
    }
    // Box: yaw-only fast path, or a full rotation basis (vehicles, free bodies).
    const b = s.basis ?? [s.cos, 0, -s.sin, 0, 1, 0, s.sin, 0, s.cos];
    const corner = (i: number): [number, number, number] => {
      const lx = i & 1 ? s.hx : -s.hx, ly = i & 2 ? s.hy : -s.hy, lz = i & 4 ? s.hz : -s.hz;
      return [s.cx + b[0]! * lx + b[3]! * ly + b[6]! * lz, s.cy + b[1]! * lx + b[4]! * ly + b[7]! * lz, s.cz + b[2]! * lx + b[5]! * ly + b[8]! * lz];
    };
    for (const [i, j] of EDGES) this.seg(...corner(i), ...corner(j), color);
  }

  private vehicle(v: VehicleState): void {
    const def = VEHICLES[v.kind], m = v.motion;
    // Centre of mass as the server's Jolt chassis places it: low, around wheel-hub height.
    this.cross(v.x, v.y + Math.max(.15, def.wheelRadius * .55), v.z, .35, COLOR.vehicle);
    const lateral = m?.lateral ?? 0, vx = -Math.sin(v.yaw) * v.speed + Math.cos(v.yaw) * lateral, vz = -Math.cos(v.yaw) * v.speed - Math.sin(v.yaw) * lateral;
    this.seg(v.x, v.y, v.z, v.x + vx * .25, v.y + (m?.vy ?? 0) * .25, v.z + vz * .25, COLOR.vehicle);
    for (let i = 0; i < 4; i++) {
      const c = wheelCentre(v.kind, i), cos = Math.cos(v.yaw), sin = Math.sin(v.yaw);
      const wx = v.x + c.x * cos + c.z * sin, wz = v.z - c.x * sin + c.z * cos, top = v.y + def.wheelRadius + def.spring;
      const travel = m?.suspension[i] ?? def.spring;
      this.seg(wx, top, wz, wx, top - travel - def.wheelRadius, wz, COLOR.vehicle);
    }
  }

  private aabb(min: Vector3, max: Vector3, color: readonly number[]): void {
    const p = (i: number): [number, number, number] => [i & 1 ? max.x : min.x, i & 2 ? max.y : min.y, i & 4 ? max.z : min.z];
    for (const [i, j] of EDGES) this.seg(...p(i), ...p(j), color);
  }

  private circle(cx: number, cy: number, cz: number, r: number, plane: 0 | 1 | 2, color: readonly number[]): void {
    const N = 12;
    for (let i = 0; i < N; i++) {
      const a = i / N * Math.PI * 2, b = (i + 1) / N * Math.PI * 2;
      const at = (t: number): [number, number, number] => plane === 0 ? [cx, cy + Math.cos(t) * r, cz + Math.sin(t) * r] : plane === 1 ? [cx + Math.cos(t) * r, cy, cz + Math.sin(t) * r] : [cx + Math.cos(t) * r, cy + Math.sin(t) * r, cz];
      this.seg(...at(a), ...at(b), color);
    }
  }

  private cross(x: number, y: number, z: number, r: number, color: readonly number[]): void {
    this.seg(x - r, y, z, x + r, y, z, color); this.seg(x, y - r, z, x, y + r, z, color); this.seg(x, y, z - r, x, y, z + r, color);
  }

  private seg(ax: number, ay: number, az: number, bx: number, by: number, bz: number, color: readonly number[]): void {
    if (this.n >= MAX_SEGMENTS) return;
    const o = this.n++ * 6;
    this.positions.set([ax, ay, az, bx, by, bz], o);
    this.colors.set([color[0]!, color[1]!, color[2]!, color[0]!, color[1]!, color[2]!], o);
  }

  dispose(): void {
    this.scene.remove(this.lines);
    this.lines.geometry.dispose();
    (this.lines.material as LineBasicMaterial).dispose();
  }
}

const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]] as const;
