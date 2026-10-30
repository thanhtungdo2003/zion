import { BoxGeometry, BufferAttribute, BufferGeometry, CylinderGeometry, Group, Mesh, MeshLambertMaterial, type Material } from 'three';
import { VEHICLES, VEHICLE_ROLES, seatAim, seatCount, vehicleMounts, type VehicleKind, type VehicleState, type WeaponMount } from '@zion/shared';
import type { ModelPart } from './bbmodel-loader';

/**
 * Turning mounts on a vehicle model: the turret's triangles (and its barrel's) are cut out of the
 * hull mesh by the regions in VEHICLE_MOUNTS and hung on groups that traverse and elevate with the
 * seat's aim. A mount the model has no gun for gets a generic machine gun drawn on it.
 */
export interface MountRig {
  seat: number;
  parent?: number;
  /** Traverses (rotation.y, relative to the mount it rides on) and elevates (rotation.x). */
  yaw: Group;
  pitch: Group;
  /** Shown aim, eased towards the network state. */
  shownYaw: number;
  shownPitch: number;
}

type Bucket = 'hull' | `${number}:yaw` | `${number}:pitch`;

/** Which group a triangle (three corners, model metres) turns with. */
function classify(mounts: readonly WeaponMount[], scale: number, a: number[], b: number[], c: number[]): Bucket {
  const corners = [a, b, c];
  // Roof guns before the turret they stand on.
  for (const m of [...mounts].sort((p, q) => (q.on !== undefined ? 1 : 0) - (p.on !== undefined ? 1 : 0))) {
    const [px, py, pz] = m.pitchAt;
    // The barrel: along the bore line, centred ahead of the trunnion (long triangles reach back into the mantlet).
    if (m.barrel && (a[2]! + b[2]! + c[2]!) * scale / 3 < pz && corners.every(([x, y]) => Math.abs(x! * scale - px) < m.barrel!.half && Math.abs(y! * scale - py) < m.barrel!.half)) return `${m.seat}:pitch`;
    const r = m.part;
    if (!r) continue;
    const inside = corners.every(([x, y, z]) => {
      const X = x! * scale, Y = y! * scale, Z = z! * scale;
      if (Y < r.y0 || (r.y1 !== undefined && Y > r.y1)) return false;
      return r.box ? X >= r.box[0] && Z >= r.box[1] && X <= r.box[2] && Z <= r.box[3] : Math.hypot(X - m.yawAt[0], Z - m.yawAt[1]) <= r.r!;
    });
    // A whole roof gun elevates; a turret's body only traverses.
    if (inside) return m.barrel ? `${m.seat}:yaw` : `${m.seat}:pitch`;
  }
  return 'hull';
}

/**
 * Splits a vehicle's body parts into hull and mount pieces. Returns the hull parts and the mount
 * pieces with their geometry relative to their group's origin.
 */
export function splitMounts(kind: VehicleKind, parts: readonly ModelPart[]): { hull: ModelPart[]; pieces: Map<Bucket, ModelPart[]> } {
  // The library shares one model between every vehicle of a kind: so is its split.
  const known = splits.get(parts);
  if (known) return known;
  const split = cut(kind, parts);
  splits.set(parts, split);
  return split;
}
const splits = new WeakMap<readonly ModelPart[], { hull: ModelPart[]; pieces: Map<Bucket, ModelPart[]> }>();
function cut(kind: VehicleKind, parts: readonly ModelPart[]): { hull: ModelPart[]; pieces: Map<Bucket, ModelPart[]> } {
  const mounts = vehicleMounts(kind), scale = VEHICLES[kind].scale, pieces = new Map<Bucket, ModelPart[]>(), hull: ModelPart[] = [];
  if (!mounts.some((m) => m.part || m.barrel)) return { hull: [...parts], pieces };
  for (const part of parts) {
    if (part.wheel !== undefined || part.rotor) { hull.push(part); continue; }
    const g = part.geometry.index ? part.geometry.toNonIndexed() : part.geometry;
    const pos = g.getAttribute('position'), n = pos.count;
    const buckets = new Map<Bucket, number[]>();
    const v = (i: number) => [pos.getX(i), pos.getY(i), pos.getZ(i)];
    for (let i = 0; i + 2 < n; i += 3) {
      const key = classify(mounts, scale, v(i), v(i + 1), v(i + 2));
      let list = buckets.get(key);
      if (!list) buckets.set(key, list = []);
      list.push(i);
    }
    for (const [key, tris] of buckets) {
      if (key === 'hull' && buckets.size === 1) { hull.push(part); break; }
      const out = new BufferGeometry();
      for (const name of Object.keys(g.attributes)) {
        const src = g.getAttribute(name), size = src.itemSize, data = new Float32Array(tris.length * 3 * size);
        tris.forEach((t, k) => { for (let c = 0; c < 3; c++) for (let s = 0; s < size; s++) data[(k * 3 + c) * size + s] = src.getComponent(t + c, s); });
        out.setAttribute(name, new BufferAttribute(data, size, src.normalized));
      }
      if (key !== 'hull') {
        // Relative to the group's pivot (pitch: the trunnion; yaw: the axis at hull height 0).
        const m = mounts.find((q) => q.seat === +key.split(':')[0]!)!;
        const [ox, oy, oz] = key.endsWith(':pitch') ? m.pitchAt : [m.yawAt[0], 0, m.yawAt[1]];
        out.translate(-ox / scale, -oy / scale, -oz / scale);
      }
      out.computeBoundingSphere();
      const piece = { geometry: out, material: part.material };
      if (key === 'hull') hull.push(piece); else pieces.set(key, [...(pieces.get(key) ?? []), piece]);
    }
    if (g !== part.geometry) g.dispose();
  }
  return { hull, pieces };
}

