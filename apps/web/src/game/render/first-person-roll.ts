import { Quaternion, Vector3, type Camera } from 'three';
import { DEFAULT_CHARACTER, type CharacterState } from '@zion/physics';
import { TICK_DT } from '@zion/shared';

const axis = new Vector3();
const rotation = new Quaternion();
const durationTicks = Math.max(1, Math.round(DEFAULT_CHARACTER.rollDuration / TICK_DT));

/** Apply a complete tumble around the travel direction after setting the normal eye pose. */
export function applyFirstPersonRoll(camera: Camera, state: Pick<CharacterState, 'rollTicks' | 'rollYaw'>, previousTicks: number, alpha: number): void {
  if (state.rollTicks <= 0 && previousTicks <= 0) return;
  // At the first tick the counter jumps from zero to the full duration.
  const start = previousTicks > 0 ? previousTicks : state.rollTicks;
  const remaining = start + (state.rollTicks - start) * Math.max(0, Math.min(1, alpha));
  const progress = Math.max(0, Math.min(1, 1 - remaining / durationTicks));
  const phase = progress * progress * (3 - 2 * progress);
  axis.set(Math.cos(state.rollYaw), 0, -Math.sin(state.rollYaw));
  rotation.setFromAxisAngle(axis, -phase * Math.PI * 2);
  camera.quaternion.premultiply(rotation);
  camera.position.y -= Math.sin(progress * Math.PI) ** 2 * 0.85;
}
