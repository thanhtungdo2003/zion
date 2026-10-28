/**
 * Minimal PNG encoder (8-bit RGB / RGBA, Paeth-filtered rows). The zlib deflate is passed in —
 * node's `zlib.deflateSync` on the server — so this module stays free of platform code.
 */
export type Deflate = (data: Uint8Array) => Uint8Array;

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();

function crc32(bytes: Uint8Array, start: number, end: number): number {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** `rgba`: width × height × 4 bytes; `alpha` false drops the alpha channel. */
export function encodePng(width: number, height: number, rgba: Uint8Array, deflate: Deflate, alpha = true): Uint8Array {
  const ch = alpha ? 4 : 3, stride = width * ch;
  const raw = new Uint8Array((stride + 1) * height);
  const row = new Uint8Array(stride), prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) for (let c = 0; c < ch; c++) row[x * ch + c] = rgba[(y * width + x) * 4 + c]!;
    const o = y * (stride + 1);
    raw[o] = 4;
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? row[i - ch]! : 0, b = prev[i]!, c = i >= ch ? prev[i - ch]! : 0;
      raw[o + 1 + i] = (row[i]! - paeth(a, b, c)) & 0xff;
    }
    prev.set(row);
  }
  const idat = deflate(raw);
  const out = new Uint8Array(8 + 25 + 12 + idat.length + 12);
  const view = new DataView(out.buffer);
  out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  let o = 8;
  const chunk = (type: string, data: Uint8Array) => {
    view.setUint32(o, data.length);
    for (let i = 0; i < 4; i++) out[o + 4 + i] = type.charCodeAt(i);
    out.set(data, o + 8);
    view.setUint32(o + 8 + data.length, crc32(out, o + 4, o + 8 + data.length));
    o += 12 + data.length;
  };
  const ihdr = new Uint8Array(13), hv = new DataView(ihdr.buffer);
  hv.setUint32(0, width); hv.setUint32(4, height); ihdr[8] = 8; ihdr[9] = alpha ? 6 : 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  chunk('IHDR', ihdr);
  chunk('IDAT', idat);
  chunk('IEND', new Uint8Array(0));
  return out.subarray(0, o);
}
