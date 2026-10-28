/**
 * Texture sets from a single colour image (an AI-painted texture, a photo): decode the PNG, make
 * it tile without visible seams, and derive the maps a PBR material needs from it — a height
 * field from luminance (dark crevices low, bright faces high), a tangent-space normal map from
 * its slope, ambient occlusion from cavities, roughness that follows the height and the
 * material's base roughness. The zlib inflate is passed in (node's `zlib.inflateSync`).
 */
export type Inflate = (data: Uint8Array) => Uint8Array;
export interface Rgba { width: number; height: number; data: Uint8Array }

/** 8-bit PNG (grey, grey+alpha, RGB, RGBA, palette; not interlaced) to RGBA. */
export function decodePng(bytes: Uint8Array, inflate: Inflate): Rgba {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (sig.some((v, i) => bytes[i] !== v)) throw new Error('không phải ảnh PNG');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let o = 8, width = 0, height = 0, depth = 0, type = 0, interlace = 0;
  let palette: Uint8Array | null = null, trns: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  while (o + 8 <= bytes.length) {
    const len = dv.getUint32(o), kind = String.fromCharCode(...bytes.subarray(o + 4, o + 8)), body = bytes.subarray(o + 8, o + 8 + len);
    if (kind === 'IHDR') { width = dv.getUint32(o + 8); height = dv.getUint32(o + 12); depth = body[8]!; type = body[9]!; interlace = body[12]!; }
    else if (kind === 'PLTE') palette = body;
    else if (kind === 'tRNS') trns = body;
    else if (kind === 'IDAT') idat.push(body);
    else if (kind === 'IEND') break;
    o += 12 + len;
  }
  if (depth !== 8 || interlace) throw new Error('chỉ hỗ trợ PNG 8-bit không interlace');
  const ch = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[type];
  if (!ch) throw new Error(`kiểu màu PNG ${type} chưa hỗ trợ`);
  const joined = new Uint8Array(idat.reduce((n, c) => n + c.length, 0));
  let p = 0;
  for (const c of idat) { joined.set(c, p); p += c.length; }
  const raw = inflate(joined), stride = width * ch, out = new Uint8Array(width * height * 4);
  const prev = new Uint8Array(stride), row = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)]!, src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? row[i - ch]! : 0, b = prev[i]!, c = i >= ch ? prev[i - ch]! : 0;
      const pr = a + b - c, pa = Math.abs(pr - a), pb = Math.abs(pr - b), pc = Math.abs(pr - c);
      const pred = f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : f === 4 ? (pa <= pb && pa <= pc ? a : pb <= pc ? b : c) : 0;
      row[i] = (src[i]! + pred) & 255;
    }
    for (let x = 0; x < width; x++) {
      const q = (y * width + x) * 4, s = x * ch;
      if (type === 3) { const k = row[s]!; out[q] = palette![k * 3]!; out[q + 1] = palette![k * 3 + 1]!; out[q + 2] = palette![k * 3 + 2]!; out[q + 3] = trns && k < trns.length ? trns[k]! : 255; }
      else if (ch <= 2) { out[q] = out[q + 1] = out[q + 2] = row[s]!; out[q + 3] = ch === 2 ? row[s + 1]! : 255; }
      else { out[q] = row[s]!; out[q + 1] = row[s + 1]!; out[q + 2] = row[s + 2]!; out[q + 3] = ch === 4 ? row[s + 3]! : 255; }
    }
    prev.set(row);
  }
  return { width, height, data: out };
}

/** Square, power-of-two size (box-filtered down or nearest up). */
export function resizeSquare(img: Rgba, size: number): Rgba {
  const out = new Uint8Array(size * size * 4), sx = img.width / size, sy = img.height / size;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const x0 = Math.floor(x * sx), y0 = Math.floor(y * sy), x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx)), y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
    const acc = [0, 0, 0, 0];
    let n = 0;
    for (let j = y0; j < Math.min(y1, img.height); j++) for (let i = x0; i < Math.min(x1, img.width); i++) { const q = (j * img.width + i) * 4; for (let c = 0; c < 4; c++) acc[c]! += img.data[q + c]!; n++; }
    for (let c = 0; c < 4; c++) out[(y * size + x) * 4 + c] = Math.round(acc[c]! / Math.max(1, n));
  }
  return { width: size, height: size, data: out };
}

