import { describe, expect, it } from 'vitest';
import { BoxGeometry, Group, Matrix4, Mesh, MeshBasicMaterial, Scene, Vector3, type InstancedMesh } from 'three';
import type { CollisionWorld, RayHit } from '@zion/physics';
import { SpentBrass } from './spent-brass';

/** Flat ground at y = 0. */
const ground = {
  raycast(x: number, y: number, z: number, dx: number, dy: number, dz: number, len: number, _mask: number, hit: RayHit): boolean {
    if (dy >= 0 || y < 0) return false;
    const t = -y / dy;
    if (t > len) return false;
    Object.assign(hit, { t, x: x + dx * t, y: 0, z: z + dz * t, nx: 0, ny: 1, nz: 0 });
    return true;
  },
} as unknown as CollisionWorld;

describe('spent cases and dropped magazines', () => {
  it('keeps at most a few cases per shooter, the oldest going first', () => {
    const brass = new SpentBrass(new Scene());
    for (let i = 0; i < 40; i++) brass.eject(1, new Vector3(0, 1.4, 0), new Vector3(1, 0, 0), new Vector3(0, 0, -1));
    for (let i = 0; i < 5; i++) brass.eject(2, new Vector3(0, 1.4, 0), new Vector3(1, 0, 0), new Vector3(0, 0, -1));
    expect(brass.casesOf(1)).toBe(24);
    expect(brass.casesOf(2)).toBe(5);
  });

  it('a case flies out to the right, falls and comes to rest on the ground', () => {
    const scene = new Scene(), brass = new SpentBrass(scene);
    let clinks = 0;
    brass.onClink = () => { clinks++; };
    brass.eject(1, new Vector3(0, 1.4, 0), new Vector3(1, 0, 0), new Vector3(0, 0, -1));
    for (let i = 0; i < 300; i++) brass.update(1 / 60, ground);
    expect(clinks).toBeGreaterThan(0);
    const mesh = scene.children.find((o) => o.name === 'spent-cases') as InstancedMesh;
    const m = new Matrix4(), p = new Vector3();
    mesh.getMatrixAt(0, m);
    p.setFromMatrixPosition(m);
    expect(p.x).toBeGreaterThan(.3);
    // It grips the ground: no long slide past where it lands (about 1.5 m out from the port).
    expect(p.x).toBeLessThan(2.4);
    expect(p.y).toBeGreaterThan(0); expect(p.y).toBeLessThan(.02);
  });

  it('a dropped magazine falls from where it left the gun and lies on the ground; old ones are recycled', () => {
    const scene = new Scene(), brass = new SpentBrass(scene);
    const gun = new Group(); scene.add(gun);
    const mag = new Mesh(new BoxGeometry(.03, .2, .08), new MeshBasicMaterial()); mag.position.set(0, 1.2, 0); gun.add(mag);
    for (let i = 0; i < 8; i++) brass.dropMagazine(mag);
    expect(brass.counts.mags).toBe(6);
    for (let i = 0; i < 400; i++) brass.update(1 / 60, ground);
    const lying = scene.children.filter((o) => o instanceof Group && o !== gun);
    expect(lying.length).toBe(6);
    for (const g of lying) { expect(g.position.y).toBeGreaterThan(0); expect(g.position.y).toBeLessThan(.03); }
  });
});
