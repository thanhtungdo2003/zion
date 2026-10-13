import { Layer } from './layers';
import { makeBox } from './shapes';
import type { ColliderInit } from './world';

export interface DoorPose { x: number; y: number; z: number; yaw: number; open: boolean }
/** Frame and hinged leaf match the supplied wooden-door model at 16 units/metre. */
export function doorColliders(d: DoorPose): ColliderInit[] {
  const c = Math.cos(d.yaw), s = Math.sin(d.yaw);
  const box = (x: number, y: number, z: number, hx: number, hy: number, hz: number, yaw = d.yaw): ColliderInit => ({ shape: makeBox(d.x + x * c + z * s, d.y + y, d.z - x * s + z * c, hx, hy, hz, yaw), layer: Layer.Static, tag: 2202 });
  return [box(-.5, 1.03, 0, .0625, 1.03, .15), box(.5, 1.03, 0, .0625, 1.03, .15), box(0, 2.06, 0, .5625, .0625, .15),
    d.open ? box(-.4375, 1.03, .4375, .4375, .97, .09, d.yaw - Math.PI / 2) : box(0, 1.03, 0, .4375, .97, .09)];
}
