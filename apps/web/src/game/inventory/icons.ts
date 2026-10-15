import { AmbientLight, Box3, DirectionalLight, OrthographicCamera, Quaternion, Scene, SRGBColorSpace, Vector3, WebGLRenderer, type Object3D } from 'three';
import type { Attachments } from '@zion/shared';
import { dressWeapon, type WeaponLibrary } from '../render/weapons';
import { ITEMS } from './items';

/** itemId → PNG data URL of the real 3D model, rendered once while loading. */
export const itemIcons = new Map<string, string>();
const listeners = new Set<() => void>();
let version = 0;
export const itemIconVersion = () => version;
export const subscribeItemIcons = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

const PX_PER_CELL = 96;
/** Camera offset for the diagonal view: above, from the side the models face (their front). */
const ISO_DIR = new Vector3(-0.75, 0.9, -1).normalize().multiplyScalar(10);
const WEAPON_VIEW_DIR = new Vector3(.38, .28, 1).normalize().multiplyScalar(10);
const corner = new Vector3();
const inv = new Quaternion();

/** Shared lights/scene for icon renders. */
function iconScene(): Scene {
  const scene = new Scene();
  scene.add(new AmbientLight(0xffffff, 1.6));
  const key = new DirectionalLight(0xffffff, 2.2);
  key.position.set(0.4, 1, 1.2);
  scene.add(key);
  return scene;
}

function iconRenderer(): WebGLRenderer {
  const renderer = new WebGLRenderer({ canvas: document.createElement('canvas'), alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  return renderer;
}

const box = new Box3();
const size = new Vector3();
const center = new Vector3();

/** One model → PNG data URL sized to the item's footprint. */
function renderIcon(renderer: WebGLRenderer, scene: Scene, itemId: string, display: Object3D): string {
  // Non-items (the ZCoin) get a square icon.
  const def = ITEMS[itemId] ?? { w: 1, h: 1 };
  const model = display.clone(true);
  scene.add(model);
  model.updateMatrixWorld(true);
  box.setFromObject(model);
  box.getSize(size);
  box.getCenter(center);
  // Fit the model into a tile with the item's footprint aspect, with a little margin.
  const aspect = def.w / def.h;
  // Boxes, rounds, grenades and coins read best from a diagonal top-down view (three faces
  // visible); guns stay a flat side view.
  const isometric = !('category' in def) || def.category === 'ammo' || def.category === 'grenade' || def.category === 'medical' || def.category === 'food' || def.category === 'resource' || def.category === 'tool' || def.category.startsWith('armor');
  const cam = new OrthographicCamera(-1, 1, 1, -1, 0.01, 50);
  if (isometric) cam.position.copy(center).add(ISO_DIR);
  else cam.position.copy(center).add(WEAPON_VIEW_DIR);
  cam.lookAt(center);
  cam.updateMatrixWorld(true);
  // Fit the projected bounding box into the tile.
  let hx = 0;
  let hy = 0;
  for (let i = 0; i < 8; i++) {
    corner.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z);
    corner.sub(center).applyQuaternion(inv.copy(cam.quaternion).invert());
    hx = Math.max(hx, Math.abs(corner.x));
    hy = Math.max(hy, Math.abs(corner.y));
  }
  const halfH = Math.max(hy, hx / aspect) * 1.12;
  cam.left = -halfH * aspect;
  cam.right = halfH * aspect;
  cam.top = halfH;
  cam.bottom = -halfH;
  cam.updateProjectionMatrix();
  renderer.setSize(def.w * PX_PER_CELL, def.h * PX_PER_CELL, false);
  renderer.render(scene, cam);
  scene.remove(model);
  return renderer.domElement.toDataURL('image/png');
}

function notify(): void {
  version++;
  for (const listener of listeners) listener();
}

/** The weapon models the icons come from (kept for guns dressed with attachments). */
let library: WeaponLibrary | null = null;

/** Renders a side view of every weapon model into an image for the inventory/hotbar tiles. */
export function renderItemIcons(weapons: WeaponLibrary): void {
  library = weapons;
  if (![...weapons.keys()].some((id) => !id.startsWith('proj_') && !itemIcons.has(id))) return;
  const renderer = iconRenderer(), scene = iconScene();
  try {
    for (const [itemId, visual] of weapons) {
      if (itemId.startsWith('proj_') || itemIcons.has(itemId)) continue;
      itemIcons.set(itemId, renderIcon(renderer, scene, itemId, visual.display));
    }
  } finally {
    renderer.dispose();
    renderer.forceContextLoss();
    notify();
  }
}

const queued = new Map<string, { itemId: string; attachments: Attachments }>();
let flushing = 0;

/**
 * Icon of a gun as it is: with its attachments mounted. Rendered once per combination on the
 * next frame (the bare gun's icon stands in until then).
 */
export function itemIconFor(itemId: string, attachments?: Attachments): string | undefined {
  if (!attachments || (!attachments.optic && !attachments.muzzle)) return itemIcons.get(itemId);
  const key = `${itemId}|${attachments.optic ?? ''}|${attachments.muzzle ?? ''}`;
  const hit = itemIcons.get(key);
  if (hit) return hit;
  if (library && typeof document !== 'undefined' && !queued.has(key)) {
    queued.set(key, { itemId, attachments });
    if (!flushing) flushing = requestAnimationFrame(flushDressed);
  }
  return itemIcons.get(itemId);
}

function flushDressed(): void {
  flushing = 0;
  if (!library || !queued.size) return;
  const renderer = iconRenderer(), scene = iconScene();
  try {
    for (const [key, { itemId, attachments }] of queued) {
      const visual = dressWeapon(library, itemId, attachments);
      if (visual) itemIcons.set(key, renderIcon(renderer, scene, itemId, visual.display));
    }
  } finally {
    renderer.dispose();
    renderer.forceContextLoss();
    notify();
  }
}
