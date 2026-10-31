import { BoxGeometry, Group, Mesh, MeshStandardMaterial, type Scene } from 'three';
import { chunkKey, type ChunkData, type DoorStateEvent } from '@zion/shared';
import { chunkStudioDoors, studioDoorColliders, studioDoorOwner, type AssetRegistry, type StudioDoor } from '@zion/assets';
import type { CollisionWorld } from '@zion/physics';

interface Door { door: StudioDoor; open: boolean; angle: number; root: Group; chunk: number }

/**
 * The doors of Model Studio houses on the client: a leaf per door, hinged where the house was
 * built, swinging open and shut as the server says (closed until it says otherwise), colliding
 * as it stands. Built and dropped with the chunks the houses stand on.
 */
export class StudioDoorRenderer {
  private readonly doors = new Map<number, Door>();
  private readonly byChunk = new Map<number, number[]>();
  /** What the server said of each door (it may arrive before the chunk). */
  private readonly states = new Map<number, boolean>();
  private readonly leaf = new BoxGeometry(1, 1, 1);
  private readonly handle = new BoxGeometry(.06, .03, .1);
  private readonly materials = new Map<string, MeshStandardMaterial>();
  private readonly metal = new MeshStandardMaterial({ color: 0x8a8d90, metalness: .8, roughness: .35 });

  constructor(private readonly scene: Scene, private readonly registry: AssetRegistry, private readonly collision: () => CollisionWorld | undefined) {}

  addChunk(chunk: ChunkData): void {
    this.removeChunk(chunk);
    const key = chunkKey(chunk.cx, chunk.cz), ids: number[] = [];
    for (const door of chunkStudioDoors(chunk, this.registry)) {
      if (this.doors.has(door.id)) continue;
      const open = this.states.get(door.id) ?? false, root = new Group();
      root.position.set(door.x, door.y, door.z);
      const color = door.color ?? '#7a5634';
      let mat = this.materials.get(color);
      if (!mat) this.materials.set(color, mat = new MeshStandardMaterial({ color, roughness: .75 }));
      const leaf = new Mesh(this.leaf, mat);
      leaf.scale.set(door.w, door.h, .04); leaf.position.set(door.w / 2, door.h / 2, 0);
      leaf.castShadow = leaf.receiveShadow = true;
      const handle = new Mesh(this.handle, this.metal);
      handle.position.set(door.w - .09, door.h * .47, 0);
      root.add(leaf, handle);
      const d: Door = { door, open, angle: open ? Math.PI / 2 : 0, root, chunk: key };
      root.rotation.y = door.yaw + d.angle;
      this.scene.add(root);
      this.doors.set(door.id, d); ids.push(door.id);
      this.collision()?.setOwnerColliders(studioDoorOwner(door.id), studioDoorColliders(door, open));
    }
    if (ids.length) this.byChunk.set(key, ids);
  }

  removeChunk(chunk: { cx: number; cz: number }): void {
    const key = chunkKey(chunk.cx, chunk.cz), ids = this.byChunk.get(key);
    if (!ids) return;
    for (const id of ids) {
      const d = this.doors.get(id);
      if (!d) continue;
      this.scene.remove(d.root);
      this.collision()?.removeOwnerColliders(studioDoorOwner(id));
      this.doors.delete(id);
    }
    this.byChunk.delete(key);
  }

  /** The server's word on a door; true when it changed (for the sound). */
  setState(m: DoorStateEvent): boolean {
    const was = this.states.get(m.id) ?? false;
    this.states.set(m.id, m.open);
    const d = this.doors.get(m.id);
    if (d && d.open !== m.open) {
      d.open = m.open;
      this.collision()?.setOwnerColliders(studioDoorOwner(m.id), studioDoorColliders(d.door, m.open));
    }
    return was !== m.open;
  }

  /** Leaves swing towards where they should be (a quarter turn in about half a second). */
  update(dt: number): void {
    for (const d of this.doors.values()) {
      const target = d.open ? Math.PI / 2 : 0;
      if (d.angle === target) continue;
      const step = dt * 3.4;
      d.angle = Math.abs(target - d.angle) <= step ? target : d.angle + Math.sign(target - d.angle) * step;
      d.root.rotation.y = d.door.yaw + d.angle;
    }
  }

  /** Doors within reach of a point: their middle (closed), whether open. */
  near(x: number, y: number, z: number, reach: number): Array<{ id: number; x: number; y: number; z: number; open: boolean }> {
    const out: Array<{ id: number; x: number; y: number; z: number; open: boolean }> = [];
    for (const [id, d] of this.doors) {
      const { door } = d, mx = door.x + Math.cos(door.yaw) * door.w / 2, mz = door.z - Math.sin(door.yaw) * door.w / 2;
      if (Math.abs(door.y - y) >= 2 || Math.hypot(mx - x, mz - z) > reach) continue;
      out.push({ id, x: mx, y: door.y, z: mz, open: d.open });
    }
    return out;
  }

  dispose(): void {
    for (const d of this.doors.values()) { this.scene.remove(d.root); this.collision()?.removeOwnerColliders(studioDoorOwner(d.door.id)); }
    this.doors.clear(); this.byChunk.clear();
    this.leaf.dispose(); this.handle.dispose(); this.metal.dispose();
    for (const m of this.materials.values()) m.dispose();
  }
}
