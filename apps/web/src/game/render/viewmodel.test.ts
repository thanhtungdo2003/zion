import { describe, expect, it } from 'vitest';
import { Group, PerspectiveCamera, Vector3 } from 'three';
import { ViewModel } from './viewmodel';
import type { WeaponLibrary } from './weapons';

function fixture() {
  const camera = new PerspectiveCamera();
  camera.position.set(9, 3, -7);
  camera.rotation.set(0.4, 1.2, 0.2);
  const display = new Group();
  const muzzle = new Group();
  muzzle.name = 'weapon-muzzle';
  muzzle.position.set(0.7, 0.08, 0);
  display.add(muzzle);
  const view = new ViewModel(camera);
  view.set('test', new Map([['test', { display }]]) as unknown as WeaponLibrary);
  const state = { visible: true, moving: false, sprint: false, reloading: false, yaw: 1.2, pitch: 0.4, firing: false };
  return { camera, view, state };
}

describe('first person weapon', () => {
  it('keeps a heavy swing moving after a normal swing has recovered, then returns to rest', () => {
    const heavy = fixture(), normal = fixture(), idle = fixture();
    heavy.view.swing(1, 1100);
    normal.view.swing(1);
    const marker = (f: ReturnType<typeof fixture>) => f.camera.getObjectByName('weapon-muzzle')!.getWorldPosition(new Vector3());
    for (let i = 0; i < 36; i++) for (const f of [heavy, normal, idle]) f.view.update(1 / 60, f.state);
    expect(marker(normal).distanceTo(marker(idle))).toBeLessThan(1e-8);
    expect(marker(heavy).distanceTo(marker(idle))).toBeGreaterThan(.1);
    for (let i = 0; i < 36; i++) for (const f of [heavy, normal, idle]) f.view.update(1 / 60, f.state);
    expect(marker(heavy).distanceTo(marker(idle))).toBeLessThan(1e-8);
  });
  it('tracks the real display muzzle through camera and recoil transforms', () => {
    const { camera, view, state } = fixture();
    view.kick();
    view.update(1 / 60, state);
    const at = new Vector3();
    expect(view.weaponPoint('muzzle', at)).toBe(true);
    const rendered = camera.getObjectByName('weapon-muzzle')!.getWorldPosition(new Vector3());
    expect(at.distanceTo(rendered)).toBeLessThan(1e-8);
    expect(view.weaponPoint('eject', at)).toBe(false);
  });

  it('centres the gun while firing and converges the barrel on the target', () => {
    const { camera, view, state } = fixture();
    const target = camera.localToWorld(new Vector3(0, 0, -12));
    for (let i = 0; i < 90; i++) {
      view.update(1 / 60, { ...state, firing: true });
      view.aimAt(target);
    }
    const marker = camera.getObjectByName('weapon-muzzle')!;
    const model = marker.parent!;
    const at = marker.getWorldPosition(new Vector3());
    const barrel = new Vector3(1, 0, 0).transformDirection(model.matrixWorld);
    expect(barrel.dot(target.clone().sub(at).normalize())).toBeGreaterThan(0.99999);
    const root = model.parent!.parent!;
    expect(Math.abs(root.position.x)).toBeLessThan(0.001);
    for (let i = 0; i < 90; i++) view.update(1 / 60, state);
    expect(root.position.x).toBeCloseTo(0.2, 3);
  });

  it('hides muzzle effects with the view model and lowers the weapon to reload', () => {
    const { view, state, camera } = fixture();
    for (let i = 0; i < 90; i++) view.update(1 / 60, { ...state, firing: true, reloading: true });
    const root = camera.children[0]!;
    expect(root.position.x).toBeCloseTo(0.2, 3);
    expect(root.position.y).toBeLessThan(-0.3);
    view.update(0, { ...state, visible: false });
    expect(view.weaponPoint('muzzle', new Vector3())).toBe(false);
    view.dispose();
    expect(camera.children).toHaveLength(0);
  });

  it('retains upward muzzle recoil while converging on the crosshair during automatic fire', () => {
    const { camera, view, state } = fixture();
    const target = camera.localToWorld(new Vector3(0, 0, -12));
    const barrelDirection = () => {
      const model = camera.getObjectByName('weapon-muzzle')!.parent!;
      model.updateWorldMatrix(true, false);
      return new Vector3(1, 0, 0).transformDirection(model.matrixWorld).applyQuaternion(camera.quaternion.clone().invert());
    };
    for (let frame = 0; frame < 90; frame++) {
      view.update(1 / 60, { ...state, firing: true }); view.aimAt(target);
    }
    const resting = barrelDirection().y;
    view.kick();
    for (let frame = 0; frame < 3; frame++) {
      view.update(1 / 60, { ...state, firing: true }); view.aimAt(target);
    }
    expect(barrelDirection().y).toBeGreaterThan(resting + .03);
    for (let frame = 0; frame < 120; frame++) {
      view.update(1 / 60, { ...state, firing: true }); view.aimAt(target);
    }
    expect(barrelDirection().y).toBeCloseTo(resting, 6);
  });
});
