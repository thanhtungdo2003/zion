/**
 * Precise shot geometry per asset: the model's own triangles (asset-local metres, x y z per
 * vertex, 3 vertices per triangle). Packed as: u32 count, then per asset u32 id + u32 floats,
 * then the floats.
 */
export function encodeHitMeshes(meshes: ReadonlyMap<number, Float32Array>): Uint8Array {
  let floats = 0;
  for (const m of meshes.values()) floats += m.length;
  const header = 4 + meshes.size * 8;
  const out = new Uint8Array(header + floats * 4);
  const view = new DataView(out.buffer);
  view.setUint32(0, meshes.size, true);
  let h = 4, o = header;
  for (const [id, m] of meshes) {
    view.setUint32(h, id, true); view.setUint32(h + 4, m.length, true); h += 8;
    new Float32Array(out.buffer, o, m.length).set(m); o += m.length * 4;
  }
  return out;
}

export function decodeHitMeshes(data: ArrayBuffer | Uint8Array): Map<number, Float32Array> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const copy = bytes.byteOffset % 4 ? bytes.slice() : bytes;
  const view = new DataView(copy.buffer, copy.byteOffset, copy.byteLength);
  const count = view.getUint32(0, true), out = new Map<number, Float32Array>();
  let h = 4, o = 4 + count * 8;
  for (let i = 0; i < count; i++) {
    const id = view.getUint32(h, true), n = view.getUint32(h + 4, true); h += 8;
    out.set(id, new Float32Array(copy.buffer, copy.byteOffset + o, n)); o += n * 4;
  }
  return out;
}
