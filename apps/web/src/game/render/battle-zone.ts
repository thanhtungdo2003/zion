import { CylinderGeometry, DoubleSide, Mesh, MeshBasicMaterial, type Scene } from 'three';
import type { BattleState } from '@zion/shared';

/** The red wall marks the current safe-area boundary without hiding opponents behind it. */
export class BattleZone {
  private readonly geometry = new CylinderGeometry(1, 1, 240, 160, 1, true);
  private readonly material = new MeshBasicMaterial({ color: 0xff202e, transparent: true, opacity: .2, side: DoubleSide, depthWrite: false });
  private readonly wall = new Mesh(this.geometry, this.material);
  constructor(private readonly scene: Scene) { this.wall.visible = false; this.wall.frustumCulled = false; scene.add(this.wall); }
  update(state: BattleState): void {
    this.wall.visible = state.phase === 'running';
    this.wall.position.set(state.circle.x, 100, state.circle.z);
    this.wall.scale.set(Math.max(.01, state.circle.radius), 1, Math.max(.01, state.circle.radius));
  }
  dispose(): void { this.scene.remove(this.wall); this.geometry.dispose(); this.material.dispose(); }
}
