import { SETTLEMENT_KIND_NAMES, describeLotFit, kindAreas, type SettlementKind, type BuildingCondition, type LotClass, type LotFit, type SettlementAreaId } from '@zion/shared';
import type { AssetKind, ModelDoc } from './doc';

/**
 * Sorts a model out by itself: what it is (building, vehicle, furniture…), and for a building
 * where it belongs on a map — its lot classes, its condition, the kinds of area it suits
 * (settlement-lots.ts, shared with the World Studio). Read from what the model is: its name and
 * notes (the request it was built from), its rooms and storeys, its materials (moss, rust, cracks
 * mean a long-abandoned place). Rules of thumb, explained in `reasons`; the AI or the admin may
 * change the result.
 */
export interface Classification { kind: AssetKind; fit: LotFit | null; reasons: string[]; summary: string }

/** Whole words only ("bàn" is a table, not part of "cây bàng"). */
const wordRe = new Map<string, RegExp>();
const has = (text: string, words: readonly string[]) => words.some((w) => {
  const k = w.trim();
  let re = wordRe.get(k);
  if (!re) wordRe.set(k, re = new RegExp(String.raw`(^|[^\p{L}\p{N}])` + k.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`) + String.raw`($|[^\p{L}\p{N}])`, 'u'));
  return re.test(text);
});
const WORDS = {
  vehicle: ['xe ', 'ô tô', 'oto', 'xe tải', 'xe tăng', 'trực thăng', 'máy bay', 'thuyền', 'car', 'truck', 'tank', 'jeep', 'boat', 'helicopter', 'vehicle'],
  furniture: ['bàn', 'ghế', 'giường', 'tủ', 'kệ', 'sofa', 'table', 'chair', 'bed', 'cabinet', 'shelf', 'furniture', 'nội thất'],
  vegetation: ['cây', 'bụi', 'cỏ', 'hoa', 'tree', 'bush', 'grass', 'plant', 'flower'],
  rock: ['đá', 'tảng', 'vách đá', 'rock', 'boulder', 'stone'],
  building: ['nhà', 'chung cư', 'biệt thự', 'xưởng', 'kho', 'trường', 'bệnh viện', 'trạm', 'tòa', 'doanh trại', 'house', 'building', 'apartment', 'villa', 'warehouse', 'factory', 'barrack', 'school', 'hospital', 'shop', 'store', 'office', 'church', 'chùa', 'đình', 'nhà thờ'],
  military: ['quân', 'lính', 'doanh trại', 'đồn', 'bốt', 'boong ke', 'hầm', 'tháp canh', 'kho vũ khí', 'trạm gác', 'military', 'army', 'barrack', 'bunker', 'watchtower', 'armory', 'checkpoint', 'outpost'],
  industrial: ['xưởng', 'nhà máy', 'nhà kho', 'kho hàng', 'kho bãi', 'garage', 'gara', 'trạm bơm', 'trạm điện', 'lò', 'silo', 'factory', 'warehouse', 'workshop', 'plant', 'depot', 'hangar', 'industrial', 'công nghiệp'],
  commercial: ['cửa hàng', 'tiệm', 'quán', 'chợ', 'siêu thị', 'khách sạn', 'nhà nghỉ', 'văn phòng', 'ngân hàng', 'nhà phố', 'shophouse', 'shop', 'store', 'market', 'hotel', 'motel', 'office', 'bank', 'cafe', 'restaurant', 'trường', 'bệnh viện', 'phòng khám', 'school', 'clinic', 'hospital'],
  residential: ['nhà ở', 'nhà dân', 'nhà ống', 'nhà cấp 4', 'biệt thự', 'chung cư', 'căn hộ', 'nhà gỗ', 'nhà sàn', 'house', 'home', 'villa', 'apartment', 'cottage', 'cabin', 'dwelling'],
  port: ['cảng', 'bến', 'kho cảng', 'port', 'harbour', 'harbor', 'dock', 'pier'],
  ruined: ['đổ nát', 'sụp', 'sập', 'cháy rụi', 'tàn tích', 'phế tích', 'hoang tàn', 'ruin', 'ruined', 'collapsed', 'destroyed', 'bombed', 'burnt'],
  abandoned: ['bỏ hoang', 'hoang phế', 'bỏ không', 'hoang', 'cũ nát', 'xuống cấp', 'abandoned', 'derelict', 'deserted', 'decayed', 'hậu tận thế', 'postapoc', 'post-apoc'],
  rural: ['làng', 'nông thôn', 'quê', 'nhà cấp 4', 'nhà sàn', 'nhà gỗ', 'trang trại', 'nông trại', 'village', 'rural', 'farm', 'cottage', 'cabin', 'barn'],
  tube: ['nhà ống', 'nhà phố', 'shophouse', 'tube house', 'mặt phố'],
  city: ['chung cư', 'cao tầng', 'tòa', 'văn phòng', 'khách sạn', 'apartment', 'tower', 'office', 'hotel', 'đô thị'],
} as const;

/** What the model's own parts say: storeys, room types, worn-out materials. */
function inspect(doc: ModelDoc): { storeys: number; rooms: string[]; worn: number; ruined: boolean; hasStructure: boolean } {
  const storeys = doc.storeys ?? doc.plans?.length ?? 0;
  const rooms = (doc.plans ?? []).flatMap((p) => p.rooms.map((r) => `${r.type} ${r.name}`.toLowerCase()));
  const materials = doc.materials.map((m) => `${m.name} ${m.preset ?? ''} ${m.id}`.toLowerCase());
  const worn = materials.filter((m) => has(m, ['moss', 'rêu', 'rust', 'gỉ', 'crack', 'nứt', 'peel', 'bong', 'dirty', 'bẩn', 'weathered', 'cũ', 'mold', 'mốc'])).length / Math.max(1, materials.length);
  const hasStructure = !!doc.plans?.length || doc.nodes.some((n) => n.kind === 'wall' || n.kind === 'roof' || n.tags?.includes('storey'));
  const ruined = doc.nodes.some((n) => n.tags?.some((t) => t === 'ruin' || t === 'rubble' || t === 'debris'));
  return { storeys, rooms, worn, ruined, hasStructure };
}

export function classifyModel(doc: ModelDoc): Classification {
  const text = ` ${doc.name} ${doc.notes ?? ''} `.toLowerCase(), reasons: string[] = [];
  const seen = inspect(doc);
  // What it is.
  let kind: AssetKind = doc.kind;
  if (seen.hasStructure || has(text, WORDS.building)) { kind = 'building'; reasons.push(seen.hasStructure ? 'có mặt bằng / tường / mái: công trình' : 'tên hoặc mô tả là công trình'); }
  else if (has(text, WORDS.vehicle)) { kind = 'vehicle'; reasons.push('tên hoặc mô tả là phương tiện'); }
  else if (has(text, WORDS.furniture)) { kind = 'furniture'; reasons.push('tên hoặc mô tả là đồ nội thất'); }
  else if (has(text, WORDS.vegetation)) { kind = 'vegetation'; reasons.push('tên hoặc mô tả là cây cỏ'); }
  else if (has(text, WORDS.rock)) { kind = 'rock'; reasons.push('tên hoặc mô tả là đá'); }
  if (kind !== 'building') return { kind, fit: null, reasons, summary: `Loại: ${kind} (không đặt trên lô đất).` };

  // Lot classes: every use the words and rooms point to.
  const lots = new Set<LotClass>();
  const roomText = seen.rooms.join(' ');
  if (has(text, WORDS.military) || has(roomText, ['barrack', 'armory', 'doanh trại', 'kho vũ khí'])) { lots.add('military'); reasons.push('quân sự (tên/mô tả/phòng)'); }
  if (has(text, WORDS.industrial) || has(roomText, ['workshop', 'xưởng', 'storage', 'kho'])) { lots.add('industrial'); reasons.push('công nghiệp – kho bãi'); }
  if (has(text, WORDS.commercial) || has(roomText, ['shop', 'cửa hàng', 'office', 'văn phòng', 'classroom', 'lớp học'])) { lots.add('commercial'); reasons.push('thương mại – dịch vụ'); }
  if (has(text, WORDS.residential) || has(roomText, ['bedroom', 'phòng ngủ', 'living', 'phòng khách', 'kitchen', 'bếp'])) { lots.add('residential'); reasons.push('nhà ở (tên hoặc có phòng ngủ, phòng khách, bếp)'); }
  // A tube house is a home with a shop on its street front.
  if (has(text, WORDS.tube)) { lots.add('residential'); lots.add('commercial'); }
  if (!lots.size) { lots.add('residential'); reasons.push('không rõ công năng: coi là nhà ở'); }

  // Condition.
  const conditions = new Set<BuildingCondition>();
  if (has(text, WORDS.ruined) || seen.ruined) { conditions.add('ruined'); reasons.push('đổ nát'); }
  if (has(text, WORDS.abandoned) || seen.worn > .4) { conditions.add('abandoned'); reasons.push(seen.worn > .4 ? `vật liệu cũ, rêu, gỉ (${Math.round(seen.worn * 100)}%): bỏ hoang` : 'bỏ hoang'); }
  if (!conditions.size) { conditions.add('intact'); reasons.push('nguyên vẹn'); }

  // Kinds of area: only where the building clearly belongs; otherwise any.
  // By kinds of settlement (as both Studios offer them; each covers its styles and its abandoned layout).
  const areas = new Set<SettlementAreaId>();
  const kinds = new Set<SettlementKind>();
  if (lots.has('military')) kinds.add('military');
  if (lots.has('industrial')) { kinds.add('industrial'); kinds.add('port'); }
  if (has(text, WORDS.port)) kinds.add('port');
  if (has(text, WORDS.rural)) { kinds.add('village'); kinds.add('town'); }
  if (has(text, WORDS.tube)) { kinds.add('town'); kinds.add('city'); }
  if (has(text, WORDS.city) || seen.storeys >= 4) kinds.add('city');
  if (kinds.size && (lots.has('residential') || lots.has('commercial')) && !has(text, WORDS.rural) && seen.storeys < 4) kinds.add('residential');
  for (const k of kinds) for (const a of kindAreas(k)) areas.add(a);
  if (kinds.size) reasons.push(`kiểu khu vực: ${[...kinds].map((k) => SETTLEMENT_KIND_NAMES[k]).join(', ')}`);
  if (!areas.size) reasons.push('hợp mọi kiểu khu vực');
  const fit: LotFit = { lots: [...lots], conditions: [...conditions], areas: [...areas] };
  return { kind, fit, reasons, summary: `Loại: công trình · ${describeLotFit(fit)}` };
}
