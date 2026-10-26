import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { Box3, Matrix4, Mesh, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { BB_UNITS_PER_METER, sampleTrack } from './character-model';
import { buildTransportPlane, TRANSPORT_PLANE_LENGTH } from './transport-plane';
import { untexturedGlb } from './test-glb';

describe('Il-38 transport plane', () => {
  it('enlarges the real GLB and spins four independent propellers about their hubs', async () => {
    const bytes = await readFile(new URL('../../../public/models/dists/il-38.glb', import.meta.url));
    const { scene } = await new GLTFLoader().parseAsync(untexturedGlb(bytes), '');
    scene.updateMatrixWorld(true);
    const before = new Map<string, Matrix4>();
    scene.traverse((o) => { if (o instanceof Mesh) before.set(o.name, o.matrixWorld.clone()); });
    const template = buildTransportPlane(scene);
    // Building pivots must preserve the original model, including every rotor's position.
    scene.updateMatrixWorld(true);
    const inverse = scene.matrixWorld.clone().invert();
    scene.traverse((o) => {
      if (!(o instanceof Mesh)) return;
      const matrix = new Matrix4().multiplyMatrices(inverse, o.matrixWorld);
      matrix.elements.forEach((v, i) => expect(v).toBeCloseTo(before.get(o.name)!.elements[i]!, 6));
    });
    const body = scene.getObjectByName('Object_4')!;
    expect(body.parent!.name).toBe('_0');
    expect(template.boneNames).toHaveLength(4);
    const root = template.root.clone(true);
    root.scale.setScalar(BB_UNITS_PER_METER / 1.5);
    expect(new Box3().setFromObject(root).getSize(new Vector3()).z).toBeCloseTo(TRANSPORT_PLANE_LENGTH, 4);
    const bodyBox = new Box3().setFromObject(root.getObjectByName('Object_4')!);
    const vec: [number, number, number] = [0, 0, 0];
    for (const name of template.boneNames) {
      const pivot = root.getObjectByName(name)!;
      const mesh = pivot.children[0]!;
      const box = new Box3().setFromObject(mesh), hub = pivot.getWorldPosition(new Vector3());
      expect(box.getCenter(new Vector3()).distanceTo(hub)).toBeLessThan(1e-4);
      const track = template.clips.get('propellers_spin')!.bones.get(name)!.rotation!;
      sampleTrack(track, .05, vec);
      expect(vec[2]).toBeCloseTo(90);
      pivot.rotation.set(...vec.map((v) => v * Math.PI / 180) as [number, number, number]);
      const turned = new Box3().setFromObject(mesh);
      expect(turned.getCenter(new Vector3()).distanceTo(hub)).toBeLessThan(1e-4);
      expect(turned.getSize(new Vector3()).z).toBeCloseTo(box.getSize(new Vector3()).z, 5);
    }
    expect(new Box3().setFromObject(root.getObjectByName('Object_4')!).equals(bodyBox)).toBe(true);
    // A second aircraft clone keeps its own rotor angles.
    expect(template.root.getObjectByName(template.boneNames[0]!)!.rotation.z).toBe(0);
  });
});
