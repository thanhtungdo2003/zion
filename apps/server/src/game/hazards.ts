import { CAMP_ASSET } from '@zion/assets';
import { DEFAULT_CHARACTER, Layer, capsuleVsBox, makeContact, type Collider, type CollisionWorld } from '@zion/physics';

export const WIRE_DAMAGE = 10;
export const WIRE_INTERVAL_MS = 750;
const candidates: Collider[] = [];
const contact = makeContact();

/** Include the movement controller's separation margin so touching a solid fence hurts. */
export function touchesBarbedWire(world: CollisionWorld, p: { x: number; y: number; z: number }): boolean {
  const radius = DEFAULT_CHARACTER.radius + 0.08;
  const height = DEFAULT_CHARACTER.height;
  const count = world.queryAABB({ minX: p.x - radius, maxX: p.x + radius, minY: p.y, maxY: p.y + height, minZ: p.z - radius, maxZ: p.z + radius }, Layer.Static, candidates);
  for (let i = 0; i < count; i++) {
    const c = candidates[i]!;
    if (c.tag !== CAMP_ASSET['barbed-wire-fence'] || c.shape.type !== 'box') continue;
    if (capsuleVsBox(p.x, p.y + DEFAULT_CHARACTER.radius, p.z, p.x, p.y + height - DEFAULT_CHARACTER.radius, p.z, radius, c.shape, contact)) return true;
  }
  return false;
}
