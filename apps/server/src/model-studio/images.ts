import { deflateSync, inflateSync } from 'node:zlib';
import { decodePng, encodePng, type Rgba } from '@zion/assets/model-studio';
import type { AiSettings } from './ai-settings';
import { redact } from './llm';
import type { ModelStudioStore } from './store';

/**
 * Whole pictures for sign boards — road signs, billboards, shop signs, posters — shown once on a
 * sign's face (not tiled like a texture), three ways:
 *  - found on Wikimedia Commons (most road signs, Vietnam's QCVN 41 set among them, as public
 *    domain drawings; photos of facades, posters, old signage) and Openverse (Creative Commons
 *    photos): only pictures whose licence allows use in a game and changes (public domain, CC0,
 *    CC BY, CC BY-SA), never NC / ND or "fair use"; the licence and author go with the material;
 *  - painted by the AI image model: a billboard or a shop sign for a made-up brand (no real logos
 *    or trademarks);
 *  - either one aged on request (faded by the sun, dirt, rust streaks, scratches).
 */
export interface PictureHit { id: string; title: string; source: 'wikimedia' | 'openverse'; license: string; author: string; width: number; height: number; page: string; description: string }
export interface Picture {
  maps: { albedo: string };
  width: number; height: number;
  /** Whether the ageing was applied (PNG pictures; a JPEG photo is kept as it is). */
  aged: boolean;
  source: { kind: 'web' | 'ai'; id: string; name: string; license?: string; url?: string; author?: string };
  files: Array<{ id: string; name: string; mime: string; size: number }>;
}

const UA = { 'user-agent': 'Zion-Model-Studio/1.0 (sign pictures; https://zion.1vibe.link)' };
const MAX_SIDE = 1024;
const MAX_BYTES = 12 * 1024 * 1024;

/** Licences a game may use and change: public domain, CC0, CC BY, CC BY-SA (no NC / ND). */
export function usableLicense(license: string): boolean {
  const l = license.toLowerCase().replace(/[_-]/g, ' ');
  if (/\bnc\b|\bnd\b|non ?commercial|no ?deriv|fair use|copyright/.test(l)) return false;
  return /public domain|^pd\b|\bpdm\b|cc0|cc ?zero|^cc by( sa)?\b|^by( sa)?\b|attribution/.test(l.trim());
}

const stripHtml = (s: string) => s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

interface Cached { hit: PictureHit; url: string }

export class ImageLibrary {
  private readonly found = new Map<string, Cached>();

  constructor(private readonly store: ModelStudioStore, private readonly ai: AiSettings | null, private readonly fetchImpl: typeof fetch = fetch) {}

  get canPaint(): boolean { return !!this.ai?.imageAccess(); }

  private remember(hit: PictureHit, url: string): PictureHit {
    if (this.found.size > 2000) this.found.delete(this.found.keys().next().value!);
    this.found.set(hit.id, { hit, url });
    return hit;
  }

