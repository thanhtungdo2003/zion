import { BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshLambertMaterial, type Object3D } from 'three';
import { createDefaultRegistry } from '@zion/assets';
import type { InfectionMapDef } from '@zion/shared';
import type { InfectionMapPreview } from '@/lib/api';
import { AssetLibrary } from '@/game/render/asset-library';

/**
 * The whole Infection map in 3D for the Studio: the ground from the server's preview heights
 * (grass tinted), the base map (the Warehouse model or The Street), the wall, the seeded nature and
 * every hand-placed part, each with its real model at its real height.
 */
export async function buildInfectionMapScene(preview: InfectionMapPreview, draft: InfectionMapDef): Promise<Object3D> {
  const root = new Group();
  const { size, step, origin, heights, grass } = preview;
  const at = (x: number, z: number) => {
    const i = Math.max(0, Math.min(size - 1, Math.round((x - origin) / step))), j = Math.max(0, Math.min(size - 1, Math.round((z - origin) / step)));
    return heights[j * size + i] ?? 0;
  };
  // Ground: one vertex per preview sample.
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    pos.push(origin + i * step, heights[j * size + i]!, origin + j * step);
    const g = grass[j * size + i] ? [.36, .5, .27] : [.45, .41, .35];
    col.push(...g);
  }
  for (let j = 0; j < size - 1; j++) for (let i = 0; i < size - 1; i++) {
    const a = j * size + i, b = a + 1, c = a + size, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const ground = new BufferGeometry();
  ground.setAttribute('position', new Float32BufferAttribute(pos, 3));
  ground.setAttribute('color', new Float32BufferAttribute(col, 3));
  ground.setIndex(idx);
  ground.computeVertexNormals();
  root.add(new Mesh(ground, new MeshLambertMaterial({ vertexColors: true })));
  // Models: base, wall, nature (world heights from the server) and the placed parts.
  const placed = [
    ...preview.base, ...preview.wall, ...preview.nature,
    ...draft.parts.map((p) => ({ asset: p.asset, x: p.x, z: p.z, y: at(p.x, p.z) + p.y, yaw: p.yaw, scale: p.scale })),
  ];
  const library = new AssetLibrary(createDefaultRegistry());
  const visuals = new Map(await Promise.all([...new Set(placed.map((p) => p.asset))].map(async (a) => [a, await library.load(a)?.catch(() => undefined)] as const)));
  for (const p of placed) {
    const v = visuals.get(p.asset);
    if (!v) continue;
    const g = new Group();
    for (const part of v.parts) g.add(new Mesh(part.geometry, part.material));
    g.position.set(p.x, p.y, p.z);
    g.rotation.y = p.yaw;
    g.scale.setScalar(p.scale);
    root.add(g);
  }
  return root;
}
