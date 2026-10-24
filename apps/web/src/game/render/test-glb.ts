/**
 * Test helper: a GLB with its images and textures removed, so three's GLTFLoader can parse the
 * geometry under Node (texture decoding needs a browser; the real viewer does it there).
 */
export function untexturedGlb(buf: Uint8Array): ArrayBuffer {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(buf.subarray(20, 20 + jsonLength))) as {
    images?: unknown; textures?: unknown; samplers?: unknown;
    materials?: Array<Record<string, unknown> & { pbrMetallicRoughness?: Record<string, unknown> }>;
  };
  delete json.images; delete json.textures; delete json.samplers;
  // Every texture reference, wherever an extension keeps it (sheen, clearcoat, specular…).
  const strip = (o: unknown): void => {
    if (!o || typeof o !== 'object') return;
    const r = o as Record<string, unknown>;
    for (const k of Object.keys(r)) { if (/Texture$/.test(k) || k === 'KHR_texture_transform') delete r[k]; else strip(r[k]); }
  };
  for (const m of json.materials ?? []) strip(m);
  let text = new TextEncoder().encode(JSON.stringify(json));
  const pad = (4 - (text.length % 4)) % 4;
  if (pad) { const padded = new Uint8Array(text.length + pad).fill(0x20); padded.set(text); text = padded; }
  const rest = buf.subarray(20 + jsonLength);
  const out = new Uint8Array(20 + text.length + rest.length);
  const w = new DataView(out.buffer);
  w.setUint32(0, 0x46546c67, true); w.setUint32(4, 2, true); w.setUint32(8, out.length, true);
  w.setUint32(12, text.length, true); w.setUint32(16, 0x4e4f534a, true);
  out.set(text, 20); out.set(rest, 20 + text.length);
  return out.buffer;
}
