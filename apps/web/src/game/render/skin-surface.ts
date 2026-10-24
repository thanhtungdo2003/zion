import { Triangle, Vector3, type BufferGeometry } from 'three';

/** Rest-space triangle lookup for garment binding and skin coverage. Vertex proximity alone
 * misses the interior of large cloth triangles and exposes freckles of skin after bending. */
export class SkinSurface {
  private readonly cells = new Map<string, number[]>();
  private readonly triangle = new Triangle();
  private readonly closest = new Vector3();
  private readonly barycentric = new Vector3();
  private readonly cell = .04;
  constructor(private readonly geometry: BufferGeometry) {
    const positions = geometry.getAttribute('position'), index = geometry.getIndex()!;
    for (let t = 0; t < index.count; t += 3) {
      const ids = [index.getX(t), index.getX(t + 1), index.getX(t + 2)];
      const low = [0, 1, 2].map(axis => Math.floor(Math.min(...ids.map(i => positions.getComponent(i, axis))) / this.cell));
      const high = [0, 1, 2].map(axis => Math.floor(Math.max(...ids.map(i => positions.getComponent(i, axis))) / this.cell));
      for (let x = low[0]!; x <= high[0]!; x++) for (let y = low[1]!; y <= high[1]!; y++) for (let z = low[2]!; z <= high[2]!; z++) {
        const key = `${x},${y},${z}`, list = this.cells.get(key) ?? [];
        list.push(t); this.cells.set(key, list);
      }
    }
  }

  nearest(point: Vector3, distance: number, facing?: Vector3): { ids: number[]; weights: Vector3; point: Vector3; normal: Vector3 } | null {
    const positions = this.geometry.getAttribute('position'), normals = this.geometry.getAttribute('normal'), index = this.geometry.getIndex()!;
    const cell = point.clone().divideScalar(this.cell).floor(), radius = Math.ceil(distance / this.cell), visited = new Set<number>();
    let best = distance * distance, result: ReturnType<SkinSurface['nearest']> = null;
    for (let x = cell.x - radius; x <= cell.x + radius; x++) for (let y = cell.y - radius; y <= cell.y + radius; y++) for (let z = cell.z - radius; z <= cell.z + radius; z++) {
      for (const t of this.cells.get(`${x},${y},${z}`) ?? []) {
        if (visited.has(t)) continue; visited.add(t);
        const ids = [index.getX(t), index.getX(t + 1), index.getX(t + 2)];
        this.triangle.setFromAttributeAndIndices(positions, ids[0]!, ids[1]!, ids[2]!);
        this.triangle.closestPointToPoint(point, this.closest);
        const squared = point.distanceToSquared(this.closest); if (squared >= best) continue;
        if (!this.triangle.getBarycoord(this.closest, this.barycentric)) continue;
        const normal = new Vector3();
        ids.forEach((i, k) => normal.addScaledVector(new Vector3().fromBufferAttribute(normals, i), this.barycentric.getComponent(k)));
        normal.normalize(); if (facing && normal.dot(facing) < .2) continue;
        best = squared; result = { ids, weights: this.barycentric.clone(), point: this.closest.clone(), normal };
      }
    }
    return result;
  }
}

/** Closely fitted cloth inherits the body's deformation, with its authored surface offset kept. */
export function bindGarment(body: BufferGeometry, garment: BufferGeometry): void {
  const surface = new SkinSurface(body), positions = garment.getAttribute('position'), normals = garment.getAttribute('normal');
  const sourceJoints = body.getAttribute('skinIndex'), sourceWeights = body.getAttribute('skinWeight');
  const joints = garment.getAttribute('skinIndex'), weights = garment.getAttribute('skinWeight');
  const p = new Vector3(), n = new Vector3();
  for (let i = 0; i < positions.count; i++) {
    const hit = surface.nearest(p.fromBufferAttribute(positions, i), .045, n.fromBufferAttribute(normals, i).normalize());
    if (!hit) continue;
    const influences = new Map<number, number>();
    hit.ids.forEach((vertex, k) => {
      for (let channel = 0; channel < 4; channel++) {
        const joint = sourceJoints.getComponent(vertex, channel);
        influences.set(joint, (influences.get(joint) ?? 0) + sourceWeights.getComponent(vertex, channel) * hit.weights.getComponent(k));
      }
    });
    const selected = [...influences].sort((a, b) => b[1] - a[1]).slice(0, 4), total = selected.reduce((sum, entry) => sum + entry[1], 0);
    if (total < 1e-8) continue;
    for (let k = 0; k < 4; k++) { joints.setComponent(i, k, selected[k]?.[0] ?? 0); weights.setComponent(i, k, (selected[k]?.[1] ?? 0) / total); }
  }
  joints.needsUpdate = weights.needsUpdate = true;
}