  private async wikimedia(query: string, limit: number): Promise<PictureHit[]> {
    const q = new URLSearchParams({
      action: 'query', format: 'json', generator: 'search', gsrnamespace: '6', gsrsearch: query, gsrlimit: String(Math.min(40, limit * 3)),
      prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata', iiurlwidth: String(MAX_SIDE), iiextmetadatafilter: 'LicenseShortName|Artist|ImageDescription|ObjectName',
    });
    const res = await this.fetchImpl(`https://commons.wikimedia.org/w/api.php?${q}`, { headers: UA, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`Wikimedia Commons trả lỗi ${res.status}.`);
    type Info = { url: string; thumburl?: string; width: number; height: number; mime: string; descriptionurl: string; extmetadata?: Record<string, { value?: string }> };
    const body = await res.json() as { query?: { pages?: Record<string, { pageid: number; title: string; index?: number; imageinfo?: Info[] }> } };
    const pages = Object.values(body.query?.pages ?? {}).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    const out: PictureHit[] = [];
    for (const p of pages) {
      const info = p.imageinfo?.[0];
      if (!info || !/^image\/(svg\+xml|png|jpeg)$/.test(info.mime)) continue;
      const meta = info.extmetadata ?? {}, license = stripHtml(meta.LicenseShortName?.value ?? '');
      if (!usableLicense(license)) continue;
      const url = info.thumburl ?? info.url;
      out.push(this.remember({
        id: `wm:${p.pageid}`, title: stripHtml(meta.ObjectName?.value ?? p.title.replace(/^File:/, '')).slice(0, 160), source: 'wikimedia', license,
        author: stripHtml(meta.Artist?.value ?? '').slice(0, 160), width: info.width, height: info.height, page: info.descriptionurl,
        description: stripHtml(meta.ImageDescription?.value ?? '').slice(0, 200),
      }, url));
      if (out.length >= limit) break;
    }
    return out;
  }

  private async openverse(query: string, limit: number): Promise<PictureHit[]> {
    const q = new URLSearchParams({ q: query, page_size: String(Math.min(20, limit)), license_type: 'commercial,modification', mature: 'false' });
    const res = await this.fetchImpl(`https://api.openverse.org/v1/images/?${q}`, { headers: UA, signal: AbortSignal.timeout(12_000) });
    if (!res.ok) throw new Error(`Openverse trả lỗi ${res.status}.`);
    const body = await res.json() as { results?: Array<{ id: string; title?: string; url: string; width?: number; height?: number; license: string; license_version?: string; creator?: string; foreign_landing_url?: string; filetype?: string }> };
    const out: PictureHit[] = [];
    for (const r of body.results ?? []) {
      const license = r.license === 'pdm' || r.license === 'cc0' ? (r.license === 'pdm' ? 'Public domain' : 'CC0') : `CC ${r.license.toUpperCase()} ${r.license_version ?? ''}`.trim();
      if (!usableLicense(license) || (r.filetype && !/^(png|jpe?g)$/i.test(r.filetype))) continue;
      out.push(this.remember({ id: `ov:${r.id}`, title: (r.title ?? '').slice(0, 160), source: 'openverse', license, author: (r.creator ?? '').slice(0, 160), width: r.width ?? 0, height: r.height ?? 0, page: r.foreign_landing_url ?? '', description: '' }, r.url));
    }
    return out;
  }

  /**
   * Pictures matching a description (English works best: "Vietnam road sign no parking",
   * "old rusty shop sign"…). `kind` 'sign': drawings of road signs (Wikimedia only).
   */
  async search(query: string, limit = 10, kind: 'sign' | 'photo' | 'any' = 'any'): Promise<PictureHit[]> {
    const n = Math.max(1, Math.min(20, limit));
    // (Photos from both: Commons holds many too, and Openverse is not always reachable.)
    const tasks = [this.wikimedia(query, n), kind === 'sign' ? Promise.resolve([]) : this.openverse(query, n)];
    const [wm, ov] = await Promise.allSettled(tasks);
    const all = [...(wm.status === 'fulfilled' ? wm.value : []), ...(ov.status === 'fulfilled' ? ov.value : [])];
    if (!all.length && wm.status === 'rejected' && ov.status === 'rejected') throw new Error(`Không tìm được ảnh: ${(wm.reason as Error).message}`);
    return all.slice(0, n);
  }

  /** Downloads a picture found by `search` into the project (aged if asked: 0 new … 1 decades out in the weather). */
  async download(projectId: string, id: string, opts: { age?: number } = {}): Promise<Picture> {
    const c = this.found.get(id);
    if (!c) throw new Error(`Không có ảnh "${id}" — tìm bằng find_image trước.`);
    if (!c.url.startsWith('https://')) throw new Error('Địa chỉ ảnh không hợp lệ.');
    const res = await this.fetchImpl(c.url, { headers: UA, signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`Tải ảnh lỗi (${res.status}).`);
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > MAX_BYTES) throw new Error('Ảnh quá lớn.');
    const source = { kind: 'web' as const, id, name: c.hit.title || id, license: c.hit.license.slice(0, 40), url: c.hit.page.slice(0, 400), ...(c.hit.author ? { author: c.hit.author.slice(0, 200) } : {}) };
    return this.keep(projectId, bytes, `web/${id.replace(/[^a-z0-9:_-]/gi, '_')}`, source, opts.age ?? 0, c.hit.width, c.hit.height);
  }

  /** The AI paints a whole picture (a billboard, a shop sign, a poster) for a made-up brand. */
  async paint(projectId: string, prompt: string, opts: { aspect?: 'square' | 'landscape' | 'portrait'; age?: number } = {}): Promise<Picture> {
    const access = this.ai?.imageAccess();
    if (!access) throw new Error('Chưa có API key AI (Cấu hình AI) để vẽ ảnh.');
    const size = opts.aspect === 'landscape' ? '1536x1024' : opts.aspect === 'portrait' ? '1024x1536' : '1024x1024';
    const full = 'Flat, front-on artwork of a sign or poster, filling the whole frame edge to edge: no perspective, no mockup, no wall, frame, pole or scene around it, evenly lit. '
      + 'Every brand, company, product and person in it is invented (fictional): no real logos, trademarks or celebrities. Any text short, large and spelled exactly as given. ' + prompt;
    const res = await this.fetchImpl(`${access.baseUrl.replace(/\/$/, '')}/images/generations`, {
      method: 'POST', signal: AbortSignal.timeout(240_000),
      headers: { 'content-type': 'application/json', authorization: `Bearer ${access.key}` },
      body: JSON.stringify({ model: access.model, prompt: full, size, n: 1, quality: 'high', output_format: 'png' }),
    }).catch((err: Error) => { throw new Error(redact(`Không kết nối được máy chủ ảnh AI: ${err.message}`, access.key)); });
    if (!res.ok) {
      const body = (await res.text().catch(() => '')).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
      throw new Error(redact(`Model ảnh trả lỗi ${res.status}${body ? `: ${body}` : ''}. Dùng find_image thay thế.`, access.key));
    }
    const body = await res.json() as { data?: Array<{ b64_json?: string; url?: string }> };
    const item = body.data?.[0];
    let bytes: Buffer | null = item?.b64_json ? Buffer.from(item.b64_json, 'base64') : null;
    if (!bytes && item?.url?.startsWith('https://')) { const r = await this.fetchImpl(item.url, { signal: AbortSignal.timeout(60_000) }); if (r.ok) bytes = Buffer.from(await r.arrayBuffer()); }
    if (!bytes) throw new Error('Model ảnh không trả về ảnh.');
    const stamp = Date.now().toString(36);
    return this.keep(projectId, bytes, `ai/${stamp}/picture`, { kind: 'ai', id: stamp, name: prompt.slice(0, 200) }, opts.age ?? 0, 0, 0);
  }

  /** Stores a picture: a PNG flattened (no see-through corners), scaled to ≤ 1024 px and aged; a JPEG as it is. */
  private async keep(projectId: string, bytes: Buffer, name: string, source: Picture['source'], age: number, w0: number, h0: number): Promise<Picture> {
    let img: Rgba | null = null;
    if (bytes[0] === 0x89) { try { img = decodePng(new Uint8Array(bytes), (b) => new Uint8Array(inflateSync(b))); } catch { img = null; } }
    if (img) {
      img = fitWithin(img, MAX_SIDE);
      flatten(img);
      if (age > 0) weather(img, Math.min(1, age), hashSeed(name));
      const png = Buffer.from(encodePng(img.width, img.height, img.data, (d) => new Uint8Array(deflateSync(d, { level: 6 })), false));
      const f = await this.store.addFile(projectId, `${name}${age > 0 ? `-age${Math.round(age * 10)}` : ''}.png`, png);
      return { maps: { albedo: f.id }, width: img.width, height: img.height, aged: age > 0, source, files: [f] };
    }
    if (!(bytes[0] === 0xff && bytes[1] === 0xd8)) throw new Error('Ảnh không phải PNG hay JPEG.');
    const f = await this.store.addFile(projectId, `${name}.jpg`, bytes);
    return { maps: { albedo: f.id }, width: w0 || 1, height: h0 || 1, aged: false, source, files: [f] };
  }
}

const hashSeed = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };

