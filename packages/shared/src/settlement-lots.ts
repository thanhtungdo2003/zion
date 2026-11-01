import { z } from 'zod';

/**
 * What a building fits on a map, the same for the World Studio (which generates settlements) and
 * the Model Studio (which says where a published house may stand), with the same Vietnamese names.
 *
 * Three independent things:
 * - the lot class: what the lot is used for (houses, shops, workshops, military);
 * - the condition: intact, abandoned or ruined — any class can be abandoned (an abandoned
 *   barracks is a military lot in poor condition, not a lot class of its own);
 * - the kind of area: the 13 settlement types of the World Studio; none chosen = any.
 * A building may fit several of each.
 */
export const LOT_CLASSES = ['residential', 'commercial', 'industrial', 'military'] as const;
export type LotClass = typeof LOT_CLASSES[number];
export const LOT_CLASS_NAMES: Readonly<Record<LotClass, string>> = {
  residential: 'Nhà ở', commercial: 'Thương mại – dịch vụ', industrial: 'Công nghiệp – kho bãi', military: 'Quân sự',
};

export const BUILDING_CONDITIONS = ['intact', 'abandoned', 'ruined'] as const;
export type BuildingCondition = typeof BUILDING_CONDITIONS[number];
export const BUILDING_CONDITION_NAMES: Readonly<Record<BuildingCondition, string>> = {
  intact: 'Nguyên vẹn', abandoned: 'Bỏ hoang', ruined: 'Đổ nát',
};

export const SETTLEMENT_AREA_IDS = ['small-village', 'rural-town', 'dense-town', 'small-city', 'industrial-zone', 'military-base', 'residential-district', 'abandoned-settlement', 'port', 'vn-town', 'planned-city', 'mixed-city', 'abandoned-city'] as const;
export type SettlementAreaId = typeof SETTLEMENT_AREA_IDS[number];
export const SETTLEMENT_AREA_NAMES: Readonly<Record<SettlementAreaId, string>> = {
  'small-village': 'Làng nhỏ', 'rural-town': 'Thị trấn nông thôn', 'dense-town': 'Thị trấn đông đúc', 'small-city': 'Thành phố nhỏ',
  'industrial-zone': 'Khu công nghiệp', 'military-base': 'Căn cứ quân sự', 'residential-district': 'Khu dân cư', 'abandoned-settlement': 'Khu dân cư bỏ hoang',
  port: 'Cảng biển', 'vn-town': 'Thị trấn Việt Nam', 'planned-city': 'Khu đô thị quy hoạch', 'mixed-city': 'Thành phố hỗn hợp', 'abandoned-city': 'Thành phố bỏ hoang',
};

/** Where a building fits (lot classes, conditions, kinds of area; empty areas = any). */
export const lotFitSchema = z.object({
  lots: z.array(z.enum(LOT_CLASSES)).min(1).max(4),
  conditions: z.array(z.enum(BUILDING_CONDITIONS)).min(1).max(3).default(['intact']),
  areas: z.array(z.enum(SETTLEMENT_AREA_IDS)).max(SETTLEMENT_AREA_IDS.length).default([]),
}).strict();
export type LotFit = z.infer<typeof lotFitSchema>;

/** The single class of older models ('abandoned' was a class then: an abandoned house). */
export function lotFitFromLegacy(lotClass: string | undefined): LotFit | undefined {
  if (!lotClass) return undefined;
  if (lotClass === 'abandoned') return { lots: ['residential'], conditions: ['abandoned', 'ruined'], areas: [] };
  return (LOT_CLASSES as readonly string[]).includes(lotClass) ? { lots: [lotClass as LotClass], conditions: ['intact'], areas: [] } : undefined;
}

/** Whether a building fitting `fit` may stand on a lot of this class, condition and area. */
export function lotFits(fit: LotFit, lot: LotClass, condition: BuildingCondition, area: string): boolean {
  return fit.lots.includes(lot) && fit.conditions.includes(condition) && (!fit.areas.length || (fit.areas as readonly string[]).includes(area));
}

/** A short description in Vietnamese ("Nhà ở, Quân sự · Bỏ hoang · mọi khu vực"). */
export function describeLotFit(fit: LotFit): string {
  return `${fit.lots.map((l) => LOT_CLASS_NAMES[l]).join(', ')} · ${fit.conditions.map((c) => BUILDING_CONDITION_NAMES[c]).join(', ')} · ${fit.areas.length ? fit.areas.map((a) => SETTLEMENT_AREA_NAMES[a]).join(', ') : 'mọi khu vực'}`;
}
