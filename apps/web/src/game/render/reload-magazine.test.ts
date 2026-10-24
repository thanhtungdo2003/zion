import { describe, expect, it } from 'vitest';
import { Box3, BoxGeometry, Group, Matrix4, Mesh, Vector3 } from 'three';
import { ReloadMagazine } from './reload-magazine';

describe('magazine carried during reload', () => {
  it('follows the posed palm through weapon motion, then restores the gun magazine', () => {
    const scene = new Group(), gun = new Group(), magazine = new Group();
    magazine.name = 'magazine';
    magazine.add(new Mesh(new BoxGeometry(.04, .15, .06)));
    magazine.position.set(.1, -.2, 0);
    gun.add(magazine); scene.add(gun); scene.updateMatrixWorld(true);
    const reload = new ReloadMagazine(), hand = new Matrix4().makeTranslation(-.2, 1, -.5);
    reload.update(gun, .3, hand);
    const held = scene.getObjectByName('reload-magazine-in-hand')!;
    expect(held).toBeDefined(); expect(magazine.visible).toBe(false);
    const center = () => new Box3().setFromObject(held).getCenter(new Vector3());
    expect(center().distanceTo(new Vector3(-.2, 1, -.5))).toBeLessThan(1e-6);
    gun.position.set(3, 0, 0); scene.updateMatrixWorld(true);
    hand.setPosition(-.3, .7, -.6);
    reload.update(gun, .5, hand);
    expect(center().distanceTo(new Vector3(-.3, .7, -.6))).toBeLessThan(1e-6);
    reload.update(gun, .9, hand);
    expect(magazine.visible).toBe(true);
    expect(scene.getObjectByName('reload-magazine-in-hand')).toBeUndefined();
    expect(magazine.position.toArray()).toEqual([.1, -.2, 0]);
  });

  it('cleans up the carried copy when a reload is interrupted', () => {
    const scene = new Group(), gun = new Group(), magazine = new Group();
    magazine.name = 'magazine'; magazine.add(new Mesh(new BoxGeometry(1, 1, 1)));
    gun.add(magazine); scene.add(gun); scene.updateMatrixWorld(true);
    const reload = new ReloadMagazine();
    reload.update(gun, .4, new Matrix4());
    reload.update(null, -1, null);
    expect(magazine.visible).toBe(true);
    expect(scene.getObjectByName('reload-magazine-in-hand')).toBeUndefined();
  });
});
