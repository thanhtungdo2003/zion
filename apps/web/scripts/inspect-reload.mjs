/** First-person reloads (GUN / GUN_FILE env) at several moments → .tmp-rig/poses-fp.json (render-rig.py --first-person). */
import { readFile, writeFile } from 'node:fs/promises';
import { Color, Mesh, PerspectiveCamera, SkinnedMesh, Vector3 } from 'three';
import { buildBBModel, mirrorCharacter, survivorTemplate } from '../src/game/render/character-model';
import { parseHumanAssets } from '../src/game/render/human-rig';
import { builtinWeaponVisual, fittedSpec, heldWeaponVisual } from '../src/game/render/weapons';
import { ViewModel } from '../src/game/render/viewmodel';
import { untexturedGlb } from '../src/game/render/test-glb';
const raw = async (u) => { const d = JSON.parse(await readFile(u, 'utf8')); d.textures = []; return buildBBModel(d); };
const human = await parseHumanAssets(untexturedGlb(await readFile('models/characters/zion-survivor.glb')));
const template = survivorTemplate(mirrorCharacter(await raw('models/characters/teen-wasteland-survivor.bbmodel')), human);
const id = process.env.GUN ?? 'ak47', t = await raw(process.env.GUN_FILE ?? 'models/weapons/ak47-rifle.bbmodel');
const vis = heldWeaponVisual(id, fittedSpec(builtinWeaponVisual(id), t), t, template);
const out = [];
for (const at of (process.env.AT ?? '0.12,0.35,0.55,0.8').split(',').map(Number)) {
  const camera = new PerspectiveCamera(75, 1, .02, 100), view = new ViewModel(camera);
  view.setBody(human); view.set(id, new Map([[id, vis]]));
  for (let i = 0; i < 30; i++) view.update(1 / 60, { visible: true, moving: false, sprint: false, reloading: false, yaw: 0, pitch: 0 });
  view.reload(3);
  for (let i = 0, n = Math.round(at * 3 * 60); i < n; i++) view.update(1 / 60, { visible: true, moving: false, sprint: false, reloading: true, yaw: 0, pitch: 0 });
  camera.updateMatrixWorld(true);
  camera.traverse((o) => { if (o instanceof SkinnedMesh) o.skeleton.update(); });
  const meshes = [];
  camera.traverse((o) => {
    if (!(o instanceof Mesh) || !o.visible) return;
    for (let p = o.parent; p; p = p.parent) if (!p.visible) return;
    const g = o.geometry, n = g.getAttribute('position').count, c = g.getAttribute('color');
    const m = Array.isArray(o.material) ? o.material[0] : o.material, tint = m.color ?? new Color(.5, .5, .5);
    const positions = [], colors = [], v = new Vector3();
    for (let i = 0; i < n; i++) { o.getVertexPosition(i, v).applyMatrix4(o.matrixWorld); positions.push(v.toArray()); const col = c ? new Color(c.getX(i), c.getY(i), c.getZ(i)).multiply(tint) : tint.clone(); col.convertLinearToSRGB(); colors.push(col.toArray()); }
    meshes.push({ name: o.name, positions, colors, indices: g.index ? Array.from(g.index.array) : Array.from({ length: n }, (_, i) => i) });
  });
  out.push({ label: `${id} ${at}`, meshes });
  view.dispose();
}
await writeFile('.tmp-rig/poses-fp.json', JSON.stringify(out));
console.log('wrote', out.length);
