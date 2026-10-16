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
    // A line is always one pixel wide, so a far cable looks as thick as a near one: fade it with
    // distance instead (thin and faint far off, gone before the poles stop being drawn).
    const material = new LineBasicMaterial({ color: 0x1d1f1f, transparent: true, depthWrite: false });
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying float vCableDistance;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvCableDistance = length(mvPosition.xyz);');
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vCableDistance;')
        .replace('#include <opaque_fragment>', 'diffuseColor.a *= .95 * (1.0 - smoothstep(25.0, 380.0, vCableDistance));\n#include <opaque_fragment>');
    };
    material.customProgramCacheKey = () => 'power-cable-fade';
    this.lines = new LineSegments(geometry, material);
    this.lines.frustumCulled = false;
    scene.add(this.lines);
  }
  dispose(): void { this.scene.remove(this.lines); this.lines.geometry.dispose(); (this.lines.material as LineBasicMaterial).dispose(); }
}
