import { z } from 'zod';
import { DocBuilder, tf } from './build';
import { ASSET_KINDS, PRIMITIVE_SHAPES, STAIR_SHAPES, STAIR_STYLES, TEXTURE_PATTERNS, planSchema, subtree, type ModelDoc, type ModelNode } from './doc';
import { buildPlan, checkPlan, fitStairs, planSummary, reviewStairs, snapPlan, wellsFor } from './plans';
import { evaluate, bounds } from './evaluate';
import { FURNITURE_KINDS, furniture } from './furniture';
import { ROOM_TYPES, generateHouse } from './house';
import { searchKnowledge } from './knowledge';
import { MATERIAL_PRESETS, materialFromPreset, matchPreset } from './materials';
import { Random } from './noise';
import { materialTextures } from './textures';
import { autoFix, describeDoc, validateDoc, type ValidationReport } from './validate';

/**
 * The Model Studio's tools: every change the AI agent (or a scripted workflow) can make to a
 * project, each with a schema for its arguments, a permission class, and a result the agent can
 * read. They work on the project document only; saving, exporting and publishing go through the
 * host (`ToolHost`), which decides what needs an admin's confirmation. Reasoning (which tool,
 * with what) lives in the agent; geometry, materials and checks live here.
 */
export type ToolPermission = 'read' | 'edit' | 'persist' | 'publish';

export interface CatalogAsset { id: number; key: string; name: string; category: string; model: string; tags: string[]; radius: number; height: number }

export interface ToolHost {
  /** The game's model library. */
  assets: CatalogAsset[];
  /** Files imported into the project. */
  files?: Array<{ id: string; name: string; kind: string }>;
  save?: (doc: ModelDoc, note: string) => Promise<{ version: number }>;
  exportModel?: (doc: ModelDoc, mode: 'game' | 'editable') => Promise<{ bytes: number; triangles: number; warnings: string[]; file?: string }>;
  /** Asks the admin to publish (never publishes by itself). */
  requestPublish?: (doc: ModelDoc, options: { lotClass?: string; replaceAsset?: number; note: string }) => Promise<{ request: string }>;
  /** Optional external research (documentation search). */
  research?: (query: string) => Promise<string[]>;
  /** The AI designs every building itself: the whole-house generator is not offered. */
  designOnly?: boolean;
  /** Real texture sets: a PBR library to search and download, and AI painting. */
  textures?: {
    canPaint: boolean;
    search(query: string, limit: number): Promise<Array<{ id: string; name: string; categories: string[]; tags: string[]; sizeM: number | null; description: string }>>;
    download(id: string, res: '1k' | '2k'): Promise<TextureSetResult>;
    paint(prompt: string, opts: { roughness?: number; metalness?: number; scale?: number }): Promise<TextureSetResult>;
  };
}

export interface TextureSetResult {
  maps: { albedo: string; normal?: string; orm?: string };
  scale: number;
  source: { kind: 'polyhaven' | 'ai'; id: string; name: string; license?: string; url?: string };
  files: Array<{ id: string; name: string; mime: string; size: number }>;
}

/** Puts a texture set on a material (and the material on parts). */
function applySet(state: ToolState, materialId: string, set: TextureSetResult, opts: { scale?: number; assignTo?: string[]; name?: string; preset?: string }): Record<string, unknown> {
  let m = state.doc.materials.find((x) => x.id === materialId);
  if (!m) {
    m = materialFromPreset(materialId, opts.preset ?? 'concrete', { name: opts.name ?? set.source.name });
    state.doc.materials.push(m);
  }
  m.maps = set.maps;
  m.source = set.source;
  m.texture.scale = Math.max(.1, Math.min(50, opts.scale ?? set.scale));
  // The maps carry colour, roughness and metalness; factors stay neutral.
  m.color = '#ffffff';
  if (opts.name) m.name = opts.name;
  let assigned = 0;
  for (const id of opts.assignTo ?? []) for (const n of subtree(state.doc, node(state.doc, id).id)) if ('material' in n) { (n as { material: string }).material = m.id; assigned++; }
  state.host.files = [...(state.host.files ?? []), ...set.files.map((f) => ({ id: f.id, name: f.name, kind: f.mime }))];
  state.changed = true;
  return { material: m.id, source: set.source, tileMetres: m.texture.scale, maps: Object.keys(set.maps), assigned };
}

export interface ToolState { doc: ModelDoc; host: ToolHost; changed: boolean }

export interface ToolDefinition<A = unknown> {
  name: string;
  description: string;
  permission: ToolPermission;
  /** Argument shape shown to the model (JSON-schema-like). */
  params: Record<string, unknown>;
  schema: z.ZodType<A>;
  run(args: A, state: ToolState): Promise<unknown> | unknown;
}

const vec3 = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
const node = (doc: ModelDoc, id: string): ModelNode => {
  const n = doc.nodes.find((x) => x.id === id || x.name === id);
  if (!n) throw new Error(`Không có phần "${id}". Dùng inspect_scene để xem id.`);
  return n;
};
const parentOk = (doc: ModelDoc, id: string | null | undefined) => (id ? node(doc, id).id : null);
const deg = (v: [number, number, number] | undefined) => (v ? v.map((d) => d * Math.PI / 180) as [number, number, number] : undefined);

function defineTool<A>(t: ToolDefinition<A>): ToolDefinition<A> { return t; }

const textureArgs = z.object({
  pattern: z.enum(TEXTURE_PATTERNS).optional(), scale: z.number().min(.05).max(50).optional(), seed: z.number().int().min(0).optional(),
  wear: z.number().min(0).max(1).optional(), dirt: z.number().min(0).max(1).optional(), moss: z.number().min(0).max(1).optional(), cracks: z.number().min(0).max(1).optional(), variation: z.number().min(0).max(1).optional(),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
}).strict();

