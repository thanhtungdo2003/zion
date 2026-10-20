import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { Box3, PerspectiveCamera, Vector3 } from 'three';
import { EntityFlags } from '@zion/shared';
import { Avatar } from './avatars';
import { ViewModel } from './viewmodel';
import { lookDirection } from './offhand-light';
import { BB_UNITS_PER_METER, buildBBModel, type RawModel } from './character-model';
import type * as CharacterModel from './character-model';
import { loadWeapons, type WeaponLibrary } from './weapons';

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
let character: Awaited<ReturnType<typeof buildBBModel>>;
beforeAll(async () => {
  const raw = JSON.parse(await readFile(new URL('../../../public/models/characters/teen-wasteland-survivor.bbmodel', import.meta.url), 'utf8')) as RawModel;
  raw.textures = [];
  character = await buildBBModel(raw);
  weapons = await loadWeapons(character);
});

describe('C4 supplied models', () => {
  it('holds offhand gear and derives the beam from the actual lens during swings and recoil', () => {
    const avatar = new Avatar(character, true), camera = new PerspectiveCamera(), view = new ViewModel(camera);
    avatar.setOffhand('flashlight', weapons); view.setOffhand('flashlight', weapons);
    const origin = new Vector3(), direction = new Vector3();
    for (const id of ['fire_axe', 'katana', 'pkm', 'gl18']) {
      avatar.setWeapon(id, weapons); avatar.setStance(id === 'gl18' ? 'pistol' : id === 'pkm' ? 'rifle' : 'melee');
      view.set(id, weapons);
      avatar.slash(); view.swing(1);
      for (let frame = 0; frame < 30; frame++) {
        if (frame === 5) { avatar.kick(.1); view.kick(); }
        avatar.update(0, 0, 0, frame * .05, EntityFlags.Grounded, 1 / 60, frame / 60);
        view.update(1 / 60, { visible: true, moving: true, sprint: false, reloading: false, yaw: frame * .05, pitch: .2 });
        for (const [rig, model] of [[avatar, avatar.root.getObjectByName('offhand-item')!], [view, camera.getObjectByName('first-person-offhand')!]] as const) {
          expect(rig.offhandLightPose(origin, direction)).toBe(true);
          expect(origin.distanceTo(model.getObjectByName('weapon-emitter')!.getWorldPosition(new Vector3()))).toBeLessThan(1e-6);
          const expected = (rig === avatar ? new Vector3(0, 0, 1) : new Vector3(1, 0, 0)).transformDirection(model.matrixWorld);
          expect(direction.dot(expected)).toBeCloseTo(1, 6);
        }
      }
    }
    view.set(null, weapons);
    view.update(.1, { visible: true, moving: false, sprint: false, reloading: false, yaw: 0, pitch: 0 });
    expect(camera.children[0]!.visible).toBe(true);
    view.setOffhand(null, weapons); avatar.setOffhand(null, weapons);
    expect(view.offhandLightPose(origin, direction)).toBe(false);
    expect(avatar.offhandLightPose(origin, direction)).toBe(false);
    view.dispose();
  });
  it('points the held flashlight beam along the view direction through swings', () => {
    const avatar = new Avatar(character, true), camera = new PerspectiveCamera(), view = new ViewModel(camera);
    avatar.setOffhand('flashlight', weapons); view.setOffhand('flashlight', weapons);
    avatar.setWeapon('fire_axe', weapons); avatar.setStance('melee'); view.set('fire_axe', weapons);
    avatar.slash(); view.swing(1);
    const origin = new Vector3(), direction = new Vector3(), look = new Vector3();
    for (let frame = 0; frame < 30; frame++) {
      const yaw = frame * .2, pitch = -.4 + frame * .03;
      avatar.update(0, 0, 0, yaw, EntityFlags.Grounded, 1 / 60, frame / 60);
      view.update(1 / 60, { visible: true, moving: true, sprint: false, reloading: false, yaw, pitch });
      lookDirection(yaw, pitch, look);
      for (const rig of [avatar, view]) {
        rig.aimOffhand(look);
        expect(rig.offhandLightPose(origin, direction)).toBe(true);
        expect(direction.dot(look)).toBeCloseTo(1, 5);
      }
    }
  });
  it('holds the rifle handguard or pistol grip with the character left arm through sway and recoil', () => {
    const camera = new PerspectiveCamera(), view = new ViewModel(camera);
    for (const id of ['ak47', 'pkm', 'barrett', 'gl18', 'revolver']) {
      const visual = weapons.get(id)!;
      const contact = visual.firstPersonSupport!.contact;
      expect(id === 'gl18' || id === 'revolver' ? contact.length() < .07 : contact.x > .08).toBe(true);
      view.set(id, weapons);
      const holder = camera.getObjectByName('first-person-support')!;
      const hand = holder.getObjectByName('hand_left')!;
      const model = holder.parent!;
      for (let frame = 0; frame < 30; frame++) {
        if (frame === 4) view.kick();
        view.update(1 / 60, { visible: true, moving: true, sprint: false, reloading: false, yaw: frame * .01, pitch: .2 });
        model.updateWorldMatrix(true, true);
        // The fist (just above the wrist locator) closes on the contact point; it stays with the gun.
        expect(hand.getWorldPosition(new Vector3()).distanceTo(contact.clone().applyMatrix4(model.matrixWorld))).toBeLessThan(.07);
      }
      expect(camera.children[0]!.position.y).toBeLessThan(-.24);
      expect(camera.children[0]!.position.z).toBeGreaterThan(-.33);
      view.update(.1, { visible: true, moving: false, sprint: false, reloading: true, yaw: 0, pitch: 0 });
      expect(holder.visible).toBe(false);
      view.set(null, weapons);
      // Keep each iteration independent of cached, invisible models.
      holder.removeFromParent();
    }
    view.dispose();
  });
  it('leads every slash with the actual sharp edge or hammer face in both camera rigs', () => {
    for (const id of ['katana', 'quam', 'fire_axe', 'long_sledgehammer']) {
      const visual = weapons.get(id)!;
      // Independent authored head/blade coordinates: measuring a point on the lower
      // handle can reverse the apparent swing direction of the actual axe head.
      const headY = { katana: 32, quam: 56, fire_axe: 27, long_sledgehammer: 43 }[id]!;
      expect(visual.melee!.held.tip.y).toBeCloseTo(headY / BB_UNITS_PER_METER);
      const avatar = new Avatar(character, true);
      avatar.setStance('melee'); avatar.setWeapon(id, weapons);
      const gun = avatar.root.getObjectByName('hand_right')!.children.find(child => !child.matrixAutoUpdate)!;
      const camera = new PerspectiveCamera(), view = new ViewModel(camera);
      view.set(id, weapons);
      const display = camera.children[0]!.children[0]!.children[0]!;
      for (let variant = 0; variant < 3; variant++) {
        avatar.slash(); view.swing(variant, 1200);
        const previous = [new Vector3(), new Vector3()];
        let aligned = 0;
        for (let frame = 0; frame < 18; frame++) {
          avatar.update(0, 0, 0, 0, EntityFlags.Grounded, 1 / 60, frame / 60);
          view.update(1 / 60, { visible: true, moving: false, sprint: false, reloading: false, yaw: 0, pitch: 0 });
          for (const [index, model, axes] of [[0, gun, visual.melee!.held], [1, display, visual.melee!.display]] as const) {
            model.updateWorldMatrix(true, false);
            const tip = axes.tip.clone().applyMatrix4(model.matrixWorld);
            const axis = axes.axis.clone().transformDirection(model.matrixWorld);
            const velocity = tip.clone().sub(previous[index]!);
            previous[index]!.copy(tip);
            velocity.addScaledVector(axis, -velocity.dot(axis));
            if (frame === 0 || velocity.lengthSq() < 1e-8) continue;
            const edge = axes.edge.clone().transformDirection(model.matrixWorld);
            const facing = edge.dot(velocity.normalize());
            expect(id === 'fire_axe' ? -facing : facing, `${id}/${variant}/${index}/${frame}`).toBeGreaterThan(.999);
            aligned++;
          }
        }
        expect(aligned).toBeGreaterThan(10);
      }
      if (id === 'fire_axe' || id === 'long_sledgehammer') {
        for (let frame = 0; frame < 180; frame++) {
          avatar.update(0, 0, 0, 0, EntityFlags.Grounded, 1 / 60, 0);
          view.update(1 / 60, { visible: true, moving: false, sprint: false, reloading: false, yaw: 0, pitch: 0 });
        }
        for (const [model, axes] of [[gun, visual.melee!.held], [display, visual.melee!.display]] as const) {
          model.updateWorldMatrix(true, false);
          expect(axes.edge.clone().transformDirection(model.matrixWorld).y, `${id} resting face`).toBeLessThan(-.9);
        }
      }
      view.dispose();
    }
  });
  it('keeps real gun bores on aim through prone idle, crawl, shooting and recovery', () => {
    for (const id of ['ak47', 'gl18', 'svd', 'pkm', 'barrett']) {
      const visual = weapons.get(id)!;
      expect(visual.aim, id).toBeDefined();
      const avatar = new Avatar(character, true);
      avatar.setStance(id === 'gl18' ? 'pistol' : 'rifle');
      avatar.setWeapon(id, weapons);
      const hand = avatar.root.getObjectByName('hand_right')!;
      const gun = hand.children.find(child => !child.matrixAutoUpdate)!;
      for (const pitch of [-.5, 0, .6]) {
        // Let the normal aim smoothing settle.
        for (let i = 0; i < 60; i++) avatar.setAimPitch(pitch);
        let x = 3;
        for (const [flags, moving] of [[EntityFlags.Prone, false], [EntityFlags.Prone, true], [EntityFlags.Prone | EntityFlags.Attacking, false], [0, false]] as const) {
          for (let phase = 0; phase < 12; phase++) {
            if (flags & EntityFlags.Attacking) avatar.kick(.1);
            const yaw = phase * .35;
            if (moving) x += .1;
            avatar.update(x, 0, 4, yaw, flags | EntityFlags.Grounded, .1, phase * .1);
            avatar.root.updateMatrixWorld(true);
            const bore = visual.aim!.barrel.clone().transformDirection(gun.matrixWorld);
            const target = new Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
            expect(bore.dot(target), `${id}: ${flags}/${phase}`).toBeCloseTo(1, 5);
            const expectedGrip = visual.aim!.grip.clone().applyMatrix4(visual.attach).applyMatrix4(hand.matrixWorld);
            const actualGrip = visual.aim!.grip.clone().applyMatrix4(gun.matrixWorld);
            expect(actualGrip.distanceTo(expectedGrip)).toBeLessThan(1e-6);
          }
        }
      }
    }
  });
  it('fits the Barrett muzzle forward and equips the supplied rifle/axe in both camera rigs', () => {
    const gun = weapons.get('barrett')!;
    expect(gun.display.getObjectByName('weapon-muzzle')!.position.x).toBeGreaterThan(1);
    expect(new Box3().setFromObject(gun.display).getSize(new Vector3()).x).toBeCloseTo(1.773, 1);
    expect(weapons.get('ammo_50bmg')).toBeDefined();
    const avatar = new Avatar(character, true), camera = new PerspectiveCamera(), view = new ViewModel(camera);
    for (const [id, stance] of [['barrett', 'rifle'], ['fire_axe', 'melee']] as const) {
      avatar.setStance(stance); avatar.setWeapon(id, weapons);
      avatar.update(0, 0, 0, 0, EntityFlags.Grounded, .1, 0);
      view.set(id, weapons);
      const size = new Box3().setFromObject(camera).getSize(new Vector3());
      expect(Number.isFinite(size.x) && size.x > 0).toBe(true);
    }
    view.dispose();
  });
  it('loads the PKM, ammo box with a forward muzzle', () => {
    const gun = weapons.get('pkm')!;
    expect(weapons.get('ammo_pkm')).toBeDefined();
    const muzzle = gun.display.getObjectByName('weapon-muzzle')!;
    expect(muzzle.position.x).toBeGreaterThan(0);
    const size = new Box3().setFromObject(gun.display).getSize(new Vector3());
    expect(size.x).toBeCloseTo(1.2, 1);
  });
  it('uses the bundle for the inventory and the clacker for the held model', () => {
    const bundle = weapons.get('c4')!, remote = weapons.get('c4_detonator')!;
    expect(bundle.display.getObjectByName('c4_charge')).toBeDefined();
    expect(bundle.display.getObjectByName('detonator')).toBeDefined();
    expect(bundle.object).toBe(remote.object);
    expect(bundle.object.getObjectByName('c4_charge')).toBeUndefined();
    const avatar = new Avatar(character, true);
    avatar.setStance('grenade'); avatar.setWeapon('c4', weapons);
    avatar.update(0, 0, 0, 0, EntityFlags.Grounded, .1, 0);
    expect(avatar.root.getObjectByName('remote')).toBeDefined();
    expect(avatar.root.getObjectByName('c4_charge')).toBeUndefined();
  });

  it('holds the clacker in first person before and after throwing and uses only the bomb in the world', () => {
    const camera = new PerspectiveCamera(), view = new ViewModel(camera);
    view.set('c4', weapons);
    const clacker = camera.getObjectByName('remote');
    expect(clacker).toBeDefined();
    expect(camera.getObjectByName('c4_charge')).toBeUndefined();
    view.set('c4_detonator', weapons);
    expect(camera.getObjectByName('remote')).toBe(clacker);
    const bomb = weapons.get('proj_c4')!.display;
    expect(bomb.getObjectByName('c4_charge')).toBeDefined();
    expect(bomb.getObjectByName('remote')).toBeUndefined();
    const size = new Box3().setFromObject(bomb).getSize(new Vector3());
    expect(Math.max(size.x, size.y, size.z)).toBeLessThan(.4);
    view.dispose();
  });
});
