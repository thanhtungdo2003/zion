/** Renders the camp guard dressed as the modelled soldier, standing and walking → .tmp-rig/guard.json for render-raw.py. */
import { readFile, writeFile } from 'node:fs/promises';
import { Mesh, Vector3 } from 'three';
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
const { dressGuardAsSoldier, prepareGuardModel } = await import('../src/game/render/guard-model');
const raw = async (u) => { const d = JSON.parse(await readFile(u, 'utf8')); d.textures = []; return buildBBModel(d); };
const glb = await readFile('models/characters/zion-survivor.glb');
const human = await parseHumanAssets(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength));
const template = survivorTemplate(mirrorCharacter(await raw('models/characters/teen-wasteland-survivor.bbmodel')), human);
const guard = await dressGuardAsSoldier(prepareGuardModel(mirrorCharacter(await raw('models/npcs/armored-soldier.bbmodel')), template));
const out = [];
for (const [label, vz] of [['idle', 0], ['walk', -1.6], ['run', -4]]) {
  const av = new Avatar(guard, false);
  let z = 0;
  for (let i = 0; i < 40; i++) { z += vz / 60; av.update(0, 0, z, 0, EntityFlags.Grounded, 1 / 60, i / 60); av.root.updateMatrixWorld(true); }
  const meshes = [];
  av.root.traverse((o) => {
    if (!(o instanceof Mesh) || !o.visible) return;
    for (let p = o.parent; p; p = p.parent) if (!p.visible) return;
    const g = o.geometry, n = g.getAttribute('position').count, positions = [], colors = [], v = new Vector3();
    const tint = { 'soldier-head': [.8, .7, .5], 'soldier-body': [.45, .55, .4], 'soldier-leg_left': [.5, .4, .6], 'soldier-leg_right': [.4, .5, .7] }[o.name] ?? [.6, .6, .6];
    for (let i = 0; i < n; i++) { o.getVertexPosition(i, v).applyMatrix4(o.matrixWorld).sub(av.root.position); positions.push(v.toArray()); colors.push(tint); }
    meshes.push({ name: o.name, positions, colors, indices: g.index ? Array.from(g.index.array) : Array.from({ length: n }, (_, i) => i) });
  });
  out.push({ label, meshes });
}
await writeFile('.tmp-rig/guard.json', JSON.stringify(out));
console.log('wrote', out.length);
