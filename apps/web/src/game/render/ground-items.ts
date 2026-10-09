import { Group, Mesh, MeshBasicMaterial, RingGeometry, type Scene } from 'three';
import type { WeaponLibrary } from './weapons';

/** Dropped items lie on the ground this long before they vanish. */
export const GROUND_ITEM_LIFETIME_MS = 60_000;
/** How close the player must be to pick one up. */
export const PICKUP_REACH = 1.8;

export interface GroundItem {
  id: number;
  itemId: string;
  count?: number;
  x: number;
  y: number;
  z: number;
  expiresAt: number;
  object: Group;
}

/**
 * Items thrown out of the inventory: the item's real model lying on the ground with a faint
 * ring, blinking during its last seconds, removed after a minute. Local to this client.
 */
export class GroundItems {
  readonly items: GroundItem[] = [];
  private readonly ringGeo = new RingGeometry(0.42, 0.5, 32);
  private readonly ringMat = new MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.55, depthWrite: false });

  constructor(private readonly scene: Scene, private readonly weapons: WeaponLibrary | null) {}

  add(id: number, itemId: string, count: number | undefined, x: number, y: number, z: number, now: number): void {
    if (this.items.some((i) => i.id === id)) return;
    const object = new Group();
    const model = this.weapons?.get(itemId)?.display.clone(true);
    if (model) {
      // Display models point the muzzle along +X with the top up: lay it on its side.
      model.rotation.x = Math.PI / 2;
      model.position.y = 0.06;
      model.traverse((o) => {
        if (o instanceof Mesh) o.castShadow = true;
      });
      object.add(model);
    }
    const ring = new Mesh(this.ringGeo, this.ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.03;
    ring.renderOrder = 4;
    object.add(ring);
    object.position.set(x, y, z);
    object.rotation.y = Math.random() * Math.PI * 2;
    this.scene.add(object);
    this.items.push({ id, itemId, count, x, y, z, expiresAt: now + GROUND_ITEM_LIFETIME_MS, object });
  }

  /** Nearest item within reach of (x, z), or null. */
  nearest(x: number, z: number): GroundItem | null {
    let best: GroundItem | null = null;
    let bd = PICKUP_REACH * PICKUP_REACH;
    for (const it of this.items) {
      const d = (it.x - x) ** 2 + (it.z - z) ** 2;
      if (d < bd) {
        bd = d;
        best = it;
      }
    }
    return best;
  }

  removeId(id: number): void {
    const it = this.items.find((i) => i.id === id);
    if (it) this.remove(it);
  }

  remove(item: GroundItem): void {
    const i = this.items.indexOf(item);
    if (i >= 0) this.items.splice(i, 1);
    this.scene.remove(item.object);
  }

  update(now: number): void {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i]!;
      const left = it.expiresAt - now;
      if (left <= -5000) {
        // Normally the server says when it's gone; this is just a safety net.
        this.remove(it);
        continue;
      }
      // Blink during the last 10 s as a warning.
      it.object.visible = left > 10_000 || Math.floor(left / 250) % 2 === 0;
    }
  }

  dispose(): void {
    for (const it of [...this.items]) this.remove(it);
    this.ringGeo.dispose();
    this.ringMat.dispose();
  }
}
