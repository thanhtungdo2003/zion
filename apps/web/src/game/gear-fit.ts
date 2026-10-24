import { DEFAULT_GEAR_FIT, gearFitSchema, type GearAdjust, type GearDrag, type GearFit, type SoftRegion } from '@zion/shared';
import { Euler, Matrix4, Quaternion, Vector3, type BufferGeometry } from 'three';
import { API_URL } from '@/lib/api';

/**
 * The Studio's gear fitting on this client: loaded once per page before characters are dressed,
 * and replaced live while the Studio edits it (avatars listening re-dress themselves).
 */
/** The shipped fitting until the server answers (or when it cannot). */
let fit: GearFit = DEFAULT_GEAR_FIT;
let loading: Promise<GearFit> | null = null;
const listeners = new Set<() => void>();

export function gearFit(): GearFit { return fit; }
export function adjustFor(key: string): GearAdjust | undefined { return fit.adjust[key]; }
export function softFor(key: string): SoftRegion[] { return fit.soft[key] ?? []; }
export function dragsFor(key: string, mesh: number): GearDrag[] { return (fit.drag[key] ?? []).filter((d) => d.mesh === mesh); }

/** Applies hand pulls to a geometry (owned by the caller): points near each pull move with it, softly. */
export function applyDrags(geometry: BufferGeometry, drags: readonly GearDrag[]): void {
  if (!drags.length) return;
  const pos = geometry.getAttribute('position');
  for (const d of drags) {
    for (let i = 0; i < pos.count; i++) {
      const dx = pos.getX(i) - d.p[0], dy = pos.getY(i) - d.p[1], dz = pos.getZ(i) - d.p[2], dist = Math.hypot(dx, dy, dz);
      if (dist >= d.r) continue;
      const t = 1 - dist / d.r, w = t * t * (3 - 2 * t);
      pos.setXYZ(i, pos.getX(i) + d.d[0] * w, pos.getY(i) + d.d[1] * w, pos.getZ(i) + d.d[2] * w);
    }
  }
  pos.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
}

export function loadGearFit(): Promise<GearFit> {
  if (typeof window === 'undefined') return Promise.resolve(fit);
  loading ??= fetch(`${API_URL}/api/gear-fit`, { credentials: 'include' })
    .then((res) => (res.ok ? res.json() as Promise<{ fit: unknown }> : { fit: DEFAULT_GEAR_FIT }))
    .then(({ fit: raw }) => { const p = gearFitSchema.safeParse(raw); if (p.success) fit = p.data; return fit; })
    .catch(() => fit);
  return loading;
}

/** The Studio's working copy: every listening avatar re-dresses with it. */
export function setGearFit(next: GearFit): void {
  fit = next;
  for (const f of listeners) f();
}
export function onGearFit(f: () => void): () => void { listeners.add(f); return () => listeners.delete(f); }

/**
 * An adjustment as a matrix in a frame `q` away from the character's (root) frame: offset along
 * the character's axes (+X right, +Y up, −Z forward), turned and scaled about `centre`.
 */
export function adjustMatrix(a: GearAdjust | undefined, centre: Vector3, q = new Quaternion()): Matrix4 {
  if (!a) return new Matrix4();
  const qi = q.clone().invert();
  const offset = new Vector3(...a.offset).applyQuaternion(qi);
  const turn = qi.clone().multiply(new Quaternion().setFromEuler(new Euler(...a.rotate.map((d) => d * Math.PI / 180) as [number, number, number]))).multiply(q);
  return new Matrix4().makeTranslation(centre.x + offset.x, centre.y + offset.y, centre.z + offset.z)
    .multiply(new Matrix4().makeRotationFromQuaternion(turn))
    .multiply(new Matrix4().makeScale(a.scale, a.scale, a.scale))
    .multiply(new Matrix4().makeTranslation(-centre.x, -centre.y, -centre.z));
}