export const TOOLS: ToolDefinition<never>[] = [
  defineTool({
    name: 'search_assets', permission: 'read',
    description: 'Tìm model có sẵn trong game (cây, bụi, bàn ghế, hàng rào, xe, nhà, đá…), preset vật liệu PBR và file đã import. Kết quả gom theo NHÓM (cùng loại, khác màu/kiểu/kích thước) với mọi biến thể và số lần dự án đã dùng mỗi model — hãy dùng nhiều biến thể khác nhau, không lặp một model. Từ khóa tiếng Anh khớp tốt nhất (tree, bush, chair, table, car, crate, barrel, fence, lamp, rock…).',
    params: { query: 'string — từ khóa (en/vi)', category: 'tree|vegetation|rock|decor|structure|block (tùy chọn)', limit: 'số nhóm ≤ 30', exclude: '[id] bỏ qua' },
    schema: z.object({ query: z.string().max(120), category: z.string().max(20).optional(), limit: z.number().int().min(1).max(40).optional(), exclude: z.array(z.number().int()).max(200).optional() }).strict(),
    run: (a, s) => {
      const words = a.query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1);
      const used = new Map<number, number>();
      for (const n of s.doc.nodes) if (n.kind === 'asset') used.set(n.asset, (used.get(n.asset) ?? 0) + 1);
      const skip = new Set(a.exclude ?? []);
      const scored = s.host.assets.filter((x) => (!a.category || x.category === a.category) && !skip.has(x.id)).map((x) => {
        const hay = `${x.key} ${x.name} ${x.tags.join(' ')} ${x.category}`.toLowerCase().replace(/[_.]/g, ' ');
        let score = 0, all = true;
        for (const w of words) {
          const hit = new RegExp(`(^|\\s)${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(hay) ? 3 : hay.includes(w) ? 1 : 0;
          if (!hit) all = false;
          score += hit;
        }
        if (all && words.length > 1) score += 3;
        return { x, score };
      }).filter((r) => !words.length || r.score > 0);
      // Variants of one thing (tree_small_a…e, table_dark/wood/red, wall_a/b/c): one group each.
      const family = (key: string) => key.replace(/^[a-z]+\./, '').replace(/([_-](?:[a-z]|\d+|dark|wood|red|metal|long|round|big|small|large|old|new|green|blue|white|black|grey|brown))+$/i, '') || key;
      const groups = new Map<string, { score: number; items: typeof scored }>();
      for (const r of scored) {
        const g = groups.get(family(r.x.key)) ?? { score: 0, items: [] };
        g.score = Math.max(g.score, r.score); g.items.push(r);
        groups.set(family(r.x.key), g);
      }
      const list = [...groups.entries()].sort((p, q) => q[1].score - p[1].score || q[1].items.length - p[1].items.length).slice(0, a.limit ?? 16);
      return {
        groups: list.map(([name, g]) => ({
          group: name, category: g.items[0]!.x.category,
          // Least used first: the next placement should take one of these.
          variants: [...g.items].sort((p, q) => (used.get(p.x.id) ?? 0) - (used.get(q.x.id) ?? 0) || q.score - p.score).slice(0, 12)
            .map(({ x }) => ({ id: x.id, name: x.name, size: `r ${x.radius.toFixed(2)} m, cao ${x.height.toFixed(2)} m`, ...(used.get(x.id) ? { usedInProject: used.get(x.id) } : {}) })),
        })),
        totalMatches: scored.length,
        materials: MATERIAL_PRESETS.filter((p) => !words.length || words.some((w) => p.keywords.some((k) => k.includes(w)) || p.id.includes(w))).slice(0, 6).map((p) => ({ preset: p.id, name: p.name })),
        files: (s.host.files ?? []).filter((f) => !words.length || words.some((w) => f.name.toLowerCase().includes(w))).slice(0, 10),
        hint: 'Đặt nhiều vật cùng loại: xoay vòng các biến thể trong nhóm (ưu tiên model chưa dùng), đổi góc xoay và tỉ lệ 0.85–1.15.',
      };
    },
  }),
  defineTool({
    name: 'inspect_model', permission: 'read',
    description: 'Xem chi tiết một model game (theo id số) hoặc một phần trong dự án (theo id): kích thước, loại, vật liệu, tham số.',
    params: { asset: 'number (tùy chọn)', node: 'string id phần (tùy chọn)' },
    schema: z.object({ asset: z.number().int().optional(), node: z.string().optional() }).strict(),
    run: (a, s) => {
      if (a.asset !== undefined) {
        const x = s.host.assets.find((v) => v.id === a.asset);
        if (!x) throw new Error(`Không có model #${a.asset}.`);
        return { ...x, note: 'Đặt bằng assemble_model; gốc model ở đáy, giữa.' };
      }
      if (!a.node) throw new Error('Cần asset hoặc node.');
      const n = node(s.doc, a.node);
      const sub = subtree(s.doc, n.id);
      const tmp = { ...s.doc, nodes: sub.map((x) => (x.id === n.id ? { ...x, parent: null } : x)) };
      const bb = bounds(evaluate(tmp), (id) => s.host.assets.find((v) => v.id === id));
      return { node: n, children: sub.length - 1, size: bb ? bb.max.map((v, i) => +(v - bb.min[i]!).toFixed(2)) : null };
    },
  }),
  defineTool({
    name: 'inspect_scene', permission: 'read',
    description: 'Cây phân cấp của dự án: id, loại, tên, vị trí, vật liệu, kích thước tổng; dùng trước khi sửa.',
    params: { maxNodes: 'number (mặc định 120)' },
    schema: z.object({ maxNodes: z.number().int().min(10).max(400).optional() }).strict(),
    run: (a, s) => ({ scene: describeDoc(s.doc, a.maxNodes ?? 120) }),
  }),
  defineTool({
    name: 'create_geometry', permission: 'edit',
    description: [
      'Tạo hình học procedural. type:',
      '- house (chỉ khi người dùng muốn nhà mẫu nhanh; KHÔNG dùng khi thiết kế công trình): cả ngôi nhà (phòng, tường có cửa/cửa sổ, sàn, cầu thang, trần, mái, nội thất, sân vườn, hàng rào). params: { style: rural|modern|postapoc|cottage, floors: 1|2, rooms: [living|kitchen|dining|bedroom|bathroom|storage…], abandonedYears: 0–300, furniture, yard, fence, garden: boolean, seed }',
      '- rock: một tảng đá tự nhiên. params: { width, height, depth, roughness 0–1, layers 0–1, detail 1–5, seed }',
      '- rock_formation: cụm đá (một tảng chính + đá vệ tinh). params: { size (m), count, seed, roughness, layers }',
      `- primitive: params.shape ∈ ${PRIMITIVE_SHAPES.join('|')}; box {width,height,depth}, cylinder {radius,height,segments}, cone {radius,radiusTop,height}, sphere {radius}, plane {width,depth}, wedge {width,height,depth,ridge}, torus {radius,tube}, capsule {radius,height}`,
      '- wall: { length, height, thickness, openings: [{kind: door|window|arch|hole, offset, width, height, sill}] } (dọc trục x, mặt +z là mặt ngoài)',
      '- slab: { width, depth, thickness, holes: [{x,z,width,depth}] }; stairs: { width, rise, run, steps, shape: straight|l|u|spiral, style: solid|stringer|open, turn: left|right, landing, railing, railMaterial } (đi lên theo +z); roof: { style: gable|hip|shed|flat, width, depth, rise, overhang, thickness, damage, seed }',
      `- furniture: params.kind ∈ ${FURNITURE_KINDS.join('|')} (gốc ở giữa mép sau, quay mặt +z)`,
      'Mọi kiểu đều nhận name, parent, material (id vật liệu đã có hoặc tên preset), position [x,y,z] m, rotation [x,y,z] độ, scale.',
    ].join('\n'),
    params: { type: 'house|rock|rock_formation|primitive|wall|slab|stairs|roof|furniture', name: 'string', parent: 'string id (tùy chọn)', material: 'string', position: '[x,y,z]', rotation: '[x,y,z] độ', scale: '[x,y,z]', params: 'object theo type' },
    schema: z.object({
      type: z.enum(['house', 'rock', 'rock_formation', 'primitive', 'wall', 'slab', 'stairs', 'roof', 'furniture']),
      name: z.string().max(80).optional(), parent: z.string().nullable().optional(), material: z.string().max(64).optional(),
      position: vec3.optional(), rotation: vec3.optional(), scale: vec3.optional(),
      params: z.record(z.unknown()).optional(),
    }).strict(),
    run: (a, s) => {
      const b = new DocBuilder(s.doc), p = (a.params ?? {}) as Record<string, unknown>;
      const parent = parentOk(s.doc, a.parent);
      const at = { ...(a.position ? { position: a.position } : {}), ...(a.rotation ? { rotation: deg(a.rotation)! } : {}), ...(a.scale ? { scale: a.scale } : {}) };
      const mat = (fallback: string) => {
        const want = a.material ?? fallback;
        if (s.doc.materials.some((m) => m.id === want)) return want;
        const preset = matchPreset(want);
        return b.material(preset.id, preset.id).id;
      };
      const num = (k: string, d: number) => (typeof p[k] === 'number' && Number.isFinite(p[k]) ? p[k] as number : d);
      s.changed = true;
      switch (a.type) {
        case 'house': {
          if (s.host.designOnly) throw new Error('Không dùng bộ sinh nhà dựng sẵn: tự thiết kế từng tầng bằng draw_floor_plan rồi build_floor.');
          const rooms = Array.isArray(p.rooms) ? (p.rooms as string[]).filter((r): r is typeof ROOM_TYPES[number] => (ROOM_TYPES as readonly string[]).includes(r)) : undefined;
          const r = generateHouse(s.doc, {
            seed: num('seed', Date.now() % 100000), style: (['rural', 'modern', 'postapoc', 'cottage'] as const).find((x) => x === p.style) ?? 'rural',
            floors: p.floors === 2 ? 2 : p.floors === 1 ? 1 : undefined, ...(rooms?.length ? { rooms } : {}), abandonedYears: num('abandonedYears', 0),
            furniture: p.furniture !== false, yard: p.yard !== false, fence: p.fence !== false, garden: p.garden !== false, name: a.name ?? 'Ngôi nhà',
          }, parent);
          if (a.position || a.rotation) { const n = node(s.doc, r.root); n.transform = tf({ ...n.transform, ...at }); }
          s.doc.kind = 'building';
          return { root: r.root, footprint: r.footprint, height: r.height, floors: r.floors, rooms: r.rooms.map((x) => `${x.name} (tầng ${x.floor + 1}, ${x.area} m²)`), doors: r.doors, windows: r.windows, furniture: r.furniture, damage: r.damage, notes: r.notes };
        }
        case 'rock': {
          const id = b.rock(a.name ?? 'Tảng đá', parent, { width: num('width', 2), height: num('height', 1.4), depth: num('depth', 1.8), roughness: num('roughness', .55), layers: num('layers', .35), detail: num('detail', 4), seed: num('seed', 1) }, mat('rock_granite'), at);
          return { node: id };
        }
        case 'rock_formation': {
          const size = num('size', 3), count = Math.max(1, Math.min(12, Math.round(num('count', 4)))), rnd = new Random(num('seed', 7));
          const g = b.group(a.name ?? 'Cụm đá', parent, at, { tags: ['rocks'] });
          const m = mat('rock_granite');
          b.rock('Tảng chính', g, { width: size, height: size * .7, depth: size * .85, roughness: num('roughness', .6), layers: num('layers', .4), detail: 4, seed: rnd.int(1, 1e6) }, m);
          for (let i = 1; i < count; i++) {
            const ang = rnd.next() * Math.PI * 2, dist = size * (.45 + rnd.next() * .5), k = .2 + rnd.next() * .35;
            b.rock('Đá nhỏ', g, { width: size * k, height: size * k * .7, depth: size * k * .9, roughness: .6, layers: .3, detail: 3, seed: rnd.int(1, 1e6) }, m, { position: [Math.cos(ang) * dist, 0, Math.sin(ang) * dist], rotation: [0, rnd.next() * 6.28, 0] });
          }
          if (s.doc.nodes.length === count + 1) s.doc.kind = 'rock';
          return { node: g, rocks: count };
        }
        case 'primitive': {
          const shape = (PRIMITIVE_SHAPES as readonly string[]).includes(String(p.shape)) ? p.shape as typeof PRIMITIVE_SHAPES[number] : 'box';
          const params = Object.fromEntries(Object.entries(p).filter(([, v]) => typeof v === 'number')) as Record<string, number>;
          return { node: b.primitive(a.name ?? shape, parent, shape, params, mat('concrete'), at) };
        }
        case 'wall': {
          const openings = Array.isArray(p.openings) ? (p.openings as Array<Record<string, unknown>>).map((o) => ({ kind: (['door', 'window', 'arch', 'hole'] as const).find((k) => k === o.kind) ?? 'window', offset: Number(o.offset ?? 0), width: Number(o.width ?? 1), height: Number(o.height ?? 1.2), sill: Number(o.sill ?? (o.kind === 'door' ? 0 : .9)) })) : [];
          return { node: b.wall(a.name ?? 'Tường', parent, num('length', 4), num('height', 2.8), num('thickness', .2), openings, mat('plaster_white'), at) };
        }
        case 'slab': return { node: b.slab(a.name ?? 'Sàn', parent, num('width', 4), num('depth', 4), num('thickness', .15), Array.isArray(p.holes) ? p.holes as never : [], mat('concrete'), at) };
        case 'stairs': {
          const rise = num('rise', 2.9), steps = Math.max(1, Math.round(num('steps', Math.round(rise / .18))));
          const id = b.stairs(a.name ?? 'Cầu thang', parent, num('width', 1), rise, num('run', steps * .27), steps, mat('wood_oak'), at);
          const n = s.doc.nodes.find((x) => x.id === id);
          const pick = <T extends string>(v: unknown, list: readonly T[]) => (list as readonly unknown[]).includes(v) ? v as T : undefined;
          if (n && n.kind === 'stairs') {
            const shape = pick(p.shape, STAIR_SHAPES), style = pick(p.style, STAIR_STYLES), turn = pick(p.turn, ['left', 'right'] as const);
            Object.assign(n, { ...(shape ? { shape } : {}), ...(style ? { style } : {}), ...(turn ? { turn } : {}), ...(typeof p.landing === 'number' ? { landing: p.landing } : {}), railing: p.railing !== false, ...(typeof p.railMaterial === 'string' ? { railMaterial: p.railMaterial } : {}) });
          }
          return { node: id };
        }
        case 'roof': {
          const style = (['gable', 'hip', 'shed', 'flat'] as const).find((x) => x === p.style) ?? 'gable';
          return { node: b.roof(a.name ?? 'Mái', parent, { style, width: num('width', 8), depth: num('depth', 6), rise: num('rise', 2), overhang: num('overhang', .4), thickness: num('thickness', .14), damage: num('damage', 0), seed: num('seed', 3) }, mat('roof_tiles'), at) };
        }
        case 'furniture': {
          const kind = (FURNITURE_KINDS as readonly string[]).includes(String(p.kind)) ? p.kind as typeof FURNITURE_KINDS[number] : 'table';
          const m = { wood: mat('wood_oak'), fabric: b.material('fabric', 'fabric').id, metal: b.material('metal_steel', 'metal_steel').id, ceramic: b.material('paint_metal', 'paint_metal').id, top: b.material('ceramic_tiles', 'ceramic_tiles').id };
          const g = furniture(b, kind, parent, m, { position: at.position ?? [0, 0, 0], yaw: at.rotation?.[1] ?? 0 });
          return { node: g };
        }
      }
    },
  }),
  defineTool({
    name: 'assemble_model', permission: 'edit',
    description: 'Lắp các model có sẵn của game vào dự án (giữ nguyên model gốc, chỉ tham chiếu): mỗi phần {asset: id số, position [x,y,z] m, rotation [x,y,z] độ, scale số hoặc [x,y,z], name?}; group?: tên nhóm mới; snap?: bước lưới (m) để căn vị trí.',
    params: { parts: '[{asset, position, rotation?, scale?, name?}]', group: 'string (tùy chọn)', parent: 'string id (tùy chọn)', snap: 'number (tùy chọn)' },
    schema: z.object({
      parts: z.array(z.object({ asset: z.number().int(), position: vec3, rotation: vec3.optional(), scale: z.union([z.number().positive(), vec3]).optional(), name: z.string().max(80).optional() }).strict()).min(1).max(200),
      group: z.string().max(80).optional(), parent: z.string().optional(), snap: z.number().min(.01).max(10).optional(),
    }).strict(),
    run: (a, s) => {
      const b = new DocBuilder(s.doc);
      let parent = parentOk(s.doc, a.parent);
      if (a.group) parent = b.group(a.group, parent);
      const ids: string[] = [];
      for (const part of a.parts) {
        const x = s.host.assets.find((v) => v.id === part.asset);
        if (!x) throw new Error(`Không có model #${part.asset} (dùng search_assets).`);
        const snap = (v: number) => (a.snap ? Math.round(v / a.snap) * a.snap : v);
        const sc = typeof part.scale === 'number' ? [part.scale, part.scale, part.scale] as [number, number, number] : part.scale;
        ids.push(b.asset(part.name ?? x.name, parent, x.id, { position: part.position.map(snap) as [number, number, number], ...(part.rotation ? { rotation: deg(part.rotation)! } : {}), ...(sc ? { scale: sc } : {}) }));
      }
      s.changed = true;
      return { group: parent, nodes: ids };
    },
  }),
  defineTool({
    name: 'create_or_edit_material', permission: 'edit',
    description: 'Tạo hoặc sửa vật liệu PBR (preset = vật liệu thật: rock_granite, brick_red, plaster_white, concrete, wood_oak, wood_planks, wood_weathered, metal_steel, metal_rust, metal_corrugated, roof_tiles, roof_shingles, fabric, ceramic_tiles, glass, grass, gravel, bark, leaves…), chỉnh color/roughness/metalness/opacity và texture (pattern, scale m/ô, wear, dirt, moss, cracks, variation, accent), rồi gán cho các phần (assign_to).',
    params: { id: 'string (tùy chọn: sửa vật liệu có sẵn)', preset: 'string', name: 'string', color: '#rrggbb', roughness: '0–1', metalness: '0–1', opacity: '0.02–1', texture: '{pattern?, scale?, wear?, dirt?, moss?, cracks?, variation?, accent?}', assign_to: '[node id] (áp cho cả phần con)' },
    schema: z.object({
      id: z.string().max(64).optional(), preset: z.string().max(40).optional(), name: z.string().max(80).optional(),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(), roughness: z.number().min(0).max(1).optional(), metalness: z.number().min(0).max(1).optional(), opacity: z.number().min(.02).max(1).optional(),
      texture: textureArgs.optional(), assign_to: z.array(z.string()).max(400).optional(),
    }).strict(),
    run: (a, s) => {
      let m = a.id ? s.doc.materials.find((x) => x.id === a.id) : undefined;
      if (!m) {
        const preset = matchPreset(a.preset ?? a.name ?? 'concrete');
        const id = a.id ?? `${preset.id}-${s.doc.materials.filter((x) => x.preset === preset.id).length + 1}`;
        m = materialFromPreset(id, preset.id, { ...(a.name ? { name: a.name } : {}), wear: a.texture?.wear, dirt: a.texture?.dirt, moss: a.texture?.moss, cracks: a.texture?.cracks });
        s.doc.materials.push(m);
      }
      if (a.name) m.name = a.name;
      if (a.color) m.color = a.color;
      if (a.roughness !== undefined) m.roughness = a.roughness;
      if (a.metalness !== undefined) m.metalness = a.metalness;
      if (a.opacity !== undefined) { m.opacity = a.opacity; if (a.opacity < 1) m.doubleSided = true; }
      if (a.texture) Object.assign(m.texture, Object.fromEntries(Object.entries(a.texture).filter(([, v]) => v !== undefined)));
      let assigned = 0;
      for (const id of a.assign_to ?? []) for (const n of subtree(s.doc, node(s.doc, id).id)) if ('material' in n) { (n as { material: string }).material = m.id; assigned++; }
      s.changed = true;
      const warn = m.metalness > .05 && m.metalness < .95 && !['rust', 'corrugated'].includes(m.texture.pattern) ? 'metalness giữa 0 và 1 chỉ hợp với vùng chuyển tiếp (gỉ/bụi).' : undefined;
      return { material: m, assigned, ...(warn ? { warning: warn } : {}) };
    },
  }),
  defineTool({
    name: 'generate_or_apply_texture', permission: 'edit',
    description: 'Sinh lại / đổi texture của một vật liệu (pattern, tỉ lệ, phong hóa) hoặc gán ảnh đã import làm màu nền (image_file); trả về thống kê màu, độ nhám, kim loại trung bình để kiểm tra.',
    params: { material: 'id vật liệu', texture: '{pattern?, scale?, wear?, dirt?, moss?, cracks?, variation?, accent?, seed?}', image_file: 'id file ảnh (tùy chọn)', resolution: '256|512|1024' },
    schema: z.object({ material: z.string(), texture: textureArgs.optional(), image_file: z.string().max(64).optional(), resolution: z.union([z.literal(256), z.literal(512), z.literal(1024)]).optional() }).strict(),
    run: (a, s) => {
      const m = s.doc.materials.find((x) => x.id === a.material);
      if (!m) throw new Error(`Không có vật liệu ${a.material}.`);
      if (a.texture) Object.assign(m.texture, Object.fromEntries(Object.entries(a.texture).filter(([, v]) => v !== undefined)));
      if (a.image_file) {
        if (s.host.files && !s.host.files.some((f) => f.id === a.image_file)) throw new Error(`Không có file ${a.image_file}.`);
        m.albedoFile = a.image_file;
      }
      if (a.resolution) m.resolution = a.resolution;
      s.changed = true;
      const t = materialTextures(m, 64);
      let r = 0, g = 0, bl = 0, rough = 0, metal = 0;
      const n = t.size * t.size;
      for (let i = 0; i < n; i++) { r += t.albedo[i * 4]!; g += t.albedo[i * 4 + 1]!; bl += t.albedo[i * 4 + 2]!; rough += t.orm[i * 4 + 1]!; metal += t.orm[i * 4 + 2]!; }
      const hex = (v: number) => Math.round(v / n).toString(16).padStart(2, '0');
      return { material: m.id, texture: m.texture, meanColor: `#${hex(r)}${hex(g)}${hex(bl)}`, meanRoughness: +(rough / n / 255).toFixed(2), meanMetalness: +(metal / n / 255).toFixed(2), maps: ['baseColor', 'normal', 'occlusion', 'roughness', 'metallic'] };
    },
  }),
  defineTool({
    name: 'define_materials', permission: 'edit',
    description: [
      'Lập BẢNG VẬT LIỆU trước khi vẽ/dựng: liệt kê mọi vật liệu công trình dùng và dùng ở đâu, đúng thực tế của loại công trình và từng khu vực/bộ phận (kết cấu bê tông, gạch xây, vữa trát, sơn nước, đá granite mặt bậc, gạch men, gạch terrazzo, gỗ, thép hộp, inox, nhôm kính, nhựa PVC, tôn, ngói…), có biến thể tự nhiên giữa các khu vực (vd mặt bậc granite đỏ nhám ở cầu thang chính, gạch chống trơn ở cầu thang phụ; tay vịn gỗ ở khu này, thép sơn ở khu kia).',
      'Mỗi mục: {id, name, uses: [nơi dùng], preset (vật liệu PBR gần nhất), texture_query (tiếng Anh, tải texture thật) hoặc paint_prompt (AI vẽ), roughness?, metalness?, color?, note?}. Gọi lại để thêm/sửa mục; mục có sẵn được giữ.',
    ].join('\n'),
    params: { materials: '[{id, name, uses, preset, texture_query?, paint_prompt?, roughness?, metalness?, color?, note?}]' },
    schema: z.object({ materials: z.array(z.object({
      id: z.string().regex(/^[a-z0-9_-]{2,40}$/), name: z.string().min(1).max(80), uses: z.array(z.string().max(80)).min(1).max(30), preset: z.string().max(40).optional(),
      texture_query: z.string().max(120).optional(), paint_prompt: z.string().max(600).optional(), roughness: z.number().min(0).max(1).optional(), metalness: z.number().min(0).max(1).optional(),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(), note: z.string().max(300).optional(),
    }).strict()).min(1).max(60) }).strict(),
    run: async (a, s) => {
      const results: Array<Record<string, unknown>> = [];
      const schedule = new Map((s.doc.schedule ?? []).map((x) => [x.material, x]));
      for (const item of a.materials) {
        let m = s.doc.materials.find((x) => x.id === item.id);
        if (!m) { m = materialFromPreset(item.id, matchPreset(item.preset ?? item.name).id, { name: item.name }); s.doc.materials.push(m); }
        m.name = item.name;
        if (item.roughness !== undefined) m.roughness = item.roughness;
        if (item.metalness !== undefined) m.metalness = item.metalness;
        if (item.color) m.color = item.color;
        schedule.set(item.id, { material: item.id, uses: item.uses, ...(item.note ? { note: item.note } : {}) });
        const row: Record<string, unknown> = { id: item.id, preset: m.preset };
        // Real textures where asked; a failure is reported for that line and the rest goes on.
        try {
          if (item.texture_query && s.host.textures) {
            const hit = (await s.host.textures.search(item.texture_query, 1))[0];
            if (hit) { applySet(s, item.id, await s.host.textures.download(hit.id, '1k'), {}); row.texture = hit.name; m.name = item.name; }
            else row.texture = `không thấy "${item.texture_query}"`;
          } else if (item.paint_prompt && s.host.textures?.canPaint) {
            applySet(s, item.id, await s.host.textures.paint(item.paint_prompt, { ...(item.roughness !== undefined ? { roughness: item.roughness } : {}), ...(item.metalness !== undefined ? { metalness: item.metalness } : {}) }), {});
            row.texture = 'AI vẽ'; m.name = item.name;
          }
        } catch (err) { row.textureError = (err as Error).message; }
        results.push(row);
      }
      s.doc.schedule = [...schedule.values()];
      s.changed = true;
      return { schedule: s.doc.schedule.length, results, next: 'Dùng đúng các id này trong bản vẽ (tường, sàn, finishes, cầu thang).' };
    },
  }),
  defineTool({
    name: 'draw_floor_plan', permission: 'edit',
    description: [
      'Vẽ (hoặc vẽ lại) bản vẽ mặt bằng một tầng TRƯỚC khi dựng; bản vẽ hiện ngay trong khung 3D ở cao độ của tầng. Trả về phần kiểm tra của kiến trúc sư: phòng chồng nhau/thiếu tường, cửa không đi qua được, phòng không tới được, cầu thang không vừa/thiếu giếng thang, cao độ lệch. Sửa đến khi hết lỗi rồi build_floor.',
      'Toạ độ mặt bằng x, z (mét), y lên. level 0 = tầng trệt. elevation = cao độ mặt sàn hoàn thiện (mặc định: tầng dưới + chiều cao + sàn). height = sàn tới trần. slab = dày sàn.',
      'rooms: [{id, name, type (living|bedroom|kitchen|bathroom|hall|stair|office|storage|shop|…), x0, z0, x1, z1, floorMaterial}] — phòng chữ L = nhiều hình chữ nhật cùng name.',
      'walls: [{id, a:[x,z], b:[x,z], thickness, exterior, material, innerMaterial?, height?, openings:[{kind: door|window|arch|hole, at (m tính từ a tới tâm lỗ), width, height, sill}]}] — đường tim tường; tường ngoài tự quay mặt material ra ngoài.',
      'stairs: [{id, x, z (điểm giữa mép bậc đầu tiên), width, direction: n|s|e|w (hướng đi lên; s = +z, e = +x), shape: straight|l|u|spiral, style: solid|stringer|open, turn: left|right, material, railing}] — số bậc và chiều dài tự tính theo chiều cao lên tầng trên (bậc ≤ 18 cm, mặt bậc 27 cm); kết quả trả về chỗ cầu thang chiếm và nơi lên tới.',
      'stairs còn nhận treadMaterial (mặt bậc), railMaterial (con tiện/trụ), handrailMaterial (tay vịn); material là kết cấu.',
      'voids: [{x0, z0, x1, z1}] — lỗ sàn; để trống thì giếng thang được tự tính ĐÚNG khít cầu thang tầng dưới.',
      'finishes: {plinth, plinthHeight, skirting, windowFrame, glass, sill, doorFrame, doorLeaf} — vật liệu từng bộ phận (chân tường, len chân tường, khung/kính/bậu cửa sổ, khuôn/cánh cửa); mỗi lỗ mở có thể ghi đè (frameMaterial, glassMaterial, leafMaterial, sillMaterial, leaf, open). ceilingMaterial = trần (mặt dưới sàn tầng này, tức trần tầng dưới).',
      'Mọi vật liệu PHẢI có trong bảng vật liệu (define_materials trước). Toạ độ được làm tròn theo lưới 5 cm (đơn vị đo chung của cả model): đo và đặt cho khít — cầu thang sát tường, giếng thang khít cầu thang; phần kiểm tra báo khe hở bằng cm và toạ độ cần dời.',
    ].join('\n'),
    params: { level: 'int', name: 'string', elevation: 'm (tùy chọn)', height: 'm', slab: 'm', rooms: '[...]', walls: '[...]', stairs: '[...]', voids: '[...]', notes: 'string' },
    schema: z.object({
      level: z.number().int().min(-5).max(80), name: z.string().min(1).max(80), elevation: z.number().finite().optional(), height: z.number().min(1.8).max(20).optional(), slab: z.number().min(.05).max(1).optional(),
      rooms: z.array(z.record(z.unknown())).max(60), walls: z.array(z.record(z.unknown())).max(200), stairs: z.array(z.record(z.unknown())).max(8).optional(), voids: z.array(z.record(z.unknown())).max(12).optional(), notes: z.string().max(2000).optional(),
      finishes: z.record(z.unknown()).optional(), ceilingMaterial: z.string().max(64).optional(),
    }).strict(),
    run: (a, s) => {
      const plans = s.doc.plans ?? [];
      const low = plans.find((p) => p.level === a.level - 1), old = plans.find((p) => p.level === a.level);
      const slab = a.slab ?? old?.slab ?? (a.level === 0 ? .15 : .2), height = a.height ?? old?.height ?? 2.8;
      const elevation = a.elevation ?? (low ? low.elevation + low.height + slab : a.level === 0 ? slab : old?.elevation ?? 0);
      const parsed = planSchema.safeParse({
        level: a.level, name: a.name, elevation, height, slab,
        rooms: a.rooms, walls: withPlanDefaults(a.rooms as Array<Record<string, unknown>>, a.walls as Array<Record<string, unknown>>), stairs: a.stairs ?? [], voids: a.voids ?? [], ...(a.notes ? { notes: a.notes } : {}),
        ...(a.finishes ? { finishes: a.finishes } : {}), ...(a.ceilingMaterial ? { ceilingMaterial: a.ceilingMaterial } : {}),
        ...(old?.built ? { built: old.built } : {}),
      });
      if (!parsed.success) throw new Error(`Bản vẽ sai cấu trúc: ${parsed.error.issues.slice(0, 6).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
      // One measuring unit for the whole model; wells exactly over the flights below.
      const plan = snapPlan(parsed.data);
      s.doc.plans = [...plans.filter((p) => p.level !== a.level), plan].sort((x, y) => x.level - y.level);
      const fitted = fitStairs(s.doc, plan);
      const wells = wellsFor(s.doc, plan);
      if (wells.length) plan.voids.push(...wells);
      parsed.data = plan;
      s.changed = true;
      const issues = checkPlan(s.doc, parsed.data);
      // Redrawing a storey also changes what the storeys around it need (wells, arrivals).
      const neighbours = s.doc.plans.filter((p) => Math.abs(p.level - a.level) === 1).flatMap((p) => checkPlan(s.doc, p).filter((i) => i.level === 'error').map((i) => `[${p.name}] ${i.message}`));
      const review = reviewStairs(s.doc, parsed.data);
      const failed = review.stairs.filter((x) => !x.ok).map((x) => ({ id: x.id, failed: x.checks.filter((c) => !c.ok).map((c) => `${c.item}: ${c.note}`) }));
      const ok = !issues.some((i) => i.level === 'error') && review.approved;
      return { plan: planSummary(s.doc, parsed.data), ...(wells.length ? { wellsAdded: wells } : {}), ...(fitted.length ? { fitted } : {}), grid: '5 cm', errors: issues.filter((i) => i.level === 'error').map((i) => i.message), warnings: issues.filter((i) => i.level !== 'error').map((i) => i.message), neighbourErrors: neighbours,
        stairApproval: { approved: review.approved, ...(failed.length ? { failed } : {}), stairs: review.stairs.filter((x) => x.ok).map((x) => `${x.id}: ${x.checks.map((c) => c.note).join('; ')}`) },
        next: ok ? 'Bản vẽ đã được duyệt: build_floor để dựng.' : 'CHƯA DUYỆT: sửa từng mục rồi draw_floor_plan lại tầng này (build_floor sẽ từ chối).' };
    },
  }),
  defineTool({
    name: 'build_floor', permission: 'edit',
    description: 'Dựng một tầng đúng theo bản vẽ ĐÃ DUYỆT: sàn từng phòng (chừa giếng thang), tường có cửa/cửa sổ, cầu thang. Dựng lại sẽ thay phần cũ của tầng đó. Bản vẽ còn lỗi hoặc cầu thang chưa đạt (vị trí sát tường, hướng lên, chân thang nhìn ra lối vào, chiếu nghỉ, vế tiếp theo, kết nối tầng) thì KHÔNG dựng: vẽ lại.',
    params: { level: 'int' },
    // `force` is still read (older answers send it) but never builds a drawing that failed its check.
    schema: z.object({ level: z.number().int(), force: z.boolean().optional() }).strict(),
    run: (a, s) => {
      const plan = s.doc.plans?.find((p) => p.level === a.level);
      if (!plan) throw new Error(`Chưa có bản vẽ tầng ${a.level}: draw_floor_plan trước.`);
      const errors = checkPlan(s.doc, plan).filter((i) => i.level === 'error').map((i) => i.message);
      const review = reviewStairs(s.doc, plan);
      for (const x of review.stairs) for (const c of x.checks) if (!c.ok) errors.push(`Cầu thang ${x.id} — ${c.item}: ${c.note}`);
      if (errors.length) throw new Error(`Bản vẽ chưa được duyệt, không dựng: ${errors.slice(0, 8).join(' | ')} — sửa và draw_floor_plan lại tầng ${a.level}.`);
      const r = buildPlan(s.doc, plan);
      s.changed = true;
      return { level: a.level, group: r.group, parts: r.parts, next: 'inspect_scene / validate_asset, rồi vẽ tầng tiếp theo (hoặc mái, nội thất, texture).' };
    },
  }),
  defineTool({
    name: 'find_texture', permission: 'read',
    description: 'Tìm bộ texture PBR thật (ảnh chụp/scan, CC0: màu + normal + AO/độ nhám/kim loại, kèm kích thước thật một ô) cho một bề mặt. Viết query TIẾNG ANH theo đúng vẻ ngoài cần có, vd "smooth polished concrete", "white painted plaster", "cracked dirty concrete wall", "rusty corrugated metal", "weathered wood planks", "terracotta roof tiles", "marble floor". Trả về id để download_texture.',
    params: { query: 'string (tiếng Anh)', limit: 'number ≤ 20' },
    schema: z.object({ query: z.string().min(2).max(120), limit: z.number().int().min(1).max(20).optional() }).strict(),
    run: async (a, s) => {
      if (!s.host.textures) throw new Error('Thư viện texture không khả dụng ở đây.');
      const hits = await s.host.textures.search(a.query, a.limit ?? 10);
      return { results: hits.map((h) => ({ id: h.id, name: h.name, categories: h.categories.slice(0, 5), tags: h.tags.slice(0, 8), tileMetres: h.sizeM, about: h.description })), canPaint: s.host.textures.canPaint, hint: hits.length ? 'Chọn bộ khớp nhất rồi download_texture.' : 'Không thấy: thử từ khác, hoặc paint_texture để AI tự vẽ.' };
    },
  }),
  defineTool({
    name: 'download_texture', permission: 'edit',
    description: 'Tải bộ texture tìm được (find_texture) về dự án và gắn vào một vật liệu (tạo mới nếu chưa có id đó), gán cho các phần assign_to. Cho id (từ find_texture) hoặc query (lấy bộ khớp nhất). Kích thước ô lấy theo kích thước thật của texture (đổi bằng scale).',
    params: { id: 'id từ find_texture', query: 'hoặc mô tả tiếng Anh', material: 'id vật liệu (mới hoặc có sẵn)', name: 'tên vật liệu', resolution: '1k|2k', scale: 'm mỗi ô (tùy chọn)', assign_to: '[node id]' },
    schema: z.object({ id: z.string().min(2).max(80).optional(), query: z.string().min(2).max(120).optional(), material: z.string().min(1).max(64), name: z.string().max(80).optional(), resolution: z.enum(['1k', '2k']).optional(), scale: z.number().min(.1).max(50).optional(), assign_to: z.array(z.string()).max(400).optional() }).strict(),
    run: async (a, s) => {
      if (!s.host.textures) throw new Error('Thư viện texture không khả dụng ở đây.');
      const id = a.id ?? (a.query ? (await s.host.textures.search(a.query, 1))[0]?.id : undefined);
      if (!id) throw new Error(a.query ? `Không tìm thấy texture cho "${a.query}" — thử từ khác hoặc paint_texture.` : 'Cần id hoặc query.');
      const set = await s.host.textures.download(id, a.resolution ?? '1k');
      return applySet(s, a.material, set, { ...(a.scale ? { scale: a.scale } : {}), ...(a.assign_to ? { assignTo: a.assign_to } : {}), ...(a.name ? { name: a.name } : {}) });
    },
  }),
  defineTool({
    name: 'paint_texture', permission: 'edit',
    description: 'AI vẽ một texture liền mạch (tileable) theo mô tả — dùng khi thư viện không có vẻ ngoài cần (hoa văn riêng, sơn đặc biệt, biển hiệu…). Mô tả TIẾNG ANH chi tiết về bề mặt (màu, chất liệu, độ cũ, vết bẩn). Normal và AO/độ nhám được suy ra từ ảnh; đặt roughness/metalness nền theo vật liệu thật.',
    params: { prompt: 'string (tiếng Anh)', material: 'id vật liệu', name: 'tên', roughness: '0–1', metalness: '0 hoặc 1', scale: 'm mỗi ô', assign_to: '[node id]' },
    schema: z.object({ prompt: z.string().min(8).max(600), material: z.string().min(1).max(64), name: z.string().max(80).optional(), roughness: z.number().min(0).max(1).optional(), metalness: z.number().min(0).max(1).optional(), scale: z.number().min(.1).max(50).optional(), assign_to: z.array(z.string()).max(400).optional() }).strict(),
    run: async (a, s) => {
      if (!s.host.textures?.canPaint) throw new Error('Không vẽ được texture (chưa có API key hoặc model ảnh). Dùng find_texture/download_texture.');
      const set = await s.host.textures.paint(a.prompt, { ...(a.roughness !== undefined ? { roughness: a.roughness } : {}), ...(a.metalness !== undefined ? { metalness: a.metalness } : {}), ...(a.scale ? { scale: a.scale } : {}) });
      return applySet(s, a.material, set, { ...(a.scale ? { scale: a.scale } : {}), ...(a.assign_to ? { assignTo: a.assign_to } : {}), ...(a.name ? { name: a.name } : {}) });
    },
  }),
  defineTool({
    name: 'edit_transform', permission: 'edit',
    description: 'Đổi vị trí/góc xoay (độ)/tỉ lệ, cha, tên, ẩn hiện, va chạm của một phần; mode "add" cộng thêm thay vì đặt; duplicate: nhân bản (cả phần con) rồi áp thay đổi lên bản sao; delete: xóa phần (và con) khỏi dự án.',
    params: { node: 'id', position: '[x,y,z]', rotation: '[x,y,z] độ', scale: '[x,y,z]', mode: 'set|add', parent: 'id|null', name: 'string', visible: 'boolean', collision: 'auto|mesh|none', duplicate: 'boolean', delete: 'boolean' },
    schema: z.object({
      node: z.string(), position: vec3.optional(), rotation: vec3.optional(), scale: vec3.optional(), mode: z.enum(['set', 'add']).optional(),
      parent: z.string().nullable().optional(), name: z.string().max(80).optional(), visible: z.boolean().optional(), collision: z.enum(['auto', 'mesh', 'none']).optional(),
      duplicate: z.boolean().optional(), delete: z.boolean().optional(),
    }).strict(),
    run: (a, s) => {
      let n = node(s.doc, a.node);
      if (a.delete) {
        const gone = new Set(subtree(s.doc, n.id).map((x) => x.id));
        s.doc.nodes = s.doc.nodes.filter((x) => !gone.has(x.id));
        s.changed = true;
        return { deleted: [...gone] };
      }
      if (a.duplicate) n = duplicateNode(s.doc, n.id);
      const add = a.mode === 'add', t = n.transform;
      if (a.position) t.position = add ? t.position.map((v, i) => v + a.position![i]!) as typeof t.position : a.position;
      if (a.rotation) { const r = deg(a.rotation)!; t.rotation = add ? t.rotation.map((v, i) => v + r[i]!) as typeof t.rotation : r; }
      if (a.scale) t.scale = add ? t.scale.map((v, i) => v * a.scale![i]!) as typeof t.scale : a.scale;
      if (a.parent !== undefined) {
        const p = parentOk(s.doc, a.parent);
        if (p && subtree(s.doc, n.id).some((x) => x.id === p)) throw new Error('Không thể đặt một phần làm con của chính nó.');
        n.parent = p;
      }
      if (a.name) n.name = a.name;
      if (a.visible !== undefined) n.visible = a.visible;
      if (a.collision) n.collision = a.collision;
      s.changed = true;
      return { node: n.id, transform: n.transform, parent: n.parent };
    },
  }),
  defineTool({
    name: 'validate_asset', permission: 'read',
    description: 'Kiểm tra model như game sẽ dùng: lưới hỏng, pháp tuyến đảo, vật liệu thiếu, kích thước, lơ lửng, cửa nhân vật không lọt, cầu thang không leo được, va chạm, số tam giác và draw call.',
    params: {},
    schema: z.object({}).strict(),
    run: (_a, s) => summarizeReport(validateDoc(s.doc, { asset: (id) => { const x = s.host.assets.find((v) => v.id === id); return x ? { name: x.name, model: { kind: x.model }, bounds: { radius: x.radius, height: x.height } } : undefined; }, ...(s.host.files ? { files: new Set(s.host.files.map((f) => f.id)) } : {}) })),
  }),
  defineTool({
    name: 'auto_fix', permission: 'edit',
    description: 'Tự sửa các lỗi sửa được mà không đổi thiết kế: đặt model xuống đất, nới cửa, thêm bậc cầu thang, thêm vật liệu thiếu, bỏ vật liệu thừa. Chạy sau validate_asset.',
    params: {},
    schema: z.object({}).strict(),
    run: (_a, s) => {
      const report = validateDoc(s.doc, {});
      const done = autoFix(s.doc, report);
      if (done.length) s.changed = true;
      return { fixed: done, after: summarizeReport(validateDoc(s.doc, {})) };
    },
  }),
  defineTool({
    name: 'optimize_model', permission: 'edit',
    description: 'Tối ưu: action "report" (tam giác, draw call theo vật liệu, gợi ý), "merge_materials" (gộp các vật liệu trùng thông số), "remove_unused_materials", "reduce_detail" (giảm độ chi tiết đá/hình tròn).',
    params: { action: 'report|merge_materials|remove_unused_materials|reduce_detail' },
    schema: z.object({ action: z.enum(['report', 'merge_materials', 'remove_unused_materials', 'reduce_detail']) }).strict(),
    run: (a, s) => {
      const before = validateDoc(s.doc).stats;
      const doc = s.doc;
      if (a.action === 'merge_materials') {
        const key = (m: typeof doc.materials[number]) => JSON.stringify({ ...m, id: '', name: '', texture: { ...m.texture, seed: 0 } });
        const keep = new Map<string, string>(), remap = new Map<string, string>();
        for (const m of doc.materials) { const k = key(m); if (keep.has(k)) remap.set(m.id, keep.get(k)!); else keep.set(k, m.id); }
        for (const n of doc.nodes) {
          const r = n as Partial<Record<string, unknown>>;
          for (const k of ['material', 'innerMaterial', 'bottomMaterial', 'treadMaterial', 'railMaterial', 'handrailMaterial']) if (typeof r[k] === 'string' && remap.has(r[k] as string)) r[k] = remap.get(r[k] as string);
        }
        doc.materials = doc.materials.filter((m) => !remap.has(m.id));
        if (remap.size) s.changed = true;
      }
      if (a.action === 'remove_unused_materials') { const r = validateDoc(doc); if (autoFix(doc, { ...r, issues: r.issues.filter((i) => i.code === 'unused-material') }).length) s.changed = true; }
      if (a.action === 'reduce_detail') for (const n of doc.nodes) {
        if (n.kind === 'rock' && (n.params.detail ?? 4) > 2) { n.params.detail = (n.params.detail ?? 4) - 1; s.changed = true; }
        if (n.kind === 'primitive' && (n.params.segments ?? 24) > 12) { n.params.segments = Math.max(8, Math.round((n.params.segments ?? 24) / 2)); s.changed = true; }
      }
      const after = validateDoc(doc).stats;
      return { before: { triangles: before.triangles, drawCalls: before.drawCalls, materials: before.materials }, after: { triangles: after.triangles, drawCalls: after.drawCalls, materials: after.materials }, note: 'Khi xuất cho game, hình học procedural được gộp theo vật liệu (1 draw call/vật liệu); model game tham chiếu được vẽ instanced.' };
    },
  }),
  defineTool({
    name: 'set_model_info', permission: 'edit',
    description: 'Đặt tên, loại (building|prop|rock|vegetation|furniture|vehicle|other), số tầng thiết kế (storeys — công trình chưa xong khi chưa dựng đủ số tầng này), lô đất khi dùng trong map (residential|commercial|industrial|military|abandoned) và ghi chú của model.',
    params: { name: 'string', kind: 'string', storeys: 'number', lotClass: 'string', notes: 'string' },
    schema: z.object({ name: z.string().min(1).max(80).optional(), kind: z.enum(ASSET_KINDS).optional(), storeys: z.number().int().min(1).max(40).optional(), lotClass: z.enum(['residential', 'commercial', 'industrial', 'military', 'abandoned']).optional(), notes: z.string().max(4000).optional() }).strict(),
    run: (a, s) => { Object.assign(s.doc, Object.fromEntries(Object.entries(a).filter(([, v]) => v !== undefined))); s.changed = true; return { name: s.doc.name, kind: s.doc.kind, storeys: s.doc.storeys ?? null, lotClass: s.doc.lotClass ?? null }; },
  }),
  defineTool({
    name: 'research', permission: 'read',
    description: 'Tra cứu: kiến thức tích hợp (kích thước kiến trúc; bố trí và vật liệu theo loại công trình — trường học, bệnh viện, văn phòng, biệt thự, xưởng, nhà phố; trạng thái bỏ hoang/đổ nát; PBR; giới hạn nhân vật) và Wikipedia (Anh/Việt). Dùng cụm từ NGẮN: "school building", "trường học", "stairs", "terrazzo".',
    params: { query: 'string' },
    schema: z.object({ query: z.string().min(2).max(200) }).strict(),
    run: async (a, s) => {
      const local = searchKnowledge(a.query).map((k) => `${k.topic}: ${k.text}`);
      const extra = s.host.research ? await s.host.research(a.query).catch(() => []) : [];
      return { results: [...local, ...extra].slice(0, 8) };
    },
  }),
  defineTool({
    name: 'save_project', permission: 'persist',
    description: 'Lưu một phiên bản của dự án (có thể khôi phục lại).',
    params: { note: 'string' },
    schema: z.object({ note: z.string().max(200) }).strict(),
    run: async (a, s) => {
      if (!s.host.save) throw new Error('Không lưu được ở đây.');
      return s.host.save(s.doc, a.note);
    },
  }),
  defineTool({
    name: 'export_asset', permission: 'publish',
    description: 'Xuất GLB (mode "game": gộp theo vật liệu, sẵn sàng cho game; "editable": giữ phân cấp). publish: true tạo YÊU CẦU xuất bản vào game — admin phải xác nhận trong Studio, agent không tự xuất bản.',
    params: { mode: 'game|editable', publish: 'boolean', lotClass: 'residential|commercial|industrial|military|abandoned', replaceAsset: 'number (tùy chọn)', note: 'string' },
    schema: z.object({ mode: z.enum(['game', 'editable']).optional(), publish: z.boolean().optional(), lotClass: z.string().max(20).optional(), replaceAsset: z.number().int().optional(), note: z.string().max(200).optional() }).strict(),
    run: async (a, s) => {
      const report = validateDoc(s.doc);
      if (!report.ok) return { exported: false, reason: 'Model còn lỗi, chạy validate_asset/auto_fix trước.', issues: summarizeReport(report).errors };
      const result = s.host.exportModel ? await s.host.exportModel(s.doc, a.mode ?? 'game') : null;
      const publish = a.publish && s.host.requestPublish ? await s.host.requestPublish(s.doc, { ...(a.lotClass ? { lotClass: a.lotClass } : {}), ...(a.replaceAsset ? { replaceAsset: a.replaceAsset } : {}), note: a.note ?? '' }) : null;
      return { exported: !!result, ...(result ?? {}), ...(publish ? { publishRequest: publish.request, note: 'Chờ admin xác nhận xuất bản.' } : {}) };
    },
  }),
] as never;

export const toolByName = (name: string) => TOOLS.find((t) => t.name === name);

/** Compact validation result for the agent and the log. */
export function summarizeReport(r: ValidationReport) {
  return {
    ok: r.ok,
    errors: r.issues.filter((i) => i.level === 'error').map((i) => `${i.code}${i.node ? ` @${i.node}` : ''}: ${i.message}`),
    warnings: r.issues.filter((i) => i.level === 'warning').map((i) => `${i.code}${i.node ? ` @${i.node}` : ''}: ${i.message}`).slice(0, 20),
    info: r.issues.filter((i) => i.level === 'info').length,
    stats: r.stats,
  };
}

/** Copies a node and its children with fresh ids, next to the original. */
export function duplicateNode(doc: ModelDoc, id: string): ModelNode {
  const nodes = subtree(doc, id);
  const map = new Map<string, string>();
  for (const n of nodes) {
    let k = 1, fresh: string;
    do fresh = `${n.id.replace(/-copy\d*$/, '')}-copy${k++}`; while (doc.nodes.some((x) => x.id === fresh) || [...map.values()].includes(fresh));
    map.set(n.id, fresh);
  }
  const copies = nodes.map((n) => ({ ...structuredClone(n), id: map.get(n.id)!, parent: n.id === id ? n.parent : map.get(n.parent!) ?? n.parent }) as ModelNode);
  doc.nodes.push(...copies);
  return copies[0]!;
}

/** Runs a tool by name with raw arguments (validated). */
export async function runTool(name: string, args: unknown, state: ToolState): Promise<{ ok: true; result: unknown } | { ok: false; error: string }> {
  const t = toolByName(name);
  if (!t) return { ok: false, error: `Không có tool "${name}".` };
  const parsed = (t.schema as z.ZodType<unknown>).safeParse(args ?? {});
  if (!parsed.success) return { ok: false, error: `Tham số sai: ${parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}` };
  try { return { ok: true, result: await (t as ToolDefinition<unknown>).run(parsed.data, state) }; }
  catch (err) { return { ok: false, error: (err as Error).message }; }
}

/**
 * Fields a drawing may leave out: openings (none), each opening's sill (doors 0, windows 0.9 m)
 * and whether a wall is exterior (no room on one of its sides).
 */
function withPlanDefaults(rooms: Array<Record<string, unknown>>, walls: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const num = (v: unknown) => (typeof v === 'number' ? v : NaN);
  const inRoom = (x: number, z: number) => rooms.some((r) => {
    const x0 = Math.min(num(r.x0), num(r.x1)), x1 = Math.max(num(r.x0), num(r.x1)), z0 = Math.min(num(r.z0), num(r.z1)), z1 = Math.max(num(r.z0), num(r.z1));
    return x >= x0 - .01 && x <= x1 + .01 && z >= z0 - .01 && z <= z1 + .01;
  });
  return walls.map((w) => {
    const out: Record<string, unknown> = { openings: [], ...w };
    if (Array.isArray(out.openings)) out.openings = (out.openings as Array<Record<string, unknown>>).map((o) => (o && typeof o === 'object' && o.sill === undefined ? { ...o, sill: o.kind === 'window' ? .9 : 0 } : o));
    if (typeof out.exterior !== 'boolean') {
      const a = w.a as number[] | undefined, b = w.b as number[] | undefined;
      if (Array.isArray(a) && Array.isArray(b)) {
        const mx = (num(a[0]) + num(b[0])) / 2, mz = (num(a[1]) + num(b[1])) / 2, l = Math.hypot(num(b[0]) - num(a[0]), num(b[1]) - num(a[1])) || 1;
        const nx = -(num(b[1]) - num(a[1])) / l, nz = (num(b[0]) - num(a[0])) / l, d = (typeof w.thickness === 'number' ? w.thickness : .2) / 2 + .3;
        out.exterior = !inRoom(mx + nx * d, mz + nz * d) || !inRoom(mx - nx * d, mz - nz * d);
      }
    }
    return out;
  });
}
