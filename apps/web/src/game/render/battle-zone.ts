import { CylinderGeometry, DoubleSide, Mesh, MeshBasicMaterial, type Scene } from 'three';
import type { BattleState } from '@zion/shared';

/**
 * The red wall marks the current safe-area boundary without hiding opponents behind it; before
 * the drop a small, brighter ring fences the lobby everyone waits in.
 */
export class BattleZone {
  private readonly geometry = new CylinderGeometry(1, 1, 240, 160, 1, true);
  private readonly material = new MeshBasicMaterial({ color: 0xff202e, transparent: true, opacity: .2, side: DoubleSide, depthWrite: false });
  private readonly wall = new Mesh(this.geometry, this.material);
  private readonly lobbyMaterial = new MeshBasicMaterial({ color: 0xff2a36, transparent: true, opacity: .38, side: DoubleSide, depthWrite: false });
  private readonly lobby = new Mesh(this.geometry, this.lobbyMaterial);
  constructor(private readonly scene: Scene) {
    for (const m of [this.wall, this.lobby]) { m.visible = false; m.frustumCulled = false; scene.add(m); }
  }
  update(state: BattleState): void {
    const ring = (state.phase === 'waiting' || state.phase === 'countdown') ? state.lobby : undefined;
    this.lobby.visible = !!ring;
    if (ring) { this.lobby.position.set(ring.x, 100, ring.z); this.lobby.scale.set(ring.radius, 1, ring.radius); }
    this.wall.visible = state.phase === 'running';
    this.wall.position.set(state.circle.x, 100, state.circle.z);
    this.wall.scale.set(Math.max(.01, state.circle.radius), 1, Math.max(.01, state.circle.radius));
  }
  dispose(): void { this.scene.remove(this.wall, this.lobby); this.geometry.dispose(); this.material.dispose(); this.lobbyMaterial.dispose(); }
}
