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

/* ---------------------------------------------------------------- building types */

/**
 * What a building is (house, school, hospital…), the ids both Studios share: the Model Studio
 * gives its buildings one or more, the World Studio's generator asks for them lot by lot. Many
 * models share a type, and the generator picks among them at random.
 *
 * `facility`: a public building a settlement has a few of (a school, a hospital, a stadium) —
 * it stands only on the plots set aside for its type, never as an ordinary house. `tall`: a
 * high-rise, wanted towards the centre of towns and cities. `plot`: the least plot area it needs (m²).
 */
export const BUILDING_TYPES = [
  'house', 'villa', 'tube', 'apartment', 'farmhouse',
  'shophouse', 'shop', 'restaurant', 'office', 'hotel', 'market', 'supermarket', 'bank', 'gas-station',
  'kindergarten', 'school', 'university', 'clinic', 'hospital', 'police', 'fire-station', 'town-hall', 'post-office',
  'temple', 'church', 'stadium', 'cinema', 'library',
  'warehouse', 'factory', 'workshop', 'barn',
  'barracks', 'bunker', 'watchtower', 'hangar', 'port-warehouse',
] as const;
export type BuildingType = typeof BUILDING_TYPES[number];
export interface BuildingTypeInfo { name: string; lots: readonly LotClass[]; facility?: boolean; tall?: boolean; plot?: number }
export const BUILDING_TYPE_INFO: Readonly<Record<BuildingType, BuildingTypeInfo>> = {
  house: { name: 'Nhà ở', lots: ['residential'] },
  villa: { name: 'Biệt thự', lots: ['residential'] },
  tube: { name: 'Nhà ống', lots: ['residential', 'commercial'] },
  apartment: { name: 'Chung cư', lots: ['residential'], tall: true },
  farmhouse: { name: 'Nhà nông thôn', lots: ['residential'] },
  shophouse: { name: 'Nhà phố kinh doanh', lots: ['commercial'] },
  shop: { name: 'Cửa hàng', lots: ['commercial'] },
  restaurant: { name: 'Nhà hàng – quán ăn', lots: ['commercial'] },
  office: { name: 'Văn phòng', lots: ['commercial'], tall: true },
  hotel: { name: 'Khách sạn', lots: ['commercial'], tall: true, facility: true, plot: 400 },
  market: { name: 'Chợ', lots: ['commercial'], facility: true, plot: 600 },
  supermarket: { name: 'Siêu thị', lots: ['commercial'], facility: true, plot: 900 },
  bank: { name: 'Ngân hàng', lots: ['commercial'], facility: true, plot: 300 },
  'gas-station': { name: 'Trạm xăng', lots: ['commercial', 'industrial'], facility: true, plot: 400 },
  kindergarten: { name: 'Trường mầm non', lots: ['residential'], facility: true, plot: 500 },
  school: { name: 'Trường học', lots: ['residential'], facility: true, plot: 900 },
  university: { name: 'Trường đại học', lots: ['commercial'], facility: true, tall: true, plot: 2500 },
  clinic: { name: 'Trạm y tế – phòng khám', lots: ['residential', 'commercial'], facility: true, plot: 300 },
  hospital: { name: 'Bệnh viện', lots: ['commercial'], facility: true, tall: true, plot: 1500 },
  police: { name: 'Đồn công an', lots: ['commercial'], facility: true, plot: 300 },
  'fire-station': { name: 'Trạm cứu hỏa', lots: ['commercial', 'industrial'], facility: true, plot: 500 },
  'town-hall': { name: 'Ủy ban – trụ sở', lots: ['commercial'], facility: true, plot: 600 },
  'post-office': { name: 'Bưu điện', lots: ['commercial'], facility: true, plot: 300 },
  temple: { name: 'Chùa – đình – đền', lots: ['residential'], facility: true, plot: 400 },
  church: { name: 'Nhà thờ', lots: ['residential'], facility: true, plot: 500 },
  stadium: { name: 'Sân vận động', lots: ['commercial'], facility: true, plot: 4000 },
  cinema: { name: 'Rạp chiếu – nhà văn hóa', lots: ['commercial'], facility: true, plot: 600 },
  library: { name: 'Thư viện', lots: ['commercial'], facility: true, plot: 400 },
  warehouse: { name: 'Nhà kho', lots: ['industrial', 'military'] },
  factory: { name: 'Nhà máy', lots: ['industrial'] },
  workshop: { name: 'Xưởng – gara', lots: ['industrial', 'commercial'] },
  barn: { name: 'Chuồng trại – kho nông sản', lots: ['residential', 'industrial'] },
  barracks: { name: 'Doanh trại', lots: ['military'] },
  bunker: { name: 'Boong ke – hầm', lots: ['military'] },
  watchtower: { name: 'Tháp canh', lots: ['military'] },
  hangar: { name: 'Nhà chứa máy bay – xe', lots: ['military', 'industrial'] },
  'port-warehouse': { name: 'Kho cảng', lots: ['industrial'] },
};
export const isFacility = (t: string | undefined): t is BuildingType => !!t && !!BUILDING_TYPE_INFO[t as BuildingType]?.facility;

