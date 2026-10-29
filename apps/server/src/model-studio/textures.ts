import { deflateSync, inflateSync } from 'node:zlib';
import { decodePng, deriveMaps, encodePng, makeTileable, resizeSquare } from '@zion/assets/model-studio';
import type { AiSettings } from './ai-settings';
import { redact } from './llm';
import type { ModelStudioStore } from './store';

/**
 * Real texture sets for Model Studio materials, two ways:
 *  - found and downloaded: the Poly Haven library (CC0, ~870 scanned PBR sets — concrete,
 *    plaster, brick, wood, rusted metal, roofing, tiles, ground…), its colour, OpenGL normal and
 *    packed AO/roughness/metalness maps at 1K or 2K, with the real-world size of one tile;
 *  - painted: the AI image model (the gateway's images endpoint, as model-generator uses it)
 *    paints a seamless colour texture from a description; the normal and AO/roughness/metalness
 *    maps are derived from it here.
 * Files go into the project (a map another project already downloaded is copied, not fetched
 * again).
 */
export interface TextureHit { id: string; name: string; categories: string[]; tags: string[]; sizeM: number | null; description: string }
export interface TextureSet { maps: { albedo: string; normal?: string; orm?: string }; scale: number; source: { kind: 'polyhaven' | 'ai'; id: string; name: string; license?: string; url?: string }; files: Array<{ id: string; name: string; mime: string; size: number }> }

const API = 'https://api.polyhaven.com';
const UA = { 'user-agent': 'Zion-Model-Studio/1.0 (texture library)' };
interface Entry { name: string; tags?: string[]; categories?: string[]; dimensions?: number[]; description?: string; type?: number }

export class TextureLibrary {
  private catalog: { at: number; list: Array<[string, Entry]> } | null = null;
  private readonly thumbs = new Map<string, Buffer>();

  constructor(private readonly store: ModelStudioStore, private readonly ai: AiSettings | null, private readonly fetchImpl: typeof fetch = fetch) {}

  private async entries(): Promise<Array<[string, Entry]>> {
    if (this.catalog && Date.now() - this.catalog.at < 24 * 3600_000) return this.catalog.list;
    const res = await this.fetchImpl(`${API}/assets?t=textures`, { headers: UA, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`Thư viện texture không phản hồi (${res.status}).`);
    const list = Object.entries(await res.json() as Record<string, Entry>);
    this.catalog = { at: Date.now(), list };
    return list;
  }

  /** Texture sets matching a description (English works best: "smooth concrete", "rusty corrugated metal"). */
  async search(query: string, limit = 12): Promise<TextureHit[]> {
    const words = query.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1);
    const scored = (await this.entries()).map(([id, e]) => {
      const tags = (e.tags ?? []).map((t) => t.toLowerCase()), cats = (e.categories ?? []).map((c) => c.toLowerCase());
      const name = e.name.toLowerCase(), desc = (e.description ?? '').toLowerCase();
      let s = 0, all = true;
      for (const w of words) {
        let hit = 0;
        if (cats.some((c) => c === w || c.startsWith(w))) hit += 4;
        if (tags.some((t) => t === w || t.startsWith(w))) hit += 3;
        if (name.includes(w) || id.includes(w)) hit += 3;
        if (desc.includes(w)) hit += 1;
        if (!hit) all = false;
        s += hit;
      }
      // A set that shows everything asked for beats one that matches a single word strongly.
      if (all && words.length > 1) s += 6;
      return { id, e, s };
    }).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
    return scored.slice(0, Math.max(1, Math.min(40, limit))).map(({ id, e }) => ({
      id, name: e.name, categories: e.categories ?? [], tags: e.tags ?? [], sizeM: e.dimensions?.[0] ? e.dimensions[0] / 1000 : null, description: (e.description ?? '').slice(0, 220),
    }));
  }