const gunMetal = new MeshLambertMaterial({ color: 0x2b2d2a });
/** A generic heavy machine gun on a pintle: receiver, barrel to the muzzle, a small shield. */
function proceduralGun(length: number): Group {
  const g = new Group();
  const receiver = new Mesh(new BoxGeometry(.16, .18, .55), gunMetal); receiver.position.set(0, 0, -.05);
  const barrel = new Mesh(new CylinderGeometry(.025, .03, length, 8), gunMetal); barrel.rotation.x = Math.PI / 2; barrel.position.set(0, .02, -length / 2);
  const shield = new Mesh(new BoxGeometry(.6, .4, .03), gunMetal); shield.position.set(0, .05, -.38);
  const box = new Mesh(new BoxGeometry(.12, .14, .22), gunMetal); box.position.set(.15, -.04, 0);
  for (const m of [receiver, barrel, shield, box]) { m.castShadow = true; g.add(m); }
  return g;
}

/** Builds the mount groups under the vehicle body and fills them with their pieces. */
export function buildMountRigs(kind: VehicleKind, body: Group, pieces: Map<Bucket, ModelPart[]>, mesh: (part: { geometry: BufferGeometry; material: Material }) => Mesh): MountRig[] {
  const mounts = vehicleMounts(kind), scale = VEHICLES[kind].scale, rigs: MountRig[] = [];
  for (const m of [...mounts].sort((p, q) => (p.on !== undefined ? 1 : 0) - (q.on !== undefined ? 1 : 0))) {
    const parent = m.on !== undefined ? rigs.find((r) => r.seat === m.on) : undefined;
    const base = parent ? mounts.find((q) => q.seat === m.on)!.yawAt : [0, 0] as const;
    const yaw = new Group(), pitch = new Group();
    yaw.position.set((m.yawAt[0] - base[0]) / scale, 0, (m.yawAt[1] - base[1]) / scale);
    pitch.position.set((m.pitchAt[0] - m.yawAt[0]) / scale, m.pitchAt[1] / scale, (m.pitchAt[2] - m.yawAt[1]) / scale);
    yaw.add(pitch);
    (parent?.yaw ?? body).add(yaw);
    for (const p of pieces.get(`${m.seat}:yaw`) ?? []) yaw.add(mesh(p));
    for (const p of pieces.get(`${m.seat}:pitch`) ?? []) pitch.add(mesh(p));
    if (m.procedural) {
      const muzzle = VEHICLE_ROLES[kind].weapons.find((w) => w.seat === m.seat)?.mounts[0];
      pitch.add(proceduralGun(muzzle ? Math.max(.6, m.pitchAt[2] - muzzle[2]) / scale : 1));
    }
    rigs.push({ seat: m.seat, parent: m.on, yaw, pitch, shownYaw: 0, shownPitch: 0 });
  }
  return rigs;
}

/** Eases the drawn mounts to the vehicle's aim (sent 15–30 times a second). */
export function poseMountRigs(rigs: readonly MountRig[], v: VehicleState, dt: number): void {
  const k = 1 - Math.exp(-dt * 14);
  for (const r of rigs) {
    const [yaw, pitch] = seatAim(v, r.seat);
    r.shownYaw += Math.atan2(Math.sin(yaw - r.shownYaw), Math.cos(yaw - r.shownYaw)) * k;
    r.shownPitch += (pitch - r.shownPitch) * k;
  }
  const seats = seatCount(v.kind);
  for (const r of rigs) {
    // A weapon seat removed in the Studio takes its gun off the vehicle too.
    r.yaw.visible = r.seat < seats;
    const parent = r.parent !== undefined ? rigs.find((p) => p.seat === r.parent) : undefined;
    r.yaw.rotation.y = r.shownYaw - (parent?.shownYaw ?? 0);
    r.pitch.rotation.x = r.shownPitch;
  }
}
