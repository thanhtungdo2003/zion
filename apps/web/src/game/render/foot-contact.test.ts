import { untexturedGlb } from './test-glb';
import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { EntityFlags } from '@zion/shared';
import { Avatar } from './avatars';
import { buildBBModel, mirrorCharacter, survivorTemplate, type CharacterTemplate, type RawModel } from './character-model';
import { parseHumanAssets } from './human-rig';

let template: CharacterTemplate;
beforeAll(async () => {
  const bytes = await readFile(new URL('../../../../../models/characters/zion-survivor.glb', import.meta.url));
  const assets = await parseHumanAssets(untexturedGlb(bytes));
  const raw = JSON.parse(await readFile(new URL('../../../../../models/characters/teen-wasteland-survivor.bbmodel', import.meta.url), 'utf8')) as RawModel;
  raw.textures = [];
  template = survivorTemplate(mirrorCharacter(await buildBBModel(raw)), assets);
});

describe.each([30, 60, 144])('locomotion without world-space foot locks at %s FPS', (fps) => {
  it.each([
    ['forward', 0, -2, 0], ['slow', 0, -.25, 0], ['strafe', 2, 0, 0],
    // Backpedalling while aiming (moving freely, the body turns into its travel instead).
    ['backward', 0, 2, EntityFlags.Aiming], ['diagonal', 1.4, -1.4, 0],
    ['sprint', 0, -6, EntityFlags.Sprinting], ['crouch', 0, -1, EntityFlags.Crouching],
  ] as const)('keeps fixed bone lengths and continuous steps: %s', (_, vx, vz, posture) => {
    const avatar = new Avatar(template, true);
    const pos = (name: string) => avatar.root.getObjectByName(name)!.getWorldPosition(new Vector3());
    const lengths: Partial<Record<'L' | 'R', number[]>> = {};
    const previous: Partial<Record<'L' | 'R', Vector3>> = {};
    let travel = 0;
    for (let frame = 0; frame < fps * 2.5; frame++) {
      // Accelerate into a faster gait, then decelerate without releasing an anchor.
      const time = frame / fps;
      const ramp = time < 1.5 ? Math.min(1, time * 2) : Math.max(.1, 2.5 - time);
      travel += ramp / fps;
      avatar.update(vx * travel, 0, vz * travel, 0, EntityFlags.Grounded | posture, 1 / fps, time);
      avatar.root.updateMatrixWorld(true);
      for (const side of ['L', 'R'] as const) {
        const hip = pos(`thigh_${side}`), knee = pos(`shin_${side}`), ankle = pos(`foot_${side}`);
        const current = [hip.distanceTo(knee), knee.distanceTo(ankle)];
        lengths[side] ??= current;
        current.forEach((length, i) => expect(length).toBeCloseTo(lengths[side]![i]!, 5));
        const local = avatar.root.worldToLocal(ankle.clone());
        expect(local.toArray().every(Number.isFinite)).toBe(true);
        if (time > .5 && previous[side]) expect(local.distanceTo(previous[side]!), `frame ${frame}, foot ${side}`).toBeLessThan(.3 * 60 / fps);
        previous[side] = local;
      }
    }
    expect('footContacts' in (avatar as unknown as { human: object }).human).toBe(false);
    avatar.update(30, .1, 30, .5, 0, 1 / 60, 3);
    avatar.root.updateMatrixWorld(true);
    for (const side of ['L', 'R']) expect(pos(`foot_${side}`).distanceTo(avatar.root.position)).toBeLessThan(2);
  });
});
