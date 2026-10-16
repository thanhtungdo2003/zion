/**
 * Precise shot geometry per asset: the model's own triangles (asset-local metres, 3 vertices per
 * triangle) and, for see-through textures (fences, grates, leaves), each triangle's texture
 * coordinates plus a 1-bit alpha mask, so the transparent parts of a face let shots through too.
 */
export interface HitMeshData {
  /** x y z per vertex, 9 floats per triangle. */
  tris: Float32Array;
  /** u v per vertex, 6 floats per triangle (only when `maskOf` is present). */
  uvs?: Float32Array;
  /** Mask index per triangle, −1 = solid. */
  maskOf?: Int16Array;
  /** Alpha masks: 1 = solid texel, row-major, v = 0 at the bottom (GL texture coordinates). */
  masks?: Array<{ w: number; h: number; bits: Uint8Array }>;
}

const MAGIC = 0x324d4848; // "HHM2"

export function encodeHitMeshes(meshes: ReadonlyMap<number, HitMeshData>): Uint8Array {
  const chunks: Uint8Array[] = [];
  const u32 = (v: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v, true); chunks.push(b); };
  const bytes = (b: Uint8Array) => { chunks.push(b); const pad = (4 - (b.length % 4)) % 4; if (pad) chunks.push(new Uint8Array(pad)); };
  u32(MAGIC); u32(meshes.size);
  for (const [id, m] of meshes) {
    u32(id); u32(m.tris.length); bytes(new Uint8Array(m.tris.buffer, m.tris.byteOffset, m.tris.byteLength));
    const masks = m.maskOf && m.uvs && m.masks?.length ? m.masks : [];
    u32(masks.length);
    if (!masks.length) continue;
    bytes(new Uint8Array(m.uvs!.buffer, m.uvs!.byteOffset, m.uvs!.byteLength));
    bytes(new Uint8Array(m.maskOf!.buffer, m.maskOf!.byteOffset, m.maskOf!.byteLength));
    for (const mask of masks) { u32(mask.w); u32(mask.h); bytes(mask.bits); }
  }
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

export function decodeHitMeshes(data: ArrayBuffer | Uint8Array): Map<number, HitMeshData> {
  const raw = data instanceof Uint8Array ? data : new Uint8Array(data);
  const b = raw.byteOffset % 4 ? raw.slice() : raw;
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const out = new Map<number, HitMeshData>();
  let o = 0;
  const u32 = () => { const v = view.getUint32(o, true); o += 4; return v; };
  const align = () => { o = (o + 3) & ~3; };
  if (u32() !== MAGIC) return out;
  const count = u32();
  for (let i = 0; i < count; i++) {
    const id = u32(), n = u32();
    const tris = new Float32Array(b.buffer, b.byteOffset + o, n); o += n * 4;
    const masks = u32();
    if (!masks) { out.set(id, { tris }); continue; }
    const triangles = n / 9;
    const uvs = new Float32Array(b.buffer, b.byteOffset + o, triangles * 6); o += triangles * 24;
    const maskOf = new Int16Array(b.buffer.slice(b.byteOffset + o, b.byteOffset + o + triangles * 2)); o += triangles * 2; align();
    const list: NonNullable<HitMeshData['masks']> = [];
    for (let k = 0; k < masks; k++) {
      const w = u32(), h = u32(), size = Math.ceil((w * h) / 8);
      list.push({ w, h, bits: new Uint8Array(b.buffer, b.byteOffset + o, size) }); o += size; align();
    }
    out.set(id, { tris, uvs, maskOf, masks: list });
  }
  return out;
}