/**
 * The public buildings a settlement of this kind and size has (one entry per building): every
 * town has its schools, a clinic and a market; larger ones a hospital, a stadium; a city a
 * university. The generator sets plots aside for them; the other plots take homes, shops and
 * workshops.
 */
export function settlementFacilities(kind: SettlementKind, area: number): BuildingType[] {
  const k = area / 1000; // thousand m²
  const n = (per: number) => Math.max(1, Math.round(k / per));
  const out: BuildingType[] = [];
  const add = (t: BuildingType, count = 1) => { for (let i = 0; i < count; i++) out.push(t); };
  switch (kind) {
    case 'village':
      add('temple');
      if (k > 40) add('school');
      if (k > 60) { add('market'); add('clinic'); }
      if (k > 90) add('kindergarten');
      break;
    case 'town': case 'residential':
      add('market'); add('school', n(250)); add('kindergarten', n(300)); add('clinic'); add('temple'); add('police');
      if (kind === 'town') { add('town-hall'); add('post-office'); }
      add('gas-station');
      if (k > 120) { add('supermarket'); add('bank'); }
      if (k > 160) add('hospital');
      if (k > 200) { add('stadium'); add('fire-station'); add('church'); add('cinema'); }
      break;
    case 'city':
      add('market', n(400)); add('school', n(200)); add('kindergarten', n(250)); add('clinic', n(400)); add('hospital', n(600));
      add('police', n(400)); add('town-hall'); add('post-office'); add('bank', n(300)); add('supermarket', n(400)); add('hotel', n(250));
      add('stadium'); add('fire-station'); add('temple'); add('church'); add('cinema'); add('library'); add('gas-station', n(400));
      if (k > 300) add('university');
      break;
    case 'industrial':
      add('gas-station');
      if (k > 150) add('fire-station');
      break;
    case 'port':
      add('gas-station'); add('police');
      break;
    case 'military':
      break;
  }
  return out;
}

/** Where a building fits (lot classes, conditions, kinds of area; empty areas = any) and what it is. */
export const lotFitSchema = z.object({
  lots: z.array(z.enum(LOT_CLASSES)).min(1).max(4),
  conditions: z.array(z.enum(BUILDING_CONDITIONS)).min(1).max(3).default(['intact']),
  areas: z.array(z.enum(SETTLEMENT_AREA_IDS)).max(SETTLEMENT_AREA_IDS.length).default([]),
  /** Building types (none = an ordinary building of its lot classes: a house, a shop…). */
  types: z.array(z.enum(BUILDING_TYPES)).max(BUILDING_TYPES.length).optional(),
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
  const types = fit.types?.length ? `${fit.types.map((t) => BUILDING_TYPE_INFO[t].name).join(', ')} · ` : '';
  return `${types}${fit.lots.map((l) => LOT_CLASS_NAMES[l]).join(', ')} · ${fit.conditions.map((c) => BUILDING_CONDITION_NAMES[c]).join(', ')} · ${fit.areas.length ? where.join(', ') : 'mọi khu vực'}`;
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
