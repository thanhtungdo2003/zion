import { z } from 'zod';
import {
  BUILDING_CONDITIONS, BUILDING_CONDITION_NAMES, BUILDING_TYPES, BUILDING_TYPE_INFO, LOT_CLASSES, LOT_CLASS_NAMES,
  SETTLEMENT_KINDS, SETTLEMENT_KIND_NAMES, describeLotFit, kindAreas, type LotFit,
} from '@zion/shared';
import { classifyModel, type ModelDoc } from '@zion/assets/model-studio';
import { parseJsonObject, type LlmClient } from './llm';

/**
 * The Model Studio's "Tự phân loại" by the AI: from what the model is (name, notes, storeys,
 * rooms, materials, size) it says what it is (building, vehicle…), its building types, lot
 * classes, conditions and kinds of area — all from the lists both Studios share. Its answer is
 * checked against those lists; without an AI connection, or when it answers nonsense, the
 * rules of thumb (classifyModel) stand.
 */
export interface AiClassification { kind: ModelDoc['kind']; fit: LotFit | null; summary: string; reasons: string[]; source: 'ai' | 'rules' }

const KINDS = ['building', 'prop', 'rock', 'vegetation', 'furniture', 'vehicle', 'weapon', 'other'] as const;

const SYSTEM = `Bạn phân loại model 3D cho game bắn súng thế giới mở Zion, để World Studio biết đặt công trình vào lô đất nào khi sinh bản đồ.
Trả về JSON: {"kind": "...", "types": [...], "lots": [...], "conditions": [...], "settlements": [...], "reason": "một câu tiếng Việt"}.
- kind: ${KINDS.join(', ')} (chỉ "building" mới đặt trên lô đất).
- types (loại công trình, một hoặc vài): ${BUILDING_TYPES.map((t) => `${t} = ${BUILDING_TYPE_INFO[t].name}`).join('; ')}.
- lots (loại lô): ${LOT_CLASSES.map((l) => `${l} = ${LOT_CLASS_NAMES[l]}`).join('; ')}.
- conditions (tình trạng của chính model): ${BUILDING_CONDITIONS.map((c) => `${c} = ${BUILDING_CONDITION_NAMES[c]}`).join('; ')}. Nhà nguyên vẹn thì chọn intact; rêu, gỉ, vỡ kính là abandoned; sập, cháy là ruined.
- settlements (kiểu khu vực hợp, để trống = mọi khu vực): ${SETTLEMENT_KINDS.map((k) => `${k} = ${SETTLEMENT_KIND_NAMES[k]}`).join('; ')}. Chỉ giới hạn khi công trình rõ ràng chỉ hợp vài nơi (doanh trại → military; nhà sàn → village; cao ốc → city).
Chỉ dùng đúng các id trên.`;

const answer = z.object({
  kind: z.enum(KINDS),
  types: z.array(z.string()).default([]),
  lots: z.array(z.string()).default([]),
  conditions: z.array(z.string()).default([]),
  settlements: z.array(z.string()).default([]),
  reason: z.string().default(''),
}).passthrough();

function describe(doc: ModelDoc): string {
  const rooms = (doc.plans ?? []).flatMap((p) => p.rooms.map((r) => r.name || r.type)).slice(0, 40);
  const materials = doc.materials.map((m) => m.name).slice(0, 30);
  return `Tên: ${doc.name}\nGhi chú: ${(doc.notes ?? '').slice(0, 1500) || '(không)'}\nLoại hiện tại: ${doc.kind}\nSố tầng: ${doc.storeys ?? doc.plans?.length ?? 0}\nPhòng: ${rooms.join(', ') || '(không)'}\nVật liệu: ${materials.join(', ') || '(không)'}\nSố khối: ${doc.nodes.length}`;
}

export async function classifyWithAi(doc: ModelDoc, llm: LlmClient | null): Promise<AiClassification> {
  const rules = classifyModel(doc);
  const fallback: AiClassification = { ...rules, source: 'rules' };
  if (!llm) return fallback;
  try {
    const res = await llm.complete([{ role: 'system', content: SYSTEM }, { role: 'user', content: describe(doc) }], { temperature: .2 });
    const a = answer.parse(parseJsonObject(res.text) ?? {});
    if (a.kind !== 'building') return { kind: a.kind, fit: null, reasons: [a.reason], summary: `Loại: ${a.kind} (không đặt trên lô đất).`, source: 'ai' };
    const pick = <T extends string>(list: readonly T[], v: string[]) => [...new Set(v.filter((x): x is T => (list as readonly string[]).includes(x)))];
    const types = pick(BUILDING_TYPES, a.types);
    let lots = pick(LOT_CLASSES, a.lots);
    // The lot classes of what it is, so a school also stands where schools go.
    for (const t of types) for (const l of BUILDING_TYPE_INFO[t].lots) if (!lots.includes(l) && (l !== 'military' || types.every((x) => BUILDING_TYPE_INFO[x].lots.includes('military')))) lots.push(l);
    if (!lots.length) lots = rules.fit?.lots ?? ['residential'];
    const conditions = pick(BUILDING_CONDITIONS, a.conditions);
    const areas = [...new Set(pick(SETTLEMENT_KINDS, a.settlements).flatMap(kindAreas))];
    const fit: LotFit = { lots: lots.slice(0, 4), conditions: conditions.length ? conditions : ['intact'], areas, ...(types.length ? { types } : {}) };
    return { kind: 'building', fit, reasons: [a.reason], summary: `Loại: công trình · ${describeLotFit(fit)}`, source: 'ai' };
  } catch {
    return fallback;
  }
}
