import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { Group, Matrix4, Vector3 } from 'three';
import type { WeaponLibrary } from './weapons';
import { EntityFlags } from '@zion/shared';
import { Avatar } from './avatars';
import { BB_UNITS_PER_METER, buildBBModel, type CharacterTemplate, type RawModel } from './character-model';

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

describe('swimming pose', () => {
  it('raises the body smoothly without moving the authoritative root and cancels attacks', () => {
    const avatar = new Avatar(template, true);
    avatar.update(10, 1, 10, 0, EntityFlags.Grounded, 1 / 60, 0);
    avatar.playOnce('melee_attack');
    avatar.update(10, 1, 10, 0, EntityFlags.Swimming | EntityFlags.Attacking, 1 / 60, 0);
    const model = avatar.root.children[0]!;
    expect(model.position.y).toBeGreaterThan(0);
    expect(model.position.y).toBeLessThan(.35);
    const layer = () => (avatar as unknown as { cur: { clip: { name: string }; rate: number } }).cur;
    expect(layer().clip.name).toBe('swim');
    for (let i = 0; i < 120; i++) avatar.update(10, 1, 10, 0, EntityFlags.Swimming, 1 / 60, 0);
    expect(model.position.y).toBeCloseTo(.35, 6);
    expect(avatar.root.position.y).toBe(1);
    for (let i = 0; i < 120; i++) avatar.update(10, 1, 10, 0, EntityFlags.Grounded, 1 / 60, 0);
    expect(model.position.y).toBeCloseTo(0, 6);
  });

  it('speeds up the swimming strokes with movement speed', () => {
    const avatar = new Avatar(template, true);
    avatar.update(10, 1, 10, 0, EntityFlags.Swimming, .1, 0);
    avatar.update(10, 1, 9.8, 0, EntityFlags.Swimming, .1, 0);
    const layer = () => (avatar as unknown as { cur: { rate: number } }).cur;
    const slow = layer().rate;
    avatar.update(10, 1, 9.48, 0, EntityFlags.Swimming | EntityFlags.Sprinting, .1, 0);
    expect(layer().rate).toBeGreaterThan(slow);
  });
});

describe('lobby rifle patrol', () => {
  it('keeps each randomly selected duration until the loop ends, then chooses another duration', () => {
    const avatar = new Avatar(template, true);
    const reference = new Avatar(template, true);
    const random = vi.spyOn(Math, 'random').mockReturnValueOnce(0).mockReturnValueOnce(1).mockReturnValue(.5);
    try {
      avatar.setStance('rifle'); avatar.setIdleClip('rifle_patrol_idle', 0, [6, 20]);
      const advance = (frames: number) => {
        for (let i = 0; i < frames; i++) avatar.update(0, 0, 0, 0, EntityFlags.Grounded, 1 / 60, 0);
      };
      const expectPhase = (phase: number) => {
        reference.setIdleClip(null);
        reference.setStance('rifle'); reference.setIdleClip('rifle_patrol_idle', phase - .2);
        reference.update(0, 0, 0, 0, EntityFlags.Grounded, .2, 0);
        for (const name of ['body', 'head', 'arm_right', 'arm_left']) {
          expect(avatar.root.getObjectByName(name)!.quaternion.angleTo(reference.root.getObjectByName(name)!.quaternion), name).toBeLessThan(1e-6);
        }
      };
      advance(45); expectPhase(1); // 0.75 seconds into a six-second loop.
      expect(random).toHaveBeenCalledTimes(1);
      advance(315 + 600); expectPhase(4); // First loop complete, ten seconds into a twenty-second loop.
      expect(random).toHaveBeenCalledTimes(2);
      advance(600 + 195); expectPhase(2); // Third loop lasts thirteen seconds.
      expect(random).toHaveBeenCalledTimes(3);
    } finally { random.mockRestore(); }
  });

  it('keeps the trigger and handguard in separate palms through the complete patrol loop', () => {
    const avatar = new Avatar(template, true);
    const px = 1 / BB_UNITS_PER_METER;
    const rifle = new Group(); rifle.name = 'patrol-rifle';
    const grip = new Vector3(0, .5, 4.5).multiplyScalar(px);
    const support = new Vector3(0, 18, 3).multiplyScalar(px);
    const attach = new Matrix4().makeScale(.95 * 1.5 / (50 * px), .95 * 1.5 / (50 * px), .95 * 1.5 / (50 * px));
    const weapons: WeaponLibrary = new Map([['ak47', {
      itemId: 'ak47', object: rifle, display: new Group(), attach,
      twoHandGrip: { grip, support, up: new Vector3(0, 0, -1), triggerHand: 'left' },
      clips: new Map(), reloadClip: null, muzzle: new Vector3(0, 36, 1).multiplyScalar(px), eject: null,
    }]]);
    avatar.setStance('rifle'); avatar.setWeapon('ak47', weapons); avatar.setIdleClip('rifle_patrol_idle');
    const palm = new Vector3(0, 2, -.2).multiplyScalar(px);
    for (let frame = 0; frame <= 480; frame++) {
      avatar.update(0, 0, 0, .35, EntityFlags.Grounded, 1 / 60, frame / 60);
      avatar.root.updateMatrixWorld(true);
      const weapon = avatar.root.getObjectByName('patrol-rifle')!;
      const right = palm.clone().applyMatrix4(avatar.root.getObjectByName('hand_right')!.matrixWorld);
      const left = palm.clone().applyMatrix4(avatar.root.getObjectByName('hand_left')!.matrixWorld);
      expect(grip.clone().applyMatrix4(weapon.matrixWorld).distanceTo(left)).toBeLessThan(1e-5);
      expect(support.clone().applyMatrix4(weapon.matrixWorld).distanceTo(right)).toBeLessThan(1e-5);
      if (frame === 120) {
        const barrel = new Vector3(0, 1, 0).transformDirection(weapon.matrixWorld);
        expect(Math.abs(barrel.x)).toBeGreaterThan(Math.abs(barrel.z));
        expect(barrel.x).toBeLessThan(0); // Muzzle on the supporting side, stock on the trigger side.
        expect(new Vector3(0, 0, -1).transformDirection(weapon.matrixWorld).y).toBeGreaterThan(.7);
      }
    }
    avatar.setIdleClip(null);
    avatar.update(0, 0, 0, 0, EntityFlags.Grounded, .2, 9);
    expect(avatar.root.getObjectByName('patrol-rifle')!.matrix.equals(attach)).toBe(true);
  });

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
