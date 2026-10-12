import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { Box3, PerspectiveCamera, Vector3 } from 'three';
import { EntityFlags } from '@zion/shared';
import { Avatar } from './avatars';
import { ViewModel } from './viewmodel';
import { buildBBModel, type RawModel } from './character-model';
import type * as CharacterModel from './character-model';
import { loadWeapons, type WeaponLibrary } from './weapons';

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
  it('fits the Barrett muzzle forward and equips the supplied rifle/axe in both camera rigs', () => {
    const gun = weapons.get('barrett')!;
    expect(gun.display.getObjectByName('weapon-muzzle')!.position.x).toBeGreaterThan(1);
    expect(new Box3().setFromObject(gun.display).getSize(new Vector3()).x).toBeCloseTo(1.45, 1);
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
  it('loads the PKM, ammo box and authored reload clip with a forward muzzle', () => {
    const gun = weapons.get('pkm')!;
    expect(gun.reloadClip).toBe('reload_ammo_box');
    expect(weapons.get('ammo_pkm')).toBeDefined();
    const muzzle = gun.display.getObjectByName('weapon-muzzle')!;
    expect(muzzle.position.x).toBeGreaterThan(0);
    const size = new Box3().setFromObject(gun.display).getSize(new Vector3());
    expect(size.x).toBeCloseTo(1.17, 1);
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
