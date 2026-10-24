/** First-person hands on a rifle (GUN / GUN_FILE env), idle and aiming → .tmp-rig/poses-fp.json
 * (python apps/web/scripts/render-rig.py --first-person). */
import { readFile, writeFile } from 'node:fs/promises';
import { Color, Mesh, PerspectiveCamera, SkinnedMesh, Vector3 } from 'three';
import { buildBBModel, mirrorCharacter, survivorTemplate } from '../src/game/render/character-model';
import { parseHumanAssets } from '../src/game/render/human-rig';
import { builtinWeaponVisual, fittedSpec, fitToHand, standaloneVisual } from '../src/game/render/weapons';
import { ViewModel } from '../src/game/render/viewmodel';
import { untexturedGlb } from '../src/game/render/test-glb';
const raw = async (u) => { const d = JSON.parse(await readFile(u, 'utf8')); d.textures = []; return buildBBModel(d); };
const glb = await readFile('models/characters/zion-survivor.glb');
const human = await parseHumanAssets(untexturedGlb(glb));
const template = survivorTemplate(mirrorCharacter(await raw('models/characters/teen-wasteland-survivor.bbmodel')), human);
const gT = await raw(process.env.GUN_FILE ?? 'models/weapons/ak47-rifle.bbmodel'), gId = process.env.GUN ?? 'ak47', gS = fittedSpec(builtinWeaponVisual(gId), gT);
const gun = { ...standaloneVisual(gId, gS, gT.root, template), attach: fitToHand(template, gS, 'rifle', gT.root) };
const katana = gun;
const item0 = gId;
const states = [['rifle-idle', item0, false, 60], ['rifle-aim', item0, false, 60, false, true]];
const out = [];
for (const [label, item, moving, frames, swing, aiming] of states) {
  const camera = new PerspectiveCamera(75, 1, .02, 100), view = new ViewModel(camera);
  view.setBody(human); view.set(item, item ? new Map([[item, katana]]) : null);
  for (let i = 0; i < frames; i++) {
    if (swing && i === frames - 10) view.swing(0);
    view.update(1 / 60, { visible: true, moving, sprint: moving, reloading: false, yaw: 0, pitch: 0, aiming: !!aiming });
    camera.updateMatrixWorld(true);
  }
  camera.traverse((o) => { if (o instanceof SkinnedMesh) o.skeleton.update(); });
  const meshes = [];
  camera.traverse((o) => {
    if (!(o instanceof Mesh) || !o.visible) return;
    for (let p = o.parent; p; p = p.parent) if (!p.visible) return;
    const g = o.geometry, n = g.getAttribute('position').count, c = g.getAttribute('color');
    const m = Array.isArray(o.material) ? o.material[0] : o.material, tint = m.color ?? new Color(.5, .5, .5);
    const positions = [], colors = [], v = new Vector3();
    for (let i = 0; i < n; i++) {
      o.getVertexPosition(i, v).applyMatrix4(o.matrixWorld); positions.push(v.toArray());
      const col = c ? new Color(c.getX(i), c.getY(i), c.getZ(i)).multiply(tint) : tint.clone(); col.convertLinearToSRGB(); colors.push(col.toArray());
    }
    meshes.push({ name: o.name, positions, colors, indices: g.index ? Array.from(g.index.array) : Array.from({ length: n }, (_, i) => i) });
  });
  const hl = camera.getObjectByName('hand_L'); if (hl) { const v = camera.worldToLocal(hl.getWorldPosition(new Vector3())); console.log(label, 'left hand angle x', (Math.atan2(v.x, -v.z) * 57.3).toFixed(1), 'y', (Math.atan2(v.y, -v.z) * 57.3).toFixed(1)); }
  out.push({ label, meshes });
  view.dispose();
}
await writeFile('.tmp-rig/poses-fp.json', JSON.stringify(out));
console.log('wrote', out.length);