/**
 * Seamless tiling: the image blended with itself shifted half a tile, weighted so the original
 * dominates the middle and the shifted copy (whose edges are the original's middle) the borders.
 */
export function makeTileable(img: Rgba): Rgba {
  const { width: w, height: h, data } = img, out = new Uint8Array(data.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const ex = Math.min(x, w - 1 - x) / (w / 2), ey = Math.min(y, h - 1 - y) / (h / 2);
    const wt = Math.min(1, Math.min(ex, ey) * 3), k = wt * wt * (3 - 2 * wt);
    const q = (y * w + x) * 4, r = (((y + (h >> 1)) % h) * w + ((x + (w >> 1)) % w)) * 4;
    for (let c = 0; c < 4; c++) out[q + c] = Math.round(data[q + c]! * k + data[r + c]! * (1 - k));
  }
  return { width: w, height: h, data: out };
}

/** Normal and occlusion-roughness-metalness maps (RGBA) derived from a colour map. */
export function deriveMaps(img: Rgba, opts: { roughness: number; metalness: number; normalStrength: number }): { normal: Uint8Array; orm: Uint8Array } {
  const { width: w, height: h, data } = img, n = w * h;
  const H = new Float32Array(n);
  for (let i = 0; i < n; i++) H[i] = (data[i * 4]! * .299 + data[i * 4 + 1]! * .587 + data[i * 4 + 2]! * .114) / 255;
  // Large-scale shading (the painter's light) removed: height is the local detail.
  const blur = (src: Float32Array, r: number) => {
    const tmp = new Float32Array(n), dst = new Float32Array(n), win = 2 * r + 1;
    for (let y = 0; y < h; y++) { let a = 0; for (let k = -r; k <= r; k++) a += src[y * w + ((k + w) % w)]!; for (let x = 0; x < w; x++) { tmp[y * w + x] = a / win; a += src[y * w + ((x + r + 1) % w)]! - src[y * w + ((x - r + w) % w)]!; } }
    for (let x = 0; x < w; x++) { let a = 0; for (let k = -r; k <= r; k++) a += tmp[((k + h) % h) * w + x]!; for (let y = 0; y < h; y++) { dst[y * w + x] = a / win; a += tmp[((y + r + 1) % h) * w + x]! - tmp[((y - r + h) % h) * w + x]!; } }
    return dst;
  };
  const broad = blur(H, Math.max(2, Math.round(w / 16)));
  const detail = new Float32Array(n);
  for (let i = 0; i < n; i++) detail[i] = H[i]! - broad[i]! + .5;
  const near = blur(detail, Math.max(1, Math.round(w / 128)));
  const around = blur(near, Math.max(1, Math.round(w / 48)));
  const normal = new Uint8Array(n * 4), orm = new Uint8Array(n * 4), k = opts.normalStrength * w / 96;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    const dx = (near[y * w + ((x + 1) % w)]! - near[y * w + ((x - 1 + w) % w)]!) * .5 * k;
    const dy = (near[((y + 1) % h) * w + x]! - near[((y - 1 + h) % h) * w + x]!) * .5 * k;
    const len = Math.hypot(dx, dy, 1);
    normal[i * 4] = Math.round((-dx / len * .5 + .5) * 255); normal[i * 4 + 1] = Math.round((dy / len * .5 + .5) * 255); normal[i * 4 + 2] = Math.round((1 / len * .5 + .5) * 255); normal[i * 4 + 3] = 255;
    const cav = Math.max(0, Math.min(1, (around[i]! - near[i]!) * 5));
    orm[i * 4] = Math.round(Math.max(0, 1 - cav * 1.4) * 255);
    orm[i * 4 + 1] = Math.round(Math.max(0, Math.min(1, opts.roughness + cav * .12 - (near[i]! - .5) * .2)) * 255);
    orm[i * 4 + 2] = Math.round(Math.max(0, Math.min(1, opts.metalness)) * 255);
    orm[i * 4 + 3] = 255;
  }
  return { normal, orm };
}
