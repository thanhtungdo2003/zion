import { AmbientLight, DirectionalLight, PerspectiveCamera, Scene, SRGBColorSpace, WebGLRenderer } from 'three';
import { ARMOR_SLOTS, EntityFlags, NO_ARMOR, type Appearance, type ArmorLoadout, type Attachments, type CarriedGear } from '@zion/shared';
import type { Stance } from '../inventory/items';
import type { WeaponLibrary } from './weapons';
import { Avatar } from './avatars';
import type { CharacterTemplate } from './character-model';
import { requestArmor } from './armor-models';

/**
 * The inventory's character viewer: the player's own model standing still, facing the viewer at a
 * slight angle, dressed as equipped: armour, the backpack, the weapon in hand (relaxed hold) and
 * the guns, pistol and grenade it carries. Renders only while mounted in the panel.
 */
export class CharacterPreview {
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(30, 1, 0.1, 20);
  private readonly avatar: Avatar;
  private raf = 0;
  /** Yaw 0 faces −Z; the camera is on +Z. Turned a little for a three-quarter view. */
  private readonly yaw = Math.PI - 0.32;
  private loadout: ArmorLoadout = { ...NO_ARMOR };
  private disposed = false;
  private unmount: (() => void) | null = null;

  constructor(template: CharacterTemplate) {
    this.avatar = new Avatar(template, true);
    // A still display: the body faces its yaw at once (no turning on the spot, no stepping).
    this.avatar.rigid = true;
    this.avatar.addTo(this.scene);
    this.scene.add(new AmbientLight(0xffffff, 1.3));
    const key = new DirectionalLight(0xffffff, 2.2);
    key.position.set(1.5, 3, 3);
    this.scene.add(key);
    const rim = new DirectionalLight(0xbfd4ff, 1.2);
    rim.position.set(-2, 2, -3);
    this.scene.add(rim);
    this.camera.position.set(0, 1.18, 5.4);
    this.camera.lookAt(0, 1.08, 0);
  }

  /** The player's own look. */
  setAppearance(look: Appearance): void {
    if (!this.disposed) this.avatar.setAppearance(look);
  }

  /** What is in hand and what is carried (the model holds and wears it). */
  setEquipment(itemId: string | null, stance: Stance, gear: CarriedGear, weapons: WeaponLibrary | null, attachments?: Attachments): void {
    if (this.disposed) return;
    this.avatar.setStance(stance);
    this.avatar.setWeapon(itemId, weapons, attachments);
    // A held gun in the relaxed lobby hold; empty hands stand plainly.
    this.avatar.setMocapIdle(itemId && (stance === 'rifle' || stance === 'pistol') ? 'rifle_idle' : null);
    this.avatar.setGear(gear, weapons);
  }

  /** Shows these armour pieces (wire ids per slot). */
  setArmor(loadout: ArmorLoadout): void {
    if (this.disposed) return;
    this.loadout = { ...loadout };
    for (const slot of ARMOR_SLOTS) {
      const id = loadout[slot];
      if (!id) {
        this.avatar.setArmor(slot, null);
        continue;
      }
      const t = requestArmor(id, () => {
        if (this.loadout[slot] === id) this.setArmor(this.loadout);
      });
      if (t !== undefined) this.avatar.setArmor(slot, t);
    }
  }

  /** Starts rendering into `host` (drag to turn); returns the unmount function. */
  mount(host: HTMLElement): () => void {
    if (this.disposed) return () => {};
    this.unmount?.();
    const renderer = new WebGLRenderer({ antialias: true, alpha: true });
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    host.appendChild(renderer.domElement);
    const fit = () => {
      const w = host.clientWidth || 1;
      const h = host.clientHeight || 1;
      renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(fit);
    ro.observe(host);
    fit();
    const el = renderer.domElement;
    let last = performance.now();
    const frame = (now: number) => {
      this.raf = requestAnimationFrame(frame);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      this.avatar.update(0, 0, 0, this.yaw, EntityFlags.Grounded, dt, now / 1000);
      renderer.render(this.scene, this.camera);
    };
    this.raf = requestAnimationFrame(frame);
    let mounted = true;
    const unmount = () => {
      if (!mounted) return;
      mounted = false;
      cancelAnimationFrame(this.raf);
      ro.disconnect();
      renderer.dispose();
      renderer.forceContextLoss();
      el.remove();
    };
    this.unmount = unmount;
    return unmount;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unmount?.();
    this.unmount = null;
    this.avatar.dispose(this.scene);
    this.scene.clear();
  }
}
