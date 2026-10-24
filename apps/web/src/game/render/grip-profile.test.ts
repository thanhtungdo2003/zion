import { describe, expect, it } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Quaternion, Vector3 } from 'three';
import { fitGripProfile, rifleStockContact } from './grip-profile';
import type { Grasp } from './human-rig';
import { buildBBModel, type ModelWeaponFitting, type RawModel } from './character-model';
import { builtinWeaponVisual, fittedSpec } from './weapons';

describe('handle surface fitting', () => {
  it('measures the stock comb behind the grip and keeps its fit after world movement', () => {
    const stock = new Group(), mesh = new Mesh(new BoxGeometry(.04, .06, .2));
    mesh.position.set(0, .01, .12); stock.add(mesh);
    const point = () => rifleStockContact(stock, new Vector3(), new Vector3(0, 0, -1), new Vector3(0, 1, 0), 1)!;
    const first = point();
    expect(first.x).toBeCloseTo(-.022); expect(first.y).toBeCloseTo(.048); expect(first.z).toBeCloseTo(.11);
    stock.position.set(4, 2, -6); stock.rotation.set(.2, .8, -.3);
    expect(point().distanceTo(first)).toBeLessThan(.00001);
    expect(rifleStockContact(new Group(), new Vector3(), new Vector3(0, 0, -1), new Vector3(0, 1, 0), 1)).toBeNull();
  });
  it('uses the grip/support sockets embedded in the model before the old fitting table', async () => {
    const weapon: ModelWeaponFitting = { grip: [1, -7, 2], support: [1, 3, 24], muzzle: [1, 5, 50] };
    const raw: RawModel & { zion_weapon: ModelWeaponFitting } = { resolution: { width: 16, height: 16 }, elements: [], outliner: [], textures: [], zion_weapon: weapon };
    const fitted = fittedSpec(builtinWeaponVisual('ak47')!, await buildBBModel(raw));
    expect(fitted.grip).toEqual(weapon.grip); expect(fitted.support).toEqual(weapon.support); expect(fitted.muzzle).toEqual(weapon.muzzle);
  });
  it('measures a rectangular handle and retains its surface fit after world movement', () => {
    const object = new Group();
    object.add(new Mesh(new BoxGeometry(.032, .12, .05), new MeshBasicMaterial()));
    const g: Grasp = { center: new Vector3(), axis: new Vector3(0, 1, 0), approach: new Vector3(1, 0, 0), radius: .021 };
    const first = fitGripProfile(object, g);
    expect(first.profile!.rings[2]!.radii[0]).toBeCloseTo(.016);
    expect(first.profile!.rings[2]!.radii[4]).toBeCloseTo(.025);
    object.position.set(12, 3, -4); object.rotation.set(.3, .8, -.2); object.updateMatrixWorld(true);
    const q = object.getWorldQuaternion(new Quaternion());
    const moved = fitGripProfile(object, { ...g, center: object.position.clone(), axis: g.axis.clone().applyQuaternion(q), approach: g.approach.clone().applyQuaternion(q) });
    expect(moved.profile).toBe(first.profile);
  });
});
