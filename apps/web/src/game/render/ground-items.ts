import { AdditiveBlending, BackSide, BoxGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, type Scene } from 'three';
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
 * Glow shell: the model's own surface pushed out along its normals and drawn from behind, so a
 * thin yellow rim hugs the silhouette (pulsing gently).
 */
function glowMaterial(): MeshBasicMaterial {
  const m = new MeshBasicMaterial({ color: 0xffc83a, side: BackSide, transparent: true, opacity: .85, depthWrite: false, blending: AdditiveBlending, fog: false });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uGlow = glowUniform;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
uniform float uGlow;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
transformed += normalize(normal) * (0.012 + uGlow * 0.006) / max(0.001, length(modelMatrix[0].xyz));`);
  };
  m.customProgramCacheKey = () => 'ground-glow';
  return m;
}
const glowUniform = { value: 0 };

const CRATE = new BoxGeometry(.32, .22, .24);
const CRATE_MATERIAL = new MeshStandardMaterial({ color: 0x5d6b3c, roughness: .8 });

/**
 * Items thrown out of the inventory: the item's real model lying on the ground with a yellow glow
 * hugging its outline, blinking during its last seconds, removed when the server's time for it is up
 * (battle royale loot: never).
 */
export class GroundItems {
  readonly items: GroundItem[] = [];
  private readonly glow = glowMaterial();

  constructor(private readonly scene: Scene, private readonly weapons: WeaponLibrary | null) {}

  /** `ttl`: ms until it vanishes (the server says); absent, it lies there until picked up. */
  add(id: number, itemId: string, count: number | undefined, x: number, y: number, z: number, now: number, ttl?: number): void {
    if (this.items.some((i) => i.id === id)) return;
    const object = new Group();
    const model = this.weapons?.get(itemId)?.display.clone(true);
    if (model) {
      // Display models point the muzzle along +X with the top up: lay it on its side.
      model.rotation.x = Math.PI / 2;
      model.position.y = 0.06;
      const shells: Array<[Mesh, Mesh]> = [];
      model.traverse((o) => {
        if (!(o instanceof Mesh)) return;
        o.castShadow = true;
        const shell = new Mesh(o.geometry, this.glow);
        shell.renderOrder = 4;
        shells.push([o, shell]);
      });
      for (const [o, shell] of shells) o.add(shell);
      object.add(model);
    } else {
      // No model for it (or the models are still loading): a small glowing crate, so it is seen.
      const crate = new Mesh(CRATE, CRATE_MATERIAL);
      crate.position.y = .11;
      crate.castShadow = true;
      crate.add(new Mesh(CRATE, this.glow));
      object.add(crate);
    }
    object.position.set(x, y, z);
    object.rotation.y = Math.random() * Math.PI * 2;
    this.scene.add(object);
    this.items.push({ id, itemId, count, x, y, z, expiresAt: ttl === undefined ? Infinity : now + ttl, object });
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
    glowUniform.value = .5 + Math.sin(now / 260) * .5;
    this.glow.opacity = .55 + glowUniform.value * .35;
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
    this.glow.dispose();
  }
}