  /** A Poly Haven thumbnail (cached), for the Studio's texture browser. */
  async thumbnail(id: string): Promise<Buffer | null> {
    if (!/^[a-z0-9_]{2,80}$/.test(id)) return null;
    const hit = this.thumbs.get(id);
    if (hit) return hit;
    const res = await this.fetchImpl(`https://cdn.polyhaven.com/asset_img/thumbs/${id}.png?width=256&height=256`, { headers: UA, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (this.thumbs.size > 400) this.thumbs.delete(this.thumbs.keys().next().value!);
    this.thumbs.set(id, buf);
    return buf;
  }

  /** Downloads a set (colour, normal, AO/roughness/metalness) into the project. */
  async download(projectId: string, id: string, res: '1k' | '2k' = '1k'): Promise<TextureSet> {
    if (!/^[a-z0-9_]{2,80}$/.test(id)) throw new Error('Mã texture không hợp lệ.');
    const entry = (await this.entries()).find(([k]) => k === id)?.[1];
    if (!entry) throw new Error(`Không có texture "${id}" trong thư viện (dùng find_texture).`);
    let files: Record<string, Record<string, { jpg?: { url: string }; png?: { url: string } }>> | null = null;
    const files_ = async () => {
      if (files) return files;
      const r = await this.fetchImpl(`${API}/files/${id}`, { headers: UA, signal: AbortSignal.timeout(20_000) });
      if (!r.ok) throw new Error(`Không lấy được danh sách file của "${id}" (${r.status}).`);
      return (files = await r.json() as typeof files);
    };
    const out: TextureSet['files'] = [];
    const get = async (map: 'Diffuse' | 'nor_gl' | 'arm', short: string): Promise<string | undefined> => {
      const name = `polyhaven/${id}/${short}_${res}.jpg`;
      const reused = await this.store.reuseFile(projectId, name);
      if (reused) { out.push(reused); return reused.id; }
      const url = (await files_())?.[map]?.[res]?.jpg?.url ?? (await files_())?.[map]?.['1k']?.jpg?.url;
      if (!url) return undefined;
      const r = await this.fetchImpl(url, { headers: UA, signal: AbortSignal.timeout(60_000) });
      if (!r.ok) throw new Error(`Tải ${short} của "${id}" lỗi (${r.status}).`);
      const f = await this.store.addFile(projectId, name, Buffer.from(await r.arrayBuffer()));
      out.push(f);
      return f.id;
    };
    const albedo = await get('Diffuse', 'albedo');
    if (!albedo) throw new Error(`"${id}" không có ảnh màu.`);
    const normal = await get('nor_gl', 'normal'), orm = await get('arm', 'orm');
    return {
      maps: { albedo, ...(normal ? { normal } : {}), ...(orm ? { orm } : {}) },
      scale: entry.dimensions?.[0] ? Math.max(.1, Math.min(50, entry.dimensions[0] / 1000)) : 2,
      source: { kind: 'polyhaven', id, name: entry.name, license: 'CC0', url: `https://polyhaven.com/a/${id}` },
      files: out,
    };
  }

  get canPaint(): boolean { return !!this.ai?.imageAccess(); }

  /** Paints a seamless colour texture with the AI image model and derives the other maps. */
  async paint(projectId: string, prompt: string, opts: { roughness?: number; metalness?: number; scale?: number; normalStrength?: number } = {}): Promise<TextureSet> {
    const access = this.ai?.imageAccess();
    if (!access) throw new Error('Chưa có API key AI (Cấu hình AI) để vẽ texture.');
    const full = `Seamless tileable PBR base color (albedo) texture, square, top-down orthographic view straight onto the surface, evenly lit, no shadows, no highlights, no perspective, no objects or text, fills the whole frame: ${prompt}`;
    const res = await this.fetchImpl(`${access.baseUrl.replace(/\/$/, '')}/images/generations`, {
      method: 'POST', signal: AbortSignal.timeout(240_000),
      headers: { 'content-type': 'application/json', authorization: `Bearer ${access.key}` },
      body: JSON.stringify({ model: access.model, prompt: full, size: '1024x1024', n: 1, quality: 'high', output_format: 'png' }),
    }).catch((err: Error) => { throw new Error(redact(`Không kết nối được máy chủ ảnh AI: ${err.message}`, access.key)); });
    if (!res.ok) {
      // Gateways answer outages with an HTML page: keep only its text, and say what to do instead.
      const body = (await res.text().catch(() => '')).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
      throw new Error(redact(`Model ảnh trả lỗi ${res.status}${body ? `: ${body}` : ''}. Dùng find_texture/download_texture hoặc vật liệu preset thay thế.`, access.key));
    }
    const body = await res.json() as { data?: Array<{ b64_json?: string; url?: string }> };
    const item = body.data?.[0];
    let bytes: Buffer | null = item?.b64_json ? Buffer.from(item.b64_json, 'base64') : null;
    if (!bytes && item?.url?.startsWith('https://')) {
      const r = await this.fetchImpl(item.url, { signal: AbortSignal.timeout(60_000) });
      if (r.ok) bytes = Buffer.from(await r.arrayBuffer());
    }
    if (!bytes) throw new Error('Model ảnh không trả về ảnh.');
    if (bytes[0] !== 0x89) throw new Error('Model ảnh trả về định dạng không phải PNG (thử model ảnh khác trong Cấu hình AI).');
    const size = 1024;
    const img = makeTileable(resizeSquare(decodePng(new Uint8Array(bytes), (b) => new Uint8Array(inflateSync(b))), size));
    const maps = deriveMaps(img, { roughness: opts.roughness ?? .8, metalness: opts.metalness ?? 0, normalStrength: opts.normalStrength ?? 1 });
    const deflate = (b: Uint8Array) => new Uint8Array(deflateSync(b, { level: 6 }));
    const stamp = Date.now().toString(36);
    const save = (name: string, rgba: Uint8Array) => this.store.addFile(projectId, `ai/${stamp}/${name}.png`, Buffer.from(encodePng(size, size, rgba, deflate, false)));
    const a = await save('albedo', img.data), n = await save('normal', maps.normal), o = await save('orm', maps.orm);
    return {
      maps: { albedo: a.id, normal: n.id, orm: o.id }, scale: opts.scale ?? 2,
      source: { kind: 'ai', id: stamp, name: prompt.slice(0, 200) },
      files: [a, n, o],
    };
  }
}
