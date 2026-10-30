// Offline: fits each drivable vehicle's collision hull to its prepared model.
// node apps/web/scripts/vehicle-hulls.mjs  →  packages/physics/src/vehicle-hulls.gen.ts
// The model (wheels, rotors and gun barrels left out) is voxelised, the inside of closed shells
// filled, and the solid cells merged into as few boxes as fit the budget, in vehicle metres.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Matrix4, Quaternion, Vector3 } from 'three';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
// kind → prepared model, its scale in the game (VEHICLES[kind].scale), and a barrel to leave out
// ([trunnion x, y, z, half width]: triangles within that of its line, centred ahead of it).
const KINDS = {
  car: ['drive_car', 1.2], jeep: ['drive_jeep', 1.5], quad: ['drive_quad', 1], grizzly: ['drive_grizzly', 1],
  t80u: ['drive_t80u', 1, [0, 1.6, -1.9, .35]], t90a: ['drive_t90a', 1, [0, 1.75, -1.5, .35]], t62a: ['drive_t62a', 1, [0, 1.8, -1.5, .35]], tank: ['drive_tank', 1, [0, 1.95, -1.8, .35]],
  marauder: ['drive_marauder', 1], mi17: ['drive_mi17', 1], z10: ['drive_z10', 1], tiger: ['drive_tiger', 1],
};
const BUDGET = 64;

function triangles(buf) {
  const n = buf.readUInt32LE(12), j = JSON.parse(buf.subarray(20, 20 + n)), bin = buf.subarray(28 + n);
  const acc = (i) => {
    const a = j.accessors[i], v = j.bufferViews[a.bufferView], c = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
    const b = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 }[a.componentType], r = { 5121: 'readUInt8', 5123: 'readUInt16LE', 5125: 'readUInt32LE', 5126: 'readFloatLE' }[a.componentType];
    const out = [];
    for (let k = 0; k < a.count; k++) for (let m = 0; m < c; m++) out.push(bin[r]((v.byteOffset ?? 0) + (a.byteOffset ?? 0) + k * (v.byteStride ?? c * b) + m * b));
    return out;
  };
  const tris = [];
  const visit = (i, parent) => {
    const nd = j.nodes[i];
    const local = nd.matrix ? new Matrix4().fromArray(nd.matrix) : new Matrix4().compose(new Vector3(...(nd.translation ?? [0, 0, 0])), new Quaternion(...(nd.rotation ?? [0, 0, 0, 1])), new Vector3(...(nd.scale ?? [1, 1, 1])));
    const w = parent.clone().multiply(local);
    if (nd.mesh !== undefined && nd.extras?.vehicleWheel === undefined && nd.extras?.vehicleRotor === undefined) for (const p of j.meshes[nd.mesh].primitives) {
      const pos = acc(p.attributes.POSITION), idx = p.indices !== undefined ? acc(p.indices) : Array.from({ length: pos.length / 3 }, (_, k) => k);
      const pt = (k) => new Vector3(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]).applyMatrix4(w).toArray();
      for (let k = 0; k + 2 < idx.length; k += 3) tris.push([pt(idx[k]), pt(idx[k + 1]), pt(idx[k + 2])]);
    }
    for (const c of nd.children ?? []) visit(c, w);
  };
  for (const i of j.scenes[j.scene ?? 0].nodes) visit(i, new Matrix4());
  return tris;
}

