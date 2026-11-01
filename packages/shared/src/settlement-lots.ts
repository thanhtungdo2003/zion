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
  // By kinds where a kind's areas are all chosen (Thành phố, not its three styles).
  const kinds = SETTLEMENT_KINDS.filter((k) => kindAreas(k).every((a) => fit.areas.includes(a)));
  const covered = new Set(kinds.flatMap(kindAreas)), rest = fit.areas.filter((a) => !covered.has(a));
  const where = [...kinds.map((k) => SETTLEMENT_KIND_NAMES[k]), ...rest.map((a) => SETTLEMENT_AREA_NAMES[a])];
  return `${fit.lots.map((l) => LOT_CLASS_NAMES[l]).join(', ')} · ${fit.conditions.map((c) => BUILDING_CONDITION_NAMES[c]).join(', ')} · ${fit.areas.length ? where.join(', ') : 'mọi khu vực'}`;
}

/* ----------------------------------------------------------------- kinds of settlement */

/**
 * The kinds of settlement both Studios offer (Quân đội, Thành phố, Khu công nghiệp…), each with
 * its styles — the World Studio's generator settings — and, independently, a condition. An
 * abandoned or ruined village is the village kind in that condition (the generator lays it out
 * as an abandoned settlement); a Model Studio building that fits a kind fits all its styles.
 */
export const SETTLEMENT_KINDS = ['village', 'town', 'city', 'residential', 'industrial', 'military', 'port'] as const;
export type SettlementKind = typeof SETTLEMENT_KINDS[number];
export const SETTLEMENT_KIND_NAMES: Readonly<Record<SettlementKind, string>> = {
  village: 'Làng', town: 'Thị trấn', city: 'Thành phố', residential: 'Khu dân cư', industrial: 'Khu công nghiệp', military: 'Quân đội', port: 'Cảng biển',
};
/** The styles of each kind (intact), and the layout it takes when abandoned or ruined. */
export const SETTLEMENT_KIND_STYLES: Readonly<Record<SettlementKind, { styles: readonly SettlementAreaId[]; decayed: SettlementAreaId | null }>> = {
  village: { styles: ['small-village'], decayed: 'abandoned-settlement' },
  town: { styles: ['vn-town', 'rural-town', 'dense-town'], decayed: 'abandoned-settlement' },
  city: { styles: ['mixed-city', 'small-city', 'planned-city'], decayed: 'abandoned-city' },
  residential: { styles: ['residential-district'], decayed: 'abandoned-settlement' },
  industrial: { styles: ['industrial-zone'], decayed: null },
  military: { styles: ['military-base'], decayed: null },
  port: { styles: ['port'], decayed: null },
};

/** Every area id a kind covers (its styles and its abandoned layout). */
export function kindAreas(kind: SettlementKind): SettlementAreaId[] {
  const k = SETTLEMENT_KIND_STYLES[kind];
  return k.decayed ? [...k.styles, k.decayed] : [...k.styles];
}

/** The kind an area id belongs to (an abandoned layout: the first kind using it). */
export function kindOfArea(area: string): SettlementKind {
  for (const k of SETTLEMENT_KINDS) if ((SETTLEMENT_KIND_STYLES[k].styles as readonly string[]).includes(area)) return k;
  return area === 'abandoned-city' ? 'city' : 'village';
}

/** How run-down a settlement in this condition is (the generator's decay: lots vary round it). */
export const CONDITION_DECAY: Readonly<Record<BuildingCondition, number>> = { intact: .15, abandoned: .72, ruined: 1 };

/** The generator layout (area id) for a kind, a condition and a chosen style. */
export function areaFor(kind: SettlementKind, condition: BuildingCondition, style?: string): SettlementAreaId {
  const k = SETTLEMENT_KIND_STYLES[kind];
  if (condition !== 'intact' && k.decayed) return k.decayed;
  return (k.styles as readonly string[]).includes(style ?? '') ? style as SettlementAreaId : k.styles[0]!;
}