/** Box-filtered downscale so the longer side is at most `max` px (aspect kept). */
export function fitWithin(img: Rgba, max: number): Rgba {
  const k = Math.max(img.width, img.height) / max;
  if (k <= 1) return img;
  const w = Math.max(1, Math.round(img.width / k)), h = Math.max(1, Math.round(img.height / k)), out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const x0 = Math.floor(x * k), y0 = Math.floor(y * k), x1 = Math.min(img.width, Math.max(x0 + 1, Math.floor((x + 1) * k))), y1 = Math.min(img.height, Math.max(y0 + 1, Math.floor((y + 1) * k)));
    const acc = [0, 0, 0, 0];
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { const i = (yy * img.width + xx) * 4; for (let c = 0; c < 4; c++) acc[c]! += img.data[i + c]!; }
    const n = (x1 - x0) * (y1 - y0), o = (y * w + x) * 4;
    for (let c = 0; c < 4; c++) out[o + c] = Math.round(acc[c]! / n);
  }
  return { width: w, height: h, data: out };
}

/** See-through pixels over a pale grey board (the sign's own face shows there; nothing reads as a hole). */
export function flatten(img: Rgba, bg: [number, number, number] = [214, 216, 214]): void {
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3]! / 255;
    if (a >= 1) continue;
    for (let c = 0; c < 3; c++) d[i + c] = Math.round(d[i + c]! * a + bg[c]! * (1 - a));
    d[i + 3] = 255;
  }
}

