import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';
import { Group, Matrix4, Vector3 } from 'three';
import type { WeaponLibrary } from './weapons';
import { EntityFlags } from '@zion/shared';
import { Avatar } from './avatars';
import { buildBBModel, type CharacterTemplate, type RawModel } from './character-model';

let template: CharacterTemplate;
beforeAll(async () => {
  const raw = JSON.parse(await readFile(new URL('../../../../../models/characters/teen-wasteland-survivor.bbmodel', import.meta.url), 'utf8')) as RawModel;
  raw.textures = [];
  template = await buildBBModel(raw);
});

function bodyUp(avatar: Avatar): Vector3 {
  avatar.root.updateMatrixWorld(true);
  const bone = avatar.root.getObjectByName('root')!;
  return new Vector3(0, 1, 0).transformDirection(bone.matrixWorld);
}

describe('lobby rifle patrol', () => {
  it('loops the authored pose and carries the rifle with the animated right hand', () => {
    const avatar = new Avatar(template, true);
    const weapons: WeaponLibrary = new Map([['ak47', {
      itemId: 'ak47', object: new Group(), display: new Group(), attach: new Matrix4(),
      clips: new Map(), reloadClip: null, muzzle: new Vector3(0, 0, -1), eject: null,
    }]]);
    avatar.setStance('rifle');
    avatar.setWeapon('ak47', weapons);
    avatar.setIdleClip('rifle_patrol_idle');
    const pose = (phase: number) => {
      avatar.setIdleClip(null);
      avatar.setIdleClip('rifle_patrol_idle', phase);
      avatar.update(0, 0, 0, 0, EntityFlags.Grounded, 0.2, phase);
      avatar.root.updateMatrixWorld(true);
      const muzzle = new Vector3();
      expect(avatar.weaponPoint('muzzle', muzzle)).toBe(true);
      const hand = avatar.root.getObjectByName('hand_right')!;
      expect(muzzle.distanceTo(new Vector3(0, 0, -1).applyMatrix4(hand.matrixWorld))).toBeLessThan(1e-6);
      return muzzle;
    };
    const start = pose(0);
    expect(start.distanceTo(pose(6.3))).toBeGreaterThan(0.1);
    expect(start.distanceTo(pose(8))).toBeLessThan(1e-6);
  });
});

describe('survivor roll recovery', () => {
  it.each([30, 60, 144])('finishes upright and never unwinds the tumble while blending to idle at %s FPS', (fps) => {
    const avatar = new Avatar(template, true);
    const dt = 1 / fps;
    avatar.update(0, 0, 0, 0, EntityFlags.Grounded, 0, 0);
    const frames = Math.ceil(template.clips.get('roll')!.length / dt);
    for (let i = 0; i < frames; i++) avatar.update(0, 0, -(i + 1) * 7.5 * dt, 0, EntityFlags.Grounded | EntityFlags.Rolling, dt, 0);
    for (let i = 0; i < Math.ceil(0.35 / dt); i++) {
      avatar.update(0, 0, -frames * 7.5 * dt, 0, EntityFlags.Grounded, dt, 0);
      expect(bodyUp(avatar).y).toBeGreaterThan(0.99);
    }
  });

  it('completes the foot plant when the rolling flag clears before the clip ends', () => {
    const avatar = new Avatar(template, true);
    const dt = 1 / 60;
    avatar.update(0, 0, 0, 0, EntityFlags.Grounded, 0, 0);
    for (let i = 0; i < 42; i++) avatar.update(0, 0, -(i + 1) * 7.5 * dt, 0, EntityFlags.Grounded | EntityFlags.Rolling, dt, 0);
    const bone = avatar.root.getObjectByName('root')!;
    const before = bone.rotation.x;
    avatar.update(0, 0, -42 * 7.5 * dt, 0, EntityFlags.Grounded, dt, 0);
    // The clip continues forward instead of reversing into the locomotion blend.
    expect(bone.rotation.x).toBeLessThan(before);
    for (let i = 0; i < 30; i++) {
      avatar.update(0, 0, -42 * 7.5 * dt, 0, EntityFlags.Grounded, dt, 0);
      if (i > 7) expect(bodyUp(avatar).y).toBeGreaterThan(0.99);
    }
  });

  it('stays upright when movement changes during recovery and turns smoothly after a backwards roll', () => {
    const avatar = new Avatar(template, true);
    const dt = 1 / 60;
    avatar.setStance('rifle');
    avatar.update(0, 0, 0, 0, EntityFlags.Grounded, 0, 0);
    for (let i = 0; i < 48; i++) avatar.update(0, 0, (i + 1) * 7.5 * dt, 0, EntityFlags.Grounded | EntityFlags.Rolling, dt, 0);
    let yaw = avatar.root.rotation.y;
    let z = 6;
    for (let i = 0; i < 40; i++) {
      z -= (i < 5 || i > 10 ? 3.2 : 0) * dt;
      avatar.update(0, 0, z, 0, EntityFlags.Grounded, dt, 0);
      expect(bodyUp(avatar).y).toBeGreaterThan(0.99);
      const turn = Math.atan2(Math.sin(avatar.root.rotation.y - yaw), Math.cos(avatar.root.rotation.y - yaw));
      expect(Math.abs(turn)).toBeLessThanOrEqual(8 * dt + 1e-6);
      yaw = avatar.root.rotation.y;
    }
  });
});
