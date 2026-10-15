import { describe, expect, it } from 'vitest';
import { InventoryModel } from './inventory';
import { ATTACHMENTS, ATTACHMENT_ORDER, compatibleSlot, gunsFor, packAttachments, sanitizeAttachments, unpackAttachments, WEAPON_ATTACHMENTS } from './attachments';
import { ITEMS } from './items';
import { SHOP_STOCK } from './shop';
import { WEAPON_SPECS } from './weapons';

function inv(): InventoryModel {
  const m = new InventoryModel({ items: [], equipped: null });
  m.add('ak47'); m.add('red_dot'); m.add('scope_4x'); m.add('suppressor_pistol'); m.add('suppressor_rifle');
  return m;
}
const uid = (m: InventoryModel, id: string) => m.items.find((i) => i.itemId === id)!.uid;

describe('weapon attachments', () => {
  it('every attachment is an item, sold in the shop, fits at least one gun, and has a snapshot index', () => {
    for (const id of Object.keys(ATTACHMENTS)) {
      expect(ITEMS[id]?.category).toBe('attachment');
      expect(SHOP_STOCK.some((e) => e.item === id && e.category === 'attachments')).toBe(true);
      expect(gunsFor(id).length).toBeGreaterThan(0);
      expect(ATTACHMENT_ORDER).toContain(id);
    }
    expect(ATTACHMENT_ORDER.length).toBeLessThan(16);
    for (const gun of Object.keys(WEAPON_ATTACHMENTS)) expect(ITEMS[gun]).toBeTruthy();
  });

  it('guns are bare: no firearm keeps a built-in scope', () => {
    for (const [id, spec] of Object.entries(WEAPON_SPECS)) if (spec.kind === 'gun' && !spec.projectile) expect(spec.scope, String(id)).toBeUndefined();
  });

  it('installs, swaps and removes without duplicating or losing items', () => {
    const m = inv(), gun = uid(m, 'ak47');
    const count = () => m.items.length + Object.keys(m.get(gun)!.attachments ?? {}).length;
    const total = count();
    expect(m.attach(gun, uid(m, 'red_dot'))).toBe(true);
    expect(m.get(gun)!.attachments).toEqual({ optic: 'red_dot' });
    expect(m.items.some((i) => i.itemId === 'red_dot')).toBe(false);
    // Swapping the optic gives the red dot back.
    expect(m.attach(gun, uid(m, 'scope_4x'))).toBe(true);
    expect(m.get(gun)!.attachments).toEqual({ optic: 'scope_4x' });
    expect(m.items.filter((i) => i.itemId === 'red_dot')).toHaveLength(1);
    expect(m.attach(gun, uid(m, 'suppressor_rifle'))).toBe(true);
    expect(count()).toBe(total);
    expect(m.detach(gun, 'optic')).toBe(true);
    expect(m.detach(gun, 'muzzle')).toBe(true);
    expect(m.get(gun)!.attachments).toBeUndefined();
    expect(count()).toBe(total);
    expect(m.detach(gun, 'optic')).toBe(false);
  });

  it('rejects incompatible attachments and non-guns', () => {
    const m = inv(), gun = uid(m, 'ak47');
    expect(compatibleSlot('ak47', 'suppressor_pistol')).toBeNull();
    expect(m.attach(gun, uid(m, 'suppressor_pistol'))).toBe(false);
    expect(m.get(gun)!.attachments).toBeUndefined();
    expect(m.attach(uid(m, 'red_dot'), uid(m, 'scope_4x'))).toBe(false);
    expect(compatibleSlot('shotgun', 'red_dot')).toBeNull();
  });

  it('cannot take an attachment off into a full backpack', () => {
    const m = inv(), gun = uid(m, 'ak47');
    m.attach(gun, uid(m, 'scope_4x'));
    while (m.add('medkit')) { /* fill every free cell */ }
    expect(m.detach(gun, 'optic')).toBe(false);
    expect(m.get(gun)!.attachments).toEqual({ optic: 'scope_4x' });
  });

  it('persists through save/load and drops tampered entries', () => {
    const m = inv(), gun = uid(m, 'ak47');
    m.attach(gun, uid(m, 'red_dot'));
    const loaded = new InventoryModel(m.toJSON());
    expect(loaded.get(gun)!.attachments).toEqual({ optic: 'red_dot' });
    expect(sanitizeAttachments('ak47', { optic: 'scope_10x', muzzle: 'suppressor_rifle', junk: 'x' })).toEqual({ muzzle: 'suppressor_rifle' });
    expect(new InventoryModel({ items: [{ ...m.get(gun)!, attachments: { optic: 'nope' } }], equipped: null }).items[0]!.attachments).toBeUndefined();
  });

  it('packs into one snapshot byte', () => {
    for (const a of [{}, { optic: 'nv_scope_6x' }, { muzzle: 'suppressor_rifle' }, { optic: 'scope_10x', muzzle: 'suppressor_pistol' }]) expect(unpackAttachments(packAttachments(a))).toEqual(a);
  });
});

describe('zeroing', () => {
  it('a shot from muzzle height crosses the eye-level sight line at the zero distance', async () => {
    const { zeroedDirection, advanceBallistic } = await import('./ballistics');
    const speed = 620, gravity = 9.81, distance = 100, muzzleY = 1.35, eyeY = 1.62;
    const [dx, dy, dz] = zeroedDirection(0, 0, -1, muzzleY, eyeY, distance, speed, gravity);
    const r = { x: 0, y: muzzleY, z: 0, vx: dx * speed, vy: dy * speed, vz: dz * speed };
    while (-r.z < distance) advanceBallistic(r, gravity, 0, 1 / 600);
    expect(Math.abs(r.y - eyeY)).toBeLessThan(.03);
    expect(Math.abs(r.x)).toBeLessThan(1e-9);
  });
});
