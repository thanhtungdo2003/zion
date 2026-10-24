import fs from 'node:fs/promises';
import { Box3, Mesh, Color, SkinnedMesh, Vector3 } from 'three';
import { parseZombieModel, ZOMBIE_MODEL_URLS } from '../src/game/render/zombie-model.ts';
import { untexturedGlb } from '../src/game/render/test-glb.ts';
import { ZombieAvatar } from '../src/game/render/zombie-avatar.ts';
import { EntityFlags } from '@zion/shared';
const poses = [];
for (let index = 0; index < ZOMBIE_MODEL_URLS.length; index++) {
  const bytes = await fs.readFile(`models${ZOMBIE_MODEL_URLS[index].slice('/models'.length)}`);
  const template = await parseZombieModel(untexturedGlb(bytes));
  const height = o => new Box3().setFromObject(o, true).getSize(new Vector3()).y;
  const avatar = new ZombieAvatar(template, () => {}, index === 10 ? 1.5 : 1, index === 10 ? 2 : index === 11 ? 3 : 0);
  avatar.seen = true; avatar.ground = () => 0;
  console.log(index, 'height template/clone', height(template.root), height(avatar.root));
  for (let i = 0; i < 35; i++) avatar.update(0, 0, -i * .025, 0, EntityFlags.Grounded, 0, 1 / 60);
  console.log(index, 'animated',height(avatar.root));
  avatar.root.updateMatrixWorld(true);
  avatar.root.traverse(o => { if (o instanceof SkinnedMesh) o.skeleton.update(); });
  const meshes = [];
  avatar.root.traverse(o => {
    if (!(o instanceof Mesh) || !o.visible) return;
    const geometry = o.geometry, count = geometry.getAttribute('position').count, positions = [], colors = [];
    const attribute = geometry.getAttribute('color'); const material = Array.isArray(o.material) ? o.material[0] : o.material;
    const tint = 'color' in material ? material.color : new Color(.55,.65,.45), v = new Vector3();
    for (let i = 0; i < count; i++) {
      o.getVertexPosition(i,v).applyMatrix4(o.matrixWorld).sub(avatar.root.position); positions.push(v.toArray());
      const c = attribute ? new Color(attribute.getX(i),attribute.getY(i),attribute.getZ(i)).multiply(tint) : tint.clone();c.convertLinearToSRGB();colors.push(c.toArray());
    }
    meshes.push({ name:o.name,positions,colors,indices:geometry.index ? Array.from(geometry.index.array) : Array.from({length:count},(_,i)=>i) });
  });
  poses.push({ label:index===10?'Hunter':index===11?'Dog':`Zombie ${index+1}`,meshes,focus:[0,1,0] });
}
await fs.mkdir('.tmp-zombies',{recursive:true});
await fs.writeFile('.tmp-zombies/poses.json',JSON.stringify(poses));
