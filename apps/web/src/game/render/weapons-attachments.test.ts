import { readFile } from 'node:fs/promises';
import { Box3, Matrix4, PerspectiveCamera, Raycaster, Vector2, Vector3, type Object3D } from 'three';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { WEAPON_ATTACHMENTS, type Attachments } from '@zion/shared';
import type * as CharacterModel from './character-model';
import { buildBBModel, type RawModel } from './character-model';
import { dressWeapon, loadWeapons, type WeaponLibrary } from './weapons';
import { ViewModel } from './viewmodel';

vi.mock('@/lib/preload', async () => {
  const { untexturedGlb } = await import('./test-glb');
  return { cachedFetch: async (url: string) => new Response(untexturedGlb(await readFile(new URL(`../../../public${url}`, import.meta.url)))) };
});
vi.mock('./character-model', async importOriginal => {
  const actual = await importOriginal<typeof CharacterModel>();
  return { ...actual, fetchWithProgress: async (url: string) => {
    const raw = JSON.parse(await readFile(new URL(`../../../public${url}`, import.meta.url), 'utf8')) as RawModel;
    raw.textures = [];
    return JSON.stringify(raw);
  } };
});

let weapons: WeaponLibrary;
beforeAll(async () => {
  const raw = JSON.parse(await readFile(new URL('../../../public/models/characters/teen-wasteland-survivor.bbmodel', import.meta.url), 'utf8')) as RawModel;
  raw.textures = [];
  weapons = await loadWeapons(await buildBBModel(raw));
}, 60_000);

const guns = Object.keys(WEAPON_ATTACHMENTS);

/** Bounds of a display model's meshes only (not its markers). */
function meshBounds(root: Object3D, skip = 'attachment-'): Box3 {
  const box = new Box3();
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    let p: Object3D | null = o;
    while (p) { if (p.name.startsWith(skip)) return; p = p.parent; }
    if ((o as { isMesh?: boolean }).isMesh) box.expandByObject(o, true);
  });
  return box;
}

describe('weapon sights and attachment mounts', () => {
  it.each(guns)('%s: the iron sight line runs along the bore, above the grip, ahead to the muzzle', (id) => {
    const v = weapons.get(id)!;
    expect(v.sight).toBeTruthy();
    const dir = v.sight!.front.clone().sub(v.sight!.rear).normalize();
    expect(dir.x).toBeGreaterThan(.97);
    expect(v.sight!.rear.y).toBeGreaterThan(0);
    expect(v.sight!.rear.y).toBeLessThan(.3);
    const bounds = meshBounds(v.display);
    const muzzle = v.display.getObjectByName('weapon-muzzle')!.getWorldPosition(new Vector3());
    // The muzzle marker is at the front end of the model and the sights sit on top of it.
    expect(muzzle.x).toBeGreaterThan(bounds.max.x - .06);
    expect(v.sight!.rear.y).toBeGreaterThan(bounds.max.y - .09);
  });

  it.each(guns.flatMap((id) => Object.entries(WEAPON_ATTACHMENTS[id]!).flatMap(([slot, list]) => list!.map((part) => [id, slot, part] as const))))('%s takes %s %s in the right place', (id, slot, part) => {
    const attachments: Attachments = { [slot]: part };
    const v = dressWeapon(weapons, id, attachments)!;
    const holder = v.display.getObjectByName(`attachment-${part}`)!;
    expect(holder).toBeTruthy();
    const gun = meshBounds(v.display), mounted = new Box3().setFromObject(holder, true);
    if (slot === 'optic') {
      // Sits on the gun's top, over its body, and its eyepiece becomes the sight line.
      expect(mounted.min.y).toBeGreaterThan(gun.max.y - .08);
      expect(mounted.max.x).toBeGreaterThan(gun.min.x);
      expect(mounted.min.x).toBeLessThan(gun.max.x);
      const dir = v.sight!.front.clone().sub(v.sight!.rear).normalize();
      expect(dir.x).toBeGreaterThan(.99);
      expect(v.sight!.rear.y).toBeGreaterThan(gun.max.y - .05);
    } else {
      // Screwed on the muzzle, extending it forward; the flash now comes from its end.
      const base = weapons.get(id)!.display.getObjectByName('weapon-muzzle')!.getWorldPosition(new Vector3());
      const muzzle = v.display.getObjectByName('weapon-muzzle')!.getWorldPosition(new Vector3());
      expect(mounted.min.x).toBeGreaterThan(base.x - .03);
      expect(muzzle.x).toBeGreaterThan(base.x + .05);
      expect(Math.abs(muzzle.y - base.y)).toBeLessThan(.01);
    }
  });

  it.each(guns.flatMap((id) => [[id, undefined], [id, WEAPON_ATTACHMENTS[id]!.optic?.[0]]] as const))('%s aims down the sights (optic %s) onto the screen centre', (id, optic) => {
    const camera = new PerspectiveCamera(75, 16 / 9, .05, 1000), view = new ViewModel(camera);
    view.set(id, weapons, optic ? { optic } : undefined);
    for (let i = 0; i < 120; i++) view.update(1 / 60, { visible: true, moving: false, sprint: false, reloading: false, yaw: 0, pitch: 0, aiming: true });
    camera.updateMatrixWorld(true);
    const v = dressWeapon(weapons, id, optic ? { optic } : undefined)!;
    const model = camera.children[0]!.children[0]!.children.find((c) => c.visible)!;
    const toCamera = new Matrix4().copy(camera.matrixWorld).invert().multiply(model.matrixWorld);
    const rear = v.sight!.rear.clone().applyMatrix4(toCamera), front = v.sight!.front.clone().applyMatrix4(toCamera);
    expect(Math.abs(rear.x)).toBeLessThan(.003);
    expect(Math.abs(rear.y)).toBeLessThan(.003);
    expect(Math.abs(front.x)).toBeLessThan(.003);
    expect(Math.abs(front.y)).toBeLessThan(.003);
    expect(front.z).toBeLessThan(rear.z);
    expect(rear.z).toBeLessThan(-.15);
  });
});

