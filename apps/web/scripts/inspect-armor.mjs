/** Renders armour pieces worn by the survivor (upper body only, enlarged) → .tmp-rig/armor.json for render-raw.py.
 * Usage (repo root): tsx apps/web/scripts/inspect-armor.mjs [loadout …] where a loadout is head,face,ears,chest ids (e.g. 34,0,0,64). */
import { readFile, writeFile } from 'node:fs/promises';
import { Color, Mesh, Vector3 } from 'three';
import { EntityFlags } from '@zion/shared';
/** A GLB without any textures (Node cannot decode images): every texture reference removed. */
function untextured(buf) {
  const len = buf.readUInt32LE(12), json = JSON.parse(buf.subarray(20, 20 + len).toString('utf8'));
  const strip = (o) => { if (!o || typeof o !== 'object') return; for (const k of Object.keys(o)) { if (/Texture$/.test(k) || k === 'KHR_texture_transform') delete o[k]; else strip(o[k]); } };
  for (const m of json.materials ?? []) strip(m);
  delete json.textures; delete json.images; delete json.samplers;
  let text = Buffer.from(JSON.stringify(json)); text = Buffer.concat([text, Buffer.alloc((4 - text.length % 4) % 4, 0x20)]);
  const rest = buf.subarray(20 + len), head = Buffer.alloc(20);
  head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(20 + text.length + rest.length, 8); head.writeUInt32LE(text.length, 12); head.writeUInt32LE(0x4e4f534a, 16);
  const out = Buffer.concat([head, text, rest]); return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
}
globalThis.fetch = async (url) => {
  const path = String(url).split('?')[0];
  if (path.endsWith('manifest.json')) return new Response('', { status: 404 });
  const buf = await readFile(`apps/web/public${path}`);
  return new Response(path.endsWith('.glb') ? untextured(buf) : buf);
};
const { Avatar } = await import('../src/game/render/avatars');
const { buildBBModel, mirrorCharacter, survivorTemplate } = await import('../src/game/render/character-model');
const { parseHumanAssets } = await import('../src/game/render/human-rig');
const { loadArmorPiece } = await import('../src/game/render/armor-models');
const raw = async (u) => { const d = JSON.parse(await readFile(u, 'utf8')); d.textures = []; return buildBBModel(d); };
const glb = await readFile('models/characters/zion-survivor.glb');
const human = await parseHumanAssets(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength));
const template = survivorTemplate(mirrorCharacter(await raw('models/characters/teen-wasteland-survivor.bbmodel')), human);
const loadouts = process.argv.slice(2).length ? process.argv.slice(2) : ['30,0,0,61', '31,40,0,60', '32,0,50,62', '33,41,0,63', '34,0,0,64', '35,44,0,65', '0,45,0,0', '0,42,50,0', '0,43,0,0'];
const out = [];
for (const l of loadouts) {
  const [head, face, ears, chest] = l.split(',').map(Number);
  const av = new Avatar(template, true);
  for (const [slot, id] of Object.entries({ head, face, ears, chest })) av.setArmor(slot, id ? await loadArmorPiece(id) : null);
  for (let i = 0; i < 40; i++) { av.update(0, 0, process.env.WALK ? -i * 6 / 60 : 0, 0, EntityFlags.Grounded | (process.env.WALK ? EntityFlags.Sprinting : 0), 1 / 60, i / 60); av.root.updateMatrixWorld(true); }
  const meshes = [];
  av.root.traverse((o) => {
    if (!(o instanceof Mesh) || !o.visible) return;
    for (let p = o.parent; p; p = p.parent) if (!p.visible) return;
    const g = o.geometry, n = g.getAttribute('position').count, c = g.getAttribute('color');
    const m = Array.isArray(o.material) ? o.material[0] : o.material, armor = (() => { for (let p = o.parent; p; p = p.parent) if (p.name.startsWith('armor-')) return true; return false; })();
    const tint = armor ? new Color(.75, .62, .3) : m.color ?? new Color(.5, .5, .5);
    const positions = [], colors = [], v = new Vector3();
    for (let i = 0; i < n; i++) {
      o.getVertexPosition(i, v).applyMatrix4(o.matrixWorld).sub(av.root.position); positions.push([v.x * 2, (v.y - 1.45) * 2 + 1, v.z * 2]);
      const col = !armor && c ? new Color(c.getX(i), c.getY(i), c.getZ(i)).multiply(tint) : tint.clone(); colors.push(col.toArray());
    }
    const all = g.index ? Array.from(g.index.array) : Array.from({ length: n }, (_, i) => i), indices = [];
    // Upper body only: the head and chest.
    for (let i = 0; i < all.length; i += 3) if ([0, 1, 2].every((k) => positions[all[i + k]][1] > (process.env.HEAD ? 1.65 : .55) && positions[all[i + k]][1] < (process.env.HEAD ? 9 : 1.9))) indices.push(all[i], all[i + 1], all[i + 2]);
    // Only the vertices kept (the renderer frames all the positions it is given).
    const map = new Map(), P = [], C = [], I = indices.map((j) => { if (!map.has(j)) { map.set(j, P.length); P.push(positions[j]); C.push(colors[j]); } return map.get(j); });
    if (I.length) meshes.push({ name: o.name, positions: P, colors: C, indices: I });
  });
  out.push({ label: l, meshes });
}
await writeFile('.tmp-rig/armor.json', JSON.stringify(out));
console.log('wrote', out.length);
