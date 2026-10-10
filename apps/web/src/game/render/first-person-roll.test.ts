import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { DEFAULT_CHARACTER } from '@zion/physics';
import { TICK_DT } from '@zion/shared';
import { applyFirstPersonRoll } from './first-person-roll';

const ticks = Math.round(DEFAULT_CHARACTER.rollDuration / TICK_DT);
describe('first-person tumble', () => {
  it.each([0, Math.PI / 2, Math.PI, -Math.PI / 2])('turns upside down midway through a roll in direction %s', (rollYaw) => {
    const camera = new PerspectiveCamera();
    camera.position.y = DEFAULT_CHARACTER.eyeHeight;
    applyFirstPersonRoll(camera, { rollTicks: ticks / 2, rollYaw }, ticks / 2, 0);
    const up = new Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    expect(up.y).toBeCloseTo(-1);
    expect(camera.position.y).toBeCloseTo(DEFAULT_CHARACTER.eyeHeight - 0.85);
  });
  it('begins and finishes upright without changing the mouse look direction', () => {
    const camera = new PerspectiveCamera();
    camera.rotation.set(0.3, 0.8, 0, 'YXZ');
    const original = camera.quaternion.clone();
    applyFirstPersonRoll(camera, { rollTicks: ticks, rollYaw: 1 }, 0, 0);
    expect(camera.quaternion.angleTo(original)).toBeCloseTo(0);
    applyFirstPersonRoll(camera, { rollTicks: 0, rollYaw: 1 }, 1, 1);
    expect(camera.quaternion.angleTo(original)).toBeCloseTo(0);
  });
});
