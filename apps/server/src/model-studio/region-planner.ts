import { z } from 'zod';
import {
  BUILDING_CONDITIONS, BUILDING_CONDITION_NAMES, SETTLEMENT_AREA_NAMES, SETTLEMENT_KINDS, SETTLEMENT_KIND_NAMES, SETTLEMENT_KIND_STYLES,
  areaFor, describeLotFit, lotFitFromLegacy, lotFits, type BuildingCondition, type LotFit, type SettlementKind,
} from '@zion/shared';
import { parseJsonObject, type LlmClient } from './llm';

/**
 * The World Studio's region planner: what a drawn region should be — its kind of settlement,
 * condition, style and name — from what the admin asks and the ground it covers, and which of
 * the Model Studio's published buildings will stand in it. With the Model Studio's AI connection
 * when one is set (the same model and key), otherwise by rules of thumb. Either way the answer is
 * one of the kinds and conditions both Studios share, so the generator can place it at once.
 */
export const regionRequestSchema = z.object({
  prompt: z.string().max(1000).default(''),
  region: z.object({
    area: z.number().min(0).max(1e9), width: z.number().min(0).max(1e5), depth: z.number().min(0).max(1e5),
    /** Share of the region under water or by it (0…1), mean height above the sea, mean slope (rise/run). */
    water: z.number().min(0).max(1), elevation: z.number().min(-500).max(5000), slope: z.number().min(0).max(10),
    /** What the map already has round it (names of the other regions). */
    neighbours: z.array(z.string().max(80)).max(30).default([]),
  }).strict(),
}).strict();
export type RegionRequest = z.infer<typeof regionRequestSchema>;

export interface RegionPlan {
  kind: SettlementKind; condition: BuildingCondition; style: string; preset: string; name: string; reason: string;
  /** The published buildings that fit it (id, name, where they fit). */
  buildings: Array<{ asset: number; name: string; fit: string }>;
  source: 'ai' | 'rules';
}

interface Published { asset: number; name: string; def: { category?: string; tags?: string[]; fit?: unknown } }

const fitOf = (m: Published): LotFit | null => {
  const tags = m.def.tags ?? [];
  if (tags.some((t) => ['kind:vehicle', 'kind:furniture', 'kind:vegetation', 'kind:rock', 'kind:weapon'].includes(t)) && !m.def.fit) return null;
  return (m.def.fit as LotFit | undefined) ?? lotFitFromLegacy(tags.find((t) => t.startsWith('lot:'))?.slice(4)) ?? { lots: ['residential', 'commercial'], conditions: ['intact'], areas: [] };
};

/** The published buildings a region of this kind and condition would take (any lot class). */
export function buildingsFor(published: readonly Published[], condition: BuildingCondition, preset: string): RegionPlan['buildings'] {
  return published.flatMap((m) => {
    const fit = fitOf(m);
    if (!fit) return [];
    const ok = (['residential', 'commercial', 'industrial', 'military'] as const).some((lot) => lotFits(fit, lot, condition, preset));
    return ok ? [{ asset: m.asset, name: m.name, fit: describeLotFit(fit) }] : [];
  });
}

const has = (t: string, ...w: string[]) => w.some((x) => t.includes(x));

/** Rules of thumb: the words of the request first, then the size and the ground. */
export function planByRules(req: RegionRequest): Omit<RegionPlan, 'buildings' | 'source'> {
  const t = req.prompt.toLowerCase(), r = req.region;
  let kind: SettlementKind =
    has(t, 'quân', 'căn cứ', 'doanh trại', 'military', 'base', 'army') ? 'military'
      : has(t, 'cảng', 'bến', 'port', 'harbour', 'harbor') ? 'port'
        : has(t, 'công nghiệp', 'nhà máy', 'xưởng', 'kho', 'industrial', 'factory') ? 'industrial'
          : has(t, 'thành phố', 'đô thị', 'city') ? 'city'
            : has(t, 'thị trấn', 'town') ? 'town'
              : has(t, 'làng', 'xóm', 'village', 'quê') ? 'village'
                : has(t, 'khu dân cư', 'dân cư', 'residential') ? 'residential'
                  : r.water > .15 && r.slope < .15 ? 'port'
                    : r.area > 300_000 ? 'city' : r.area > 90_000 ? 'town' : r.slope > .25 || r.elevation > 120 ? 'village' : r.area > 40_000 ? 'residential' : 'village';
  if (kind === 'port' && r.water < .02 && !has(t, 'cảng', 'port')) kind = r.area > 90_000 ? 'town' : 'village';
  const condition: BuildingCondition = has(t, 'đổ nát', 'sụp', 'tàn tích', 'ruin', 'destroyed') ? 'ruined' : has(t, 'bỏ hoang', 'hoang', 'abandoned', 'derelict', 'hậu tận thế') ? 'abandoned' : 'intact';
  const styles = SETTLEMENT_KIND_STYLES[kind].styles;
  const style = has(t, 'quy hoạch', 'planned') && styles.includes('planned-city') ? 'planned-city' : has(t, 'việt', 'nhà ống', 'phố') && styles.includes('vn-town') ? 'vn-town' : has(t, 'đông đúc', 'dense') && styles.includes('dense-town') ? 'dense-town' : styles[0]!;
  const preset = areaFor(kind, condition, style);
  const reason = req.prompt ? `Theo yêu cầu "${req.prompt.slice(0, 80)}"` : `Theo diện tích ${Math.round(r.area / 1000)} nghìn m², ${r.water > .15 ? 'giáp nước, ' : ''}dốc ${Math.round(Math.atan(r.slope) * 180 / Math.PI)}°`;
  return { kind, condition, style, preset, name: `${SETTLEMENT_KIND_NAMES[kind]}${condition !== 'intact' ? ` ${BUILDING_CONDITION_NAMES[condition].toLowerCase()}` : ''}`, reason };
}