/**
 * Years out in the weather: colours faded and paled by the sun, grime gathered towards the
 * bottom and in blotches, rust streaks running down from the top edge, a scatter of scratches.
 */
export function weather(img: Rgba, age: number, seed: number): void {
  const { width: w, height: h, data: d } = img;
  let s = seed || 1;
  const rnd = () => { s = Math.imul(s ^ (s >>> 15), 2246822507) ^ Math.imul(s ^ (s >>> 13), 3266489909); s ^= s >>> 16; return (s >>> 0) / 4294967296; };
  // Value noise on a coarse grid (blotches).
  const G = 9, grid = Float32Array.from({ length: (G + 1) * (G + 1) }, rnd);
  const blot = (x: number, y: number) => {
    const gx = x / w * G, gy = y / h * G, ix = Math.floor(gx), iy = Math.floor(gy), fx = gx - ix, fy = gy - iy;
    const at = (a: number, b: number) => grid[Math.min(G, b) * (G + 1) + Math.min(G, a)]!;
    return (at(ix, iy) * (1 - fx) + at(ix + 1, iy) * fx) * (1 - fy) + (at(ix, iy + 1) * (1 - fx) + at(ix + 1, iy + 1) * fx) * fy;
  };
  const streaks = Array.from({ length: Math.round(3 + age * 9) }, () => ({ x: rnd() * w, len: (.15 + rnd() * .6) * h * age, width: 1 + rnd() * w * .012 }));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    let r = d[i]!, g = d[i + 1]!, b = d[i + 2]!;
    // Sun: towards grey and lighter.
    const lum = r * .3 + g * .59 + b * .11, fade = .55 * age;
    r += (lum - r) * fade + (235 - r) * .18 * age; g += (lum - g) * fade + (232 - g) * .18 * age; b += (lum - b) * fade + (220 - b) * .18 * age;
    // Grime: blotches, heavier low down.
    const grime = Math.max(0, blot(x, y) - .45) * 1.4 * age + (y / h) ** 3 * .35 * age;
    r *= 1 - grime * .55; g *= 1 - grime * .58; b *= 1 - grime * .65;
    // Rust running down from the top edge.
    for (const st of streaks) {
      const dx = Math.abs(x - st.x);
      if (dx < st.width && y < st.len) { const k = (1 - y / st.len) * (1 - dx / st.width) * .6 * age; r += (120 - r) * k; g += (62 - g) * k; b += (30 - b) * k; }
    }
    d[i] = Math.max(0, Math.min(255, r)); d[i + 1] = Math.max(0, Math.min(255, g)); d[i + 2] = Math.max(0, Math.min(255, b));
  }
  // Scratches: short pale lines.
  for (let k = 0; k < Math.round(age * 40); k++) {
    let x = rnd() * w, y = rnd() * h;
    const a = rnd() * Math.PI, len = (.02 + rnd() * .08) * Math.max(w, h);
    for (let t = 0; t < len; t++) {
      x += Math.cos(a); y += Math.sin(a);
      const xi = Math.round(x), yi = Math.round(y);
      if (xi < 0 || yi < 0 || xi >= w || yi >= h) break;
      const i = (yi * w + xi) * 4;
      for (let c = 0; c < 3; c++) d[i + c] = Math.min(255, d[i + c]! * .6 + 200 * .4);
    }
  }
}
