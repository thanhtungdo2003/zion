import { BoxGeometry, BufferGeometry, Float32BufferAttribute, Group, Line, LineBasicMaterial, Mesh, MeshLambertMaterial, DoubleSide, type Scene } from 'three';
import { EntityFlags, type BattlePlane, type DoorStateEvent } from '@zion/shared';
import { BB_UNITS_PER_METER, loadCharacterModel, sampleTrack, type CharacterTemplate } from './character-model';
import { ResourceDisposer } from './resources';

interface DoorVisual { root: Group; state: DoorStateEvent; time: number }
/** Authored bone animation is retained instead of flattening these models into instances. */
export class BattleFlightRenderer {
  private doorTemplate: CharacterTemplate | null = null;
  private planeTemplate: CharacterTemplate | null = null;
  private readonly doors = new Map<number, DoorVisual>();
  private readonly canopies = new Map<number, { root: Group; age: number }>();
  private plane: Group | null = null;
  private disposed = false;
  private readonly vec: [number, number, number] = [0, 0, 0];
  constructor(private readonly scene: Scene) {}
  async load(): Promise<void> {
    const templates = await Promise.all([loadCharacterModel('/models/dists/wooden-door.bbmodel'), loadCharacterModel('/models/dists/heavy-transport-plane.bbmodel')]);
    [this.doorTemplate, this.planeTemplate] = templates;
    if (this.disposed) { this.dispose(); return; }
    this.plane = this.planeTemplate.root.clone(true); this.plane.scale.setScalar(BB_UNITS_PER_METER / 1.5); this.plane.visible = false; this.scene.add(this.plane);
  }
  door(state: DoorStateEvent): void {
    let visual = this.doors.get(state.id);
    if (!visual) {
      const root = new Group(); this.scene.add(root);
      visual = { root, state, time: .1 }; this.doors.set(state.id, visual);
    } else if (visual.state.open !== state.open) visual.time = 0;
    visual.state = state;
    visual.root.position.set(state.x, state.y, state.z); visual.root.rotation.y = state.yaw;
  }
  update(dt: number, elapsed: number, x: number, z: number, plane: BattlePlane | undefined): void {
    for (const visual of this.doors.values()) {
      const d = visual.state;
      visual.root.visible = Math.hypot(d.x - x, d.z - z) < 180;
      if (!visual.root.visible || !this.doorTemplate) continue;
      if (!visual.root.children.length) { const model = this.doorTemplate.root.clone(true); model.scale.setScalar(BB_UNITS_PER_METER / 16); visual.root.add(model); }
      visual.time = Math.min(.1, visual.time + dt);
      this.animate(visual.root, this.doorTemplate, d.open ? 'open' : 'close', visual.time);
    }
    if (this.plane) {
      this.plane.visible = !!plane;
      if (plane) { this.plane.position.set(plane.x, plane.y - 19 / 1.5, plane.z); this.plane.rotation.y = plane.yaw; if (this.planeTemplate) this.animate(this.plane, this.planeTemplate, 'propellers_spin', elapsed % .2); }
    }
  }
  player(id: number, x: number, y: number, z: number, yaw: number, flags: number, dt: number): void {
    let canopy = this.canopies.get(id);
    if (!(flags & EntityFlags.Parachute)) { if (canopy) { this.scene.remove(canopy.root); this.release(canopy.root); this.canopies.delete(id); } return; }
    if (!canopy) { canopy = { root: this.makeCanopy(), age: 0 }; this.canopies.set(id, canopy); this.scene.add(canopy.root); }
    canopy.age += dt;
    const t = Math.min(1, canopy.age / .9), open = 1 - Math.pow(1 - t, 3);
    canopy.root.position.set(x, y, z); canopy.root.rotation.y = yaw;
    canopy.root.scale.set(Math.max(.04, open), .4 + open * .6, Math.max(.04, open));
  }
  retainPlayers(ids: Set<number>): void { for (const [id, c] of this.canopies) if (!ids.has(id)) { this.scene.remove(c.root); this.release(c.root); this.canopies.delete(id); } }
  private animate(root: Group, template: CharacterTemplate, name: string, time: number): void {
    for (const [bone, tracks] of template.clips.get(name)?.bones ?? []) {
      const node = root.getObjectByName(bone); if (!node || !tracks.rotation) continue;
      sampleTrack(tracks.rotation, time, this.vec); node.rotation.set(this.vec[0] * Math.PI / 180, this.vec[1] * Math.PI / 180, this.vec[2] * Math.PI / 180);
    }
  }
  private makeCanopy(): Group {
    const root = new Group(), panels = 12;
    for (let i = 0; i < panels; i++) {
      const x = (i - (panels - 1) / 2) * .52;
      const mesh = new Mesh(new BoxGeometry(.54, .22, 2.5), new MeshLambertMaterial({ color: i % 3 ? '#d8e4e6' : '#db293e', side: DoubleSide }));
      mesh.position.set(x, 4.8 - Math.pow(x / 3.3, 2) * .8, 0); mesh.rotation.z = -x * .11; root.add(mesh);
      for (const z of [-.9, .9]) {
        const g = new BufferGeometry(); g.setAttribute('position', new Float32BufferAttribute([x, mesh.position.y, z, Math.sign(x) * .35, 1.3, z * .2], 3));
        root.add(new Line(g, new LineBasicMaterial({ color: '#d5d0ba' })));
      }
    }
    return root;
  }
  private release(root: Group): void { new ResourceDisposer().object(root); }
  dispose(): void {
    this.disposed = true;
    for (const d of this.doors.values()) this.scene.remove(d.root); this.doors.clear();
    for (const c of this.canopies.values()) { this.scene.remove(c.root); this.release(c.root); } this.canopies.clear();
    if (this.plane) this.scene.remove(this.plane);
    if (this.doorTemplate) this.release(this.doorTemplate.root);
    if (this.planeTemplate) this.release(this.planeTemplate.root);
    this.doorTemplate = this.planeTemplate = null;
  }
}
