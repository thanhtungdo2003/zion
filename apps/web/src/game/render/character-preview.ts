import { AmbientLight, DirectionalLight, PerspectiveCamera, Scene, SRGBColorSpace, WebGLRenderer } from 'three';
import { ARMOR_SLOTS, EntityFlags, type ArmorLoadout } from '@zion/shared';
import { Avatar } from './avatars';
import type { CharacterTemplate } from './character-model';
import { requestArmor } from './armor-models';

/**
 * The inventory's character viewer: the player's own model, slowly turning, wearing the armour
 * equipped in the four armour slots. Renders only while mounted in the panel.
 */
export class CharacterPreview {
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(30, 1, 0.1, 20);
  private readonly avatar: Avatar;
  private raf = 0;
  private yaw = Math.PI - 0.5;
  private dragX: number | null = null;
  private loadout: ArmorLoadout = { head: 0, chest: 0, legs: 0, feet: 0 };

  constructor(template: CharacterTemplate) {
    this.avatar = new Avatar(template, true);
    this.avatar.addTo(this.scene);
    this.scene.add(new AmbientLight(0xffffff, 1.3));
    const key = new DirectionalLight(0xffffff, 2.2);
    key.position.set(1.5, 3, 3);
    this.scene.add(key);
    const rim = new DirectionalLight(0xbfd4ff, 1.2);
    rim.position.set(-2, 2, -3);
    this.scene.add(rim);
    this.camera.position.set(0, 1.05, 4.6);
    this.camera.lookAt(0, 0.95, 0);
  }

  /** Shows these armour pieces (wire ids per slot). */
  setArmor(loadout: ArmorLoadout): void {
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
    const down = (e: PointerEvent) => {
      this.dragX = e.clientX;
      el.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (this.dragX === null) return;
      this.yaw += (e.clientX - this.dragX) * 0.012;
      this.dragX = e.clientX;
    };
    const up = () => {
      this.dragX = null;
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    let last = performance.now();
    const frame = (now: number) => {
      this.raf = requestAnimationFrame(frame);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (this.dragX === null) this.yaw += dt * 0.35;
      this.avatar.update(0, 0, 0, this.yaw, EntityFlags.Grounded, dt, now / 1000);
      renderer.render(this.scene, this.camera);
    };
    this.raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(this.raf);
      ro.disconnect();
      renderer.dispose();
      el.remove();
    };
  }
}
