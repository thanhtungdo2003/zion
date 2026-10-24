// Bake surface-based clothing weights and skin coverage once, outside the render/loading path.
// Run with tsx --tsconfig apps/web/tsconfig.json apps/web/scripts/prepare-character-skin.mjs.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { parseHumanAssets } from '../src/game/render/human-rig.ts';

const file = path.resolve(import.meta.dirname, '../../../models/characters/zion-survivor.glb');
const source = await readFile(file), jsonLength = source.readUInt32LE(12);
const json = JSON.parse(source.subarray(20, 20 + jsonLength));
const binary = Buffer.from(source.subarray(28 + jsonLength));
const assets = await parseHumanAssets(source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength), { rebuildSkin: true });
const mesh = json.meshes.find(m => m.extras?.slot === 'top');
if (!mesh || mesh.primitives.length !== 1) throw new Error('Expected one prepared top primitive');
const primitive = mesh.primitives[0], geometry = assets.parts.get('top').geometry;
const joints = geometry.getAttribute('skinIndex'), weights = geometry.getAttribute('skinWeight');
function writeAttribute(accessorId, values) {
  const accessor = json.accessors[accessorId], view = json.bufferViews[accessor.bufferView];
  if (accessor.componentType !== 5121 || accessor.count * 4 !== values.length) throw new Error('Expected packed four-channel byte attribute');
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  for (let i = 0; i < accessor.count; i++) for (let k = 0; k < 4; k++) binary[start + i * (view.byteStride ?? 4) + k] = values[i * 4 + k];
}
const packedJoints = [], packedWeights = [];
for (let i = 0; i < joints.count; i++) {
  const w = [0, 1, 2, 3].map(k => weights.getComponent(i, k));
  const total = w.reduce((sum, value) => sum + value, 0) || 1;
  const quantized = w.map(value => Math.round(value / total * 255));
  const largest = w.indexOf(Math.max(...w)); quantized[largest] += 255 - quantized.reduce((sum, value) => sum + value, 0);
  for (let k = 0; k < 4; k++) { packedJoints.push(joints.getComponent(i, k)); packedWeights.push(quantized[k]); }
}
writeAttribute(primitive.attributes.JOINTS_0, packedJoints);
writeAttribute(primitive.attributes.WEIGHTS_0, packedWeights);
const body = assets.parts.get('body').geometry, index = body.getIndex();
const hidden = {};
for (const kind of ['bare', 'top']) {
  const visible = assets.bodies[kind].getIndex(), kept = new Set();
  for (let t = 0; t < visible.count; t += 3) kept.add(`${visible.getX(t)},${visible.getX(t + 1)},${visible.getX(t + 2)}`);
  const mask = Buffer.alloc(index.count / 3);
  for (let t = 0; t < index.count; t += 3) mask[t / 3] = kept.has(`${index.getX(t)},${index.getX(t + 1)},${index.getX(t + 2)}`) ? 0 : 1;
  hidden[kind] = mask.toString('base64');
  console.log(`${kind}: ${mask.reduce((sum, value) => sum + value, 0)} covered body triangles`);
}
json.extras ??= {};
json.extras.zion_skin = { version: 1, method: 'rest-surface-barycentric', hidden,
  topology: createHash('sha256').update(Buffer.from(index.array.buffer, index.array.byteOffset, index.array.byteLength)).digest('hex') };
let text = Buffer.from(JSON.stringify(json)); text = Buffer.concat([text, Buffer.alloc((4 - text.length % 4) % 4, 32)]);
const header = Buffer.alloc(20), chunk = Buffer.alloc(8);
header.writeUInt32LE(0x46546c67); header.writeUInt32LE(2, 4); header.writeUInt32LE(28 + text.length + binary.length, 8);
header.writeUInt32LE(text.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
chunk.writeUInt32LE(binary.length); chunk.writeUInt32LE(0x004e4942, 4);
await writeFile(file, Buffer.concat([header, text, chunk, binary]));
console.log(`Prepared cloth skin and coverage: ${joints.count} vertices; animation tracks retained`);
