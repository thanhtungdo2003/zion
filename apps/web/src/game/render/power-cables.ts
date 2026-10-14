import { BufferGeometry, Float32BufferAttribute, LineBasicMaterial, LineSegments, type Scene } from 'three';

/** Overhead conductors between pylons, drooping in a shallow catenary between each pair. */
export class PowerCables {
  private readonly lines: LineSegments;
  constructor(private readonly scene: Scene, cables: ReadonlyArray<{ kind: 'tower' | 'hframe'; points: ReadonlyArray<readonly [number, number, number]> }>) {
    const positions: number[] = [];
    for (const cable of cables) for (let i = 1; i < cable.points.length; i++) {
      const [ax, ay, az] = cable.points[i - 1]!, [bx, by, bz] = cable.points[i]!;
      const span = Math.hypot(bx - ax, bz - az), sag = span * (cable.kind === 'tower' ? .035 : .025), steps = 10;
      for (let k = 0; k < steps; k++) for (const t of [k / steps, (k + 1) / steps]) {
        positions.push(ax + (bx - ax) * t, ay + (by - ay) * t - sag * 4 * t * (1 - t), az + (bz - az) * t);
      }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    this.lines = new LineSegments(geometry, new LineBasicMaterial({ color: 0x1d1f1f }));
    this.lines.frustumCulled = false;
    scene.add(this.lines);
  }
  dispose(): void { this.scene.remove(this.lines); this.lines.geometry.dispose(); (this.lines.material as LineBasicMaterial).dispose(); }
}