const SYSTEM = `Bạn là kiến trúc sư quy hoạch cho World Studio của game bắn súng thế giới mở Zion. Admin vẽ một vùng trên bản đồ; bạn quyết định vùng đó là gì để hệ thống tự sinh đường, lô đất và công trình.
Chọn đúng một kiểu khu vực (kind): ${SETTLEMENT_KINDS.map((k) => `${k} = ${SETTLEMENT_KIND_NAMES[k]} (phong cách: ${SETTLEMENT_KIND_STYLES[k].styles.map((s) => `${s} ${SETTLEMENT_AREA_NAMES[s]}`).join(', ')})`).join('; ')}.
Tình trạng (condition): ${BUILDING_CONDITIONS.map((c) => `${c} = ${BUILDING_CONDITION_NAMES[c]}`).join(', ')}.
Căn cứ: yêu cầu của admin (ưu tiên), diện tích và hình dạng vùng, nước gần đó (cảng cần mặt nước), độ cao, độ dốc, các khu vực lân cận (tránh lặp, tạo bản đồ có lý: căn cứ quân sự ở nơi cao hoặc biệt lập, công nghiệp gần đường lớn hoặc cảng, làng ở nơi nhỏ hoặc dốc). Đặt tên tiếng Việt tự nhiên, ngắn.
Trả về JSON: {"kind": "...", "condition": "...", "style": "...", "name": "...", "reason": "một câu tiếng Việt"}.`;

/** Asks the AI (when connected), checks its answer against the shared lists; rules otherwise. */
export async function planRegion(req: RegionRequest, published: readonly Published[], llm: LlmClient | null): Promise<RegionPlan> {
  let plan = planByRules(req), source: RegionPlan['source'] = 'rules';
  if (llm) {
    try {
      const r = req.region;
      const user = `Yêu cầu: ${req.prompt || '(không có — tự quyết theo địa hình)'}\nVùng: ${Math.round(r.area)} m², ${Math.round(r.width)} × ${Math.round(r.depth)} m, nước ${Math.round(r.water * 100)}%, cao ${Math.round(r.elevation)} m trên mực nước biển, dốc trung bình ${Math.round(Math.atan(r.slope) * 180 / Math.PI)}°.\nLân cận: ${r.neighbours.join(', ') || 'chưa có'}.\nCông trình đã xuất bản từ Model Studio: ${published.slice(0, 40).map((m) => { const f = fitOf(m); return f ? `${m.name} (${describeLotFit(f)})` : null; }).filter(Boolean).join('; ') || 'chưa có'}.`;
      const res = await llm.complete([{ role: 'system', content: SYSTEM }, { role: 'user', content: user }], { temperature: .4 });
      const o = parseJsonObject(res.text) ?? {};
      const kind = SETTLEMENT_KINDS.find((k) => k === o.kind);
      const condition = BUILDING_CONDITIONS.find((c) => c === o.condition);
      if (kind && condition) {
        const style = typeof o.style === 'string' ? o.style : '';
        const preset = areaFor(kind, condition, style);
        plan = { kind, condition, style: (SETTLEMENT_KIND_STYLES[kind].styles as readonly string[]).includes(style) ? style : SETTLEMENT_KIND_STYLES[kind].styles[0]!, preset,
          name: typeof o.name === 'string' && o.name.trim() ? o.name.trim().slice(0, 60) : plan.name, reason: typeof o.reason === 'string' ? o.reason.slice(0, 300) : '' };
        source = 'ai';
      }
    } catch { /* the AI did not answer: the rules' answer stands */ }
  }
  return { ...plan, buildings: buildingsFor(published, plan.condition, plan.preset), source };
}
