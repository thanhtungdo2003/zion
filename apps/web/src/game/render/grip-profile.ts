import { Matrix4, Mesh, Quaternion, Ray, Vector3, type Object3D } from 'three';
import type { Grasp } from './human-rig';

const cache = new WeakMap<Object3D, Map<string, NonNullable<Grasp['profile']>>>();
const stocks = new WeakMap<Object3D, { key: string; point: Vector3 | null }>();

/** Top of the stock, behind the firing grip, measured in the same scaled local frame as grips.
 * A ray misses pistols/open folding stocks; those keep their recorded pose without a fake stock. */
export function rifleStockContact(object: Object3D, grip: Vector3, barrel: Vector3, up: Vector3, side: number): Vector3 | null {
  object.updateWorldMatrix(true, true);
  const scale = new Vector3().setFromMatrixScale(object.matrixWorld);
  const key = `${scale.toArray().map((n) => n.toFixed(4))}:${side}:${grip.toArray()}:${barrel.toArray()}:${up.toArray()}`;
  const old = stocks.get(object);
  if (old?.key === key) return old.point?.clone() ?? null;
  const rootInv = object.matrixWorld.clone().invert();
  const right = new Vector3().crossVectors(barrel, up).normalize();
  const origin = grip.clone().addScaledVector(barrel, -.11).addScaledVector(up, .25);
  const ray = new Ray(origin, up.clone().negate()), hit = new Vector3();
  let closest = Infinity, point: Vector3 | null = null;
  object.traverse((node) => {
    if (!(node instanceof Mesh) || !node.visible) return;
    const matrix = new Matrix4().makeScale(scale.x, scale.y, scale.z).multiply(rootInv).multiply(node.matrixWorld);
    const index = node.geometry.index, count = index?.count ?? node.geometry.getAttribute('position').count;
    for (let i = 0; i < count; i += 3) {
      const t = [0, 1, 2].map((c) => node.getVertexPosition(index?.getX(i + c) ?? i + c, new Vector3()).applyMatrix4(matrix));
      if (!ray.intersectTriangle(t[0]!, t[1]!, t[2]!, false, hit)) continue;
      const d = hit.distanceTo(origin);
      if (d < closest && d < .32) { closest = d; point = hit.clone(); }
    }
  });
  if (point) (point as Vector3).addScaledVector(right, -.022 * side).addScaledVector(up, .008);
  stocks.set(object, { key, point });
  return point ? (point as Vector3).clone() : null;
}

/** Measure handle cross-sections from real triangles, rather than wrapping every gun around
 * the same imaginary cylinder. The profile is rigid in the grip frame and cached per weapon. */
export function fitGripProfile(object: Object3D, grasp: Grasp): Grasp {
  object.updateWorldMatrix(true, true);
  const position = new Vector3(), rotation = new Quaternion(), scale = new Vector3();
  object.matrixWorld.decompose(position, rotation, scale);
  const inv = rotation.clone().invert();
  const center = grasp.center.clone().sub(position).applyQuaternion(inv);
  const axis = grasp.axis.clone().applyQuaternion(inv).normalize();
  const normal = grasp.approach.clone().applyQuaternion(inv).addScaledVector(axis, -grasp.approach.clone().applyQuaternion(inv).dot(axis)).normalize();
  const tangent = new Vector3().crossVectors(axis, normal).normalize();
  const key = [...center.toArray(), ...axis.toArray(), ...normal.toArray(), ...scale.toArray(), grasp.radius].map((n) => (Math.round(n * 1000) / 1000).toFixed(3)).join(',');
  let profiles = cache.get(object);
  if (!profiles) { profiles = new Map(); cache.set(object, profiles); }
  let profile = profiles.get(key);
  if (!profile) {
    const triangles: Vector3[][] = [], rootInv = object.matrixWorld.clone().invert();
    object.traverse((node) => {
      if (!(node instanceof Mesh) || !node.visible) return;
      const matrix = new Matrix4().makeScale(scale.x, scale.y, scale.z).multiply(rootInv).multiply(node.matrixWorld);
      const count = node.geometry.index?.count ?? node.geometry.getAttribute('position').count;
      for (let i = 0; i < count; i += 3) {
        const triangle = [0, 1, 2].map((c) => node.getVertexPosition(node.geometry.index?.getX(i + c) ?? i + c, new Vector3()).applyMatrix4(matrix));
        // Only surfaces close enough to be part of this handle can contact these fingers.
        if (triangle.some((p) => p.distanceTo(center) < .16)) triangles.push(triangle);
      }
    });
    const hit = new Vector3(), ray = new Ray();
    const rings = [-.04, -.02, 0, .02, .04].map((offset) => {
      const origin = center.clone().addScaledVector(axis, offset);
      const radii = Array.from({ length: 16 }, (_, i) => {
        const angle = i * Math.PI * 2 / 16;
        ray.set(origin, normal.clone().multiplyScalar(Math.cos(angle)).addScaledVector(tangent, Math.sin(angle)));
        let radius = Infinity;
        for (const t of triangles) if (ray.intersectTriangle(t[0]!, t[1]!, t[2]!, false, hit)) {
          const d = hit.distanceTo(origin);
          if (d > .004 && d < .065) radius = Math.min(radius, d);
        }
        return Number.isFinite(radius) ? radius : grasp.radius;
      });
      return { offset, radii };
    });
    profile = { key: rings.flatMap((r) => r.radii).map((n) => n.toFixed(3)).join(','), rings };
    // Bound the cache during unusual animated grip changes (reloads do not use this fitter).
    if (profiles.size >= 32) profiles.clear();
    profiles.set(key, profile);
  }
  // The palm sits on the side opposite its inward normal. Use the measured surface there
  // for wrist placement too, so changing the handle thickness also changes the palm contact.
  return { ...grasp, radius: profile.rings[2]!.radii[8]!, profile };
}