/** Solid boxes of a triangle soup at a cell size: surface cells, then the enclosed inside. */
function solidBoxes(tris, cell) {
  let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const t of tris) for (const p of t) for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], p[a]); max[a] = Math.max(max[a], p[a]); }
  min = min.map((v) => v - cell); max = max.map((v) => v + cell);
  const n = [0, 1, 2].map((a) => Math.ceil((max[a] - min[a]) / cell)), at = (i, j, k) => (j * n[2] + k) * n[0] + i;
  const grid = new Uint8Array(n[0] * n[1] * n[2]);
  for (const [a, b, c] of tris) {
    const len = Math.max(...[[a, b], [a, c], [b, c]].map(([p, q]) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])));
    const s = Math.max(1, Math.ceil(len / (cell * .5)));
    for (let u = 0; u <= s; u++) for (let v = 0; v <= s - u; v++) {
      const x = u / s, y = v / s, w = 1 - x - y, p = [0, 1, 2].map((d) => a[d] * w + b[d] * x + c[d] * y);
      grid[at(...[0, 1, 2].map((d) => Math.min(n[d] - 1, Math.floor((p[d] - min[d]) / cell))))] = 1;
    }
  }
  // Flood the outside from the padded border; whatever it cannot reach is inside a closed shell.
  const outside = new Uint8Array(grid.length), stack = [0];
  outside[0] = 1;
  while (stack.length) {
    const c = stack.pop(), i = c % n[0], k = Math.floor(c / n[0]) % n[2], j = Math.floor(c / (n[0] * n[2]));
    for (const [di, dj, dk] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const a = i + di, b = j + dj, d = k + dk;
      if (a < 0 || b < 0 || d < 0 || a >= n[0] || b >= n[1] || d >= n[2]) continue;
      const q = at(a, b, d);
      if (outside[q] || grid[q]) continue;
      outside[q] = 1; stack.push(q);
    }
  }
  for (let q = 0; q < grid.length; q++) if (!outside[q]) grid[q] = 1;
  // Greedy merge: runs along x, then z, then up.
  const used = new Uint8Array(grid.length), free = (i, j, k) => grid[at(i, j, k)] && !used[at(i, j, k)], out = [];
  for (let j = 0; j < n[1]; j++) for (let k = 0; k < n[2]; k++) for (let i = 0; i < n[0]; i++) {
    if (!free(i, j, k)) continue;
    let i1 = i; while (i1 + 1 < n[0] && free(i1 + 1, j, k)) i1++;
    let k1 = k; grow: while (k1 + 1 < n[2]) { for (let x = i; x <= i1; x++) if (!free(x, j, k1 + 1)) break grow; k1++; }
    let j1 = j; up: while (j1 + 1 < n[1]) { for (let z = k; z <= k1; z++) for (let x = i; x <= i1; x++) if (!free(x, j1 + 1, z)) break up; j1++; }
    for (let y = j; y <= j1; y++) for (let z = k; z <= k1; z++) for (let x = i; x <= i1; x++) used[at(x, y, z)] = 1;
    const lo = [min[0] + i * cell, min[1] + j * cell, min[2] + k * cell], hi = [min[0] + (i1 + 1) * cell, min[1] + (j1 + 1) * cell, min[2] + (k1 + 1) * cell];
    out.push({ lo, hi, cells: (i1 - i + 1) * (j1 - j + 1) * (k1 - k + 1) });
  }
  return out;
}

const r = (v) => Math.round(v * 100) / 100;
const hulls = {};
for (const [kind, [file, scale, barrel]] of Object.entries(KINDS)) {
  let tris = triangles(await fs.readFile(path.join(root, 'models/prepared', file + '.glb'))).map((t) => t.map((p) => p.map((c) => c * scale)));
  if (barrel) {
    const [bx, by, bz, h] = barrel;
    tris = tris.filter((t) => !(t.every((p) => Math.abs(p[0] - bx) < h && Math.abs(p[1] - by) < h) && (t[0][2] + t[1][2] + t[2][2]) / 3 < bz));
  }
  // Antennas, cables and other wisps: a triangle thinner than a few cm across both its short sides.
  tris = tris.filter((t) => [0, 1, 2].map((a) => Math.max(...t.map((p) => p[a])) - Math.min(...t.map((p) => p[a]))).sort((a, b) => a - b)[1] > .04);
  let boxes = [];
  for (const cell of [.15, .2, .25, .3, .35, .4, .5]) {
    const all = solidBoxes(tris, cell);
    // Slivers of a single cell are left out once the big boxes alone fit the budget.
    boxes = all.length <= BUDGET ? all : all.filter((b) => b.cells >= 2);
    if (boxes.length <= BUDGET) { console.log(kind, 'cell', cell, boxes.length, 'boxes'); break; }
  }
  if (boxes.length > BUDGET) { boxes.sort((a, b) => b.cells - a.cells); boxes = boxes.slice(0, BUDGET); console.log(kind, 'kept the', BUDGET, 'largest boxes'); }
  hulls[kind] = boxes.map(({ lo, hi }) => [r((lo[0] + hi[0]) / 2), r((lo[1] + hi[1]) / 2), r((lo[2] + hi[2]) / 2), r((hi[0] - lo[0]) / 2), r((hi[1] - lo[1]) / 2), r((hi[2] - lo[2]) / 2)]);
}
const body = Object.entries(hulls).map(([k, b]) => `  ${k}: [\n${b.map((x) => `    [${x.join(', ')}],`).join('\n')}\n  ],`).join('\n');
await fs.writeFile(path.join(root, 'packages/physics/src/vehicle-hulls.gen.ts'), `// Generated by apps/web/scripts/vehicle-hulls.mjs from the prepared models; do not edit by hand.
import type { VehicleKind } from '@zion/shared';

/** Each vehicle's body as boxes fitted to its model: [centre x, y, z, half x, y, z], vehicle metres. */
export const VEHICLE_HULLS: Record<VehicleKind, ReadonlyArray<readonly [number, number, number, number, number, number]>> = {
${body}
};
`);
