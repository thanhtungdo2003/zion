import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Euler, Group, Raycaster, Vector3 } from 'three';
import { fittedSpec, type WeaponSpec } from './weapons';
import { BB_UNITS_PER_METER, buildBBModel, type RawModel } from './character-model';

const table = { url: '/models/accessorys/scope-4x.bbmodel', length: 0.17, barrel: [0, 0, -1], up: [0, 1, 0], grip: [0, 0, -3.5], eye: [0, 4.5, 6.7], mountLength: 0.32 } as WeaponSpec;

describe('ModelGen accessory fitting', () => {
  it.each(['scope-2x-fixed', 'scope-4x32', 'scope-8x40', 'nv-scope-x6', 'scope-pgo7', 'scope-10x'])('%s has explicit atlas faces, an aligned lens and an unobstructed bore', async name => {
    const raw = JSON.parse(readFileSync(`models/accessorys/${name}.bbmodel`, 'utf8'));
    expect(raw.zion_attachment.barrel).toEqual([0, 0, 1]);
    expect(raw.zion_attachment.lens).toBe('lens');
    for (const e of raw.elements) {
      if (!e.name.includes(' panel ') && !e.name.startsWith('lens:')) continue;
      expect(e.box_uv).toBe(false);
      expect(Object.keys(e.faces)).toHaveLength(6);
      for (const face of Object.values(e.faces) as { uv: number[] }[]) {
        expect(face.uv.every(Number.isInteger)).toBe(true);
        face.uv.forEach((v, i) => {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(i % 2 ? raw.resolution.height : raw.resolution.width);
        });
      }
    }
    const ocular = raw.elements.filter((e: { name: string }) => e.name.startsWith('lens:lens ocular bar'));
    expect(ocular).toHaveLength(4);
    for (const e of ocular) e.origin.forEach((v: number, i: number) => expect(v).toBeCloseTo(raw.zion_attachment.eye[i], 5));
    raw.textures = [];
    const built = await buildBBModel(raw as RawModel);
    const lens = built.root.getObjectByName('lens')!;
    expect(lens).toBeDefined(); lens.visible = false;
    built.root.updateMatrixWorld(true);
    const ray = new Raycaster(new Vector3(...raw.zion_attachment.eye as [number, number, number]).multiplyScalar(1 / BB_UNITS_PER_METER), new Vector3(0, 0, 1));
    const hits = ray.intersectObject(built.root, true).filter(hit => {
      let node = hit.object;
      while (node.parent && node !== lens) node = node.parent;
      return node !== lens;
    });
    expect(hits.map(hit => hit.object.name)).toEqual([]);
  });
  it('zion_attachment replaces the table pivot, axes, eyepiece and sizes', () => {
    const spec = fittedSpec(table, {
      root: new Group(), boneNames: [], clips: new Map(),
      attachment: { barrel: [0, 0, 1], up: [0, 1, 0], grip: [0, 0, 0], eye: [0, 12, -40], length: 0.3, mountLength: 0.28, lens: 'lens' },
    });
    expect(spec.barrel).toEqual([0, 0, 1]);
    expect(spec.eye).toEqual([0, 12, -40]);
    expect(spec.mountLength).toBe(0.28);
    expect(spec.url).toBe(table.url);
  });
  it('models without metadata keep the table spec', () => {
    expect(fittedSpec(table, { root: new Group(), boneNames: [], clips: new Map() })).toBe(table);
  });
  it('the shipped 4X tube has concentric regular octagonal boundaries and a clear bore', () => {
    const raw = JSON.parse(readFileSync('models/accessorys/scope-4x32.bbmodel', 'utf8'));
    const panels = raw.elements.filter((e: { name: string }) => /^main-tube:main_tube panel \d+$/.test(e.name));
    expect(panels).toHaveLength(8);
    const center = new Vector3();
    for (const e of panels) center.add(new Vector3(...e.origin as [number, number, number]));
    center.divideScalar(8);
    const radius = 0.0127 * 320;
    const inner = radius - 0.0015 * 320;
    for (const e of panels) {
      expect(e.box_uv).toBe(false);
      expect(Object.keys(e.faces)).toHaveLength(6);
      const origin = new Vector3(...e.origin as [number, number, number]);
      expect(Math.hypot(origin.x - center.x, origin.y - center.y)).toBeCloseTo((radius + inner) / 2, 6);
      for (const x of [e.from[0], e.to[0]]) for (const y of [e.from[1], e.to[1]]) {
        const vertex = new Vector3(x, y, origin.z).sub(origin)
          .applyEuler(new Euler(...(e.rotation ?? [0, 0, 0]).map((v: number) => v * Math.PI / 180) as [number, number, number], 'ZYX'))
          .add(origin).sub(center);
        for (let k = 0; k < 8; k++) {
          expect(vertex.x * Math.cos(k * Math.PI / 4) + vertex.y * Math.sin(k * Math.PI / 4)).toBeLessThanOrEqual(radius + 1e-6);
        }
      }
      for (const face of Object.values(e.faces) as { uv: number[] }[]) expect(face.uv.every(Number.isInteger)).toBe(true);
    }
    expect(raw.zion_attachment.eye).toEqual([0, 12.8, -49.472]);
  });
});
