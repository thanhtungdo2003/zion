/** The infection-mode zombie model playing the survivor's clips → .tmp-rig/infected.json. */
import { readFile, writeFile } from 'node:fs/promises';
import { Color, Mesh, Vector3 } from 'three';
import { DEFAULT_APPEARANCE, EntityFlags } from '@zion/shared';
import { untexturedGlb } from '../src/game/render/test-glb';
globalThis.fetch = async (url) => {
  const path = String(url).split('?')[0];
  if (path.endsWith('manifest.json')) return new Response('', { status: 404 });
  const buf = await readFile(`apps/web/public${path}`);
  return new Response(path.endsWith('.glb') ? untexturedGlb(buf) : buf);
};
const { Avatar } = await import('../src/game/render/avatars');
const { buildBBModel, mirrorCharacter, survivorTemplate } = await import('../src/game/render/character-model');
const { parseHumanAssets } = await import('../src/game/render/human-rig');
const raw = async (u) => { const d = JSON.parse(await readFile(u, 'utf8')); d.textures = []; return buildBBModel(d); };
const glb = await readFile('models/characters/zion-survivor.glb');
const human = await parseHumanAssets(untexturedGlb(glb));
const template = survivorTemplate(mirrorCharacter(await raw('models/characters/teen-wasteland-survivor.bbmodel')), human);
const out = [];
for (const [label, speed, flags, colour] of [['stand', 0, 0, 0], ['walk', 1.6, 0, 3], ['run', 5, EntityFlags.Sprinting, 1], ['crouch', 0, EntityFlags.Crouching, 4]]) {
  const av = new Avatar(template, true);
  av.setAppearance?.({ ...DEFAULT_APPEARANCE, pantsColor: colour }); av.setInfected(true);
  let z = 0;
  for (let i = 0; i < 50; i++) { z -= speed / 60; av.update(0, 0, z, Math.PI, EntityFlags.Grounded | flags, 1 / 60, i / 60); av.root.updateMatrixWorld(true); }
  const meshes = [];
  av.root.traverse((o) => {
    if (!(o instanceof Mesh) || !o.visible) return;
    for (let p = o.parent; p; p = p.parent) if (!p.visible) return;
    const g = o.geometry, n = g.getAttribute('position').count, c = g.getAttribute('color');
    const m = Array.isArray(o.material) ? o.material[0] : o.material, tint = m.color ?? new Color(.5, .5, .5);
    const positions = [], colors = [], v = new Vector3();
    for (let i = 0; i < n; i++) { o.getVertexPosition(i, v).applyMatrix4(o.matrixWorld).sub(av.root.position); positions.push(v.toArray()); const col = c ? new Color(c.getX(i), c.getY(i), c.getZ(i)).multiply(tint) : tint.clone(); col.convertLinearToSRGB(); colors.push(col.toArray()); }
    meshes.push({ positions, colors, indices: g.index ? Array.from(g.index.array) : positions.map((_, i) => i) });
  });
  out.push({ label, meshes });
}
await writeFile('.tmp-rig/infected.json', JSON.stringify(out));
console.log('wrote', out.length);
