import { BufferAttribute, BufferGeometry } from 'three';
import { VEHICLES, VEHICLE_ROLES, wheelCentre, type VehicleKind } from '@zion/shared';
import type { ModelPart } from './bbmodel-loader';

/**
 * Wheels for models prepared as one mesh (the APC): each wheel's triangles are found round where
 * the physics puts it, its true hub taken from their own bounds, and cut out as a wheel part that
 * the renderer spins and moves with the suspension like any car's. Models that already carry their
 * wheels, tracked hulls and aircraft are returned as they are.
 */
const cuts = new WeakMap<readonly ModelPart[], readonly ModelPart[]>();

export function cutWheels(kind: VehicleKind, parts: readonly ModelPart[]): readonly ModelPart[] {
  const cls = VEHICLE_ROLES[kind].cls;
  if (cls === 'tank' || cls === 'heli' || parts.some((p) => p.wheel !== undefined)) return parts;
  const known = cuts.get(parts);
  if (known) return known;
  const def = VEHICLES[kind], scale = def.scale, r = def.wheelRadius / scale;
  const geos = parts.map((p) => (p.geometry.index ? p.geometry.toNonIndexed() : p.geometry));
  // 1. The wheel's real hub: the bounds of the low triangles near where the physics has it.
  const hubs = [0, 1, 2, 3].map((i) => {
    const c = wheelCentre(kind, i), cx = c.x / scale, cz = c.z / scale;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity, n = 0;
    for (const g of geos) {
      const pos = g.getAttribute('position');
      for (let k = 0; k < pos.count; k++) {
        const x = pos.getX(k), y = pos.getY(k), z = pos.getZ(k);
        if (Math.sign(x) !== Math.sign(cx) || Math.abs(Math.abs(x) - Math.abs(cx)) > .45 || y > r * 2.15 || Math.abs(z - cz) > r * 1.5) continue;
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); z0 = Math.min(z0, z); z1 = Math.max(z1, z); n++;
      }
    }
    if (n < 12) return null;
    const radius = Math.max((y1 - y0) / 2, (z1 - z0) / 2);
    return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: (z0 + z1) / 2, radius, halfWidth: (x1 - x0) / 2 + .02 };
  });
  if (hubs.some((h) => !h)) { cuts.set(parts, parts); return parts; }
  // 2. Triangles inside each wheel's cylinder become that wheel.
  const out: ModelPart[] = [];
  parts.forEach((part, pi) => {
    const g = geos[pi]!, pos = g.getAttribute('position'), own: number[][] = [[], [], [], []], body: number[] = [];
    for (let k = 0; k + 2 < pos.count; k += 3) {
      const w = hubs.findIndex((h) => [0, 1, 2].every((c) => Math.abs(pos.getX(k + c) - h!.x) <= h!.halfWidth && Math.hypot(pos.getY(k + c) - h!.y, pos.getZ(k + c) - h!.z) <= h!.radius + .02));
      (w >= 0 ? own[w]! : body).push(k);
    }
    const take = (tris: number[], ox = 0, oy = 0, oz = 0) => {
      const geo = new BufferGeometry();
      for (const name of Object.keys(g.attributes)) {
        const src = g.getAttribute(name), size = src.itemSize, data = new Float32Array(tris.length * 3 * size);
        tris.forEach((t, j) => { for (let c = 0; c < 3; c++) for (let s = 0; s < size; s++) data[(j * 3 + c) * size + s] = src.getComponent(t + c, s); });
        geo.setAttribute(name, new BufferAttribute(data, size, src.normalized));
      }
      geo.translate(-ox, -oy, -oz);
      geo.computeBoundingSphere();
      return geo;
    };
    if (own.every((t) => !t.length)) { out.push(part); return; }
    if (body.length) out.push({ geometry: take(body), material: part.material });
    own.forEach((tris, i) => {
      const h = hubs[i]!;
      if (tris.length) out.push({ geometry: take(tris, h.x, h.y, h.z), material: part.material, wheel: i, wheelCenter: [h.x, h.y, h.z] });
    });
  });
  cuts.set(parts, out);
  return out;
}