describe('weapon mechanics', () => {
  it.each(['ak47', 'gl18', 'deagle', 'kar98k', 'mini14', 'scar_h'])('%s plays its own reload clip on the moving parts', async (id) => {
    const { WeaponMechanics } = await import('./weapon-mechanics');
    const v = weapons.get(id)!;
    expect(v.reloadClip).toBe('reload');
    const model = v.display.clone(true), mech = new WeaponMechanics(model, v, false);
    const rest = new Map<string, string>();
    model.traverse((o) => { if (o.matrixAutoUpdate) { o.updateMatrix(); rest.set(o.uuid, o.matrix.toArray().join()); } });
    mech.reload(2);
    mech.update(.8); // mid-reload
    let moved = 0;
    model.traverse((o) => { if (!o.matrixAutoUpdate) return; o.updateMatrix(); if (rest.get(o.uuid) !== o.matrix.toArray().join()) moved++; });
    expect(moved).toBeGreaterThan(0);
    mech.update(1.5); // finished: everything back at rest
    model.traverse((o) => { if (!o.matrixAutoUpdate) return; o.updateMatrix(); rest.get(o.uuid)!.split(',').forEach((v, i) => expect(o.matrix.elements[i]).toBeCloseTo(Number(v), 6)); });
  });
});

describe('first-person hands', () => {
  it.each(guns)('%s: both hands are on the gun and neither rises above its top', (id) => {
    const camera = new PerspectiveCamera(75, 16 / 9, .05, 1000), view = new ViewModel(camera);
    view.set(id, weapons);
    view.update(1 / 60, { visible: true, moving: false, sprint: false, reloading: false, yaw: 0, pitch: 0 });
    const model = camera.children[0]!.children[0]!.children.find((c) => c.visible)!;
    model.updateWorldMatrix(true, true);
    const toModel = model.matrixWorld.clone().invert();
    const top = meshBounds(model, 'first-person').applyMatrix4(toModel).max.y;
    for (const name of ['first-person-support', 'first-person-arm-right']) {
      const arm = model.getObjectByName(name);
      expect(arm, name).toBeTruthy();
      const box = new Box3().setFromObject(arm!, true).applyMatrix4(toModel);
      expect(box.max.y).toBeLessThan(top + .01);
    }
    // Neither arm covers the middle of the screen, at the hip or aiming down the sights.
    for (const aiming of [false, true]) {
      for (let i = 0; i < 90; i++) view.update(1 / 60, { visible: true, moving: false, sprint: false, reloading: false, yaw: 0, pitch: 0, aiming });
      camera.updateMatrixWorld(true);
      const arms = ['first-person-support', 'first-person-arm-right'].map((n) => model.getObjectByName(n)!);
      for (const [x, y] of [[0, 0], [.1, .1], [-.1, .1], [0, .2]] as const) {
        const ray = new Raycaster(); ray.setFromCamera(new Vector2(x, y), camera);
        expect(ray.intersectObjects(arms, true).length, `${aiming ? 'ADS' : 'hip'} ${x},${y}`).toBe(0);
      }
    }
  });
});

describe('see-through sights', () => {
  it.each([['ak47', 'red_dot'], ['ak47', 'holo_sight'], ['mp5', 'holo_sight'], ['m4a1', 'red_dot']] as const)('%s with %s: nothing blocks the aiming ray', (id, optic) => {
    const camera = new PerspectiveCamera(75, 16 / 9, .05, 1000), view = new ViewModel(camera);
    view.set(id, weapons, { optic });
    for (let i = 0; i < 120; i++) view.update(1 / 60, { visible: true, moving: false, sprint: false, reloading: false, yaw: 0, pitch: 0, aiming: true });
    camera.updateMatrixWorld(true);
    const model = camera.children[0]!.children[0]!.children.find((c) => c.visible)!;
    const ray = new Raycaster(); ray.setFromCamera(new Vector2(0, 0), camera);
    expect(ray.intersectObject(model, true).length).toBe(0);
  });
});
