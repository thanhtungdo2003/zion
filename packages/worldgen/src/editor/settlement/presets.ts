import { SETTLEMENT_AREA_IDS, SETTLEMENT_AREA_NAMES, type LotClass, type SettlementAreaId } from '@zion/shared';
import type { UrbanPattern } from './urban';

// The kinds of area and lot classes are shared with the Model Studio (same ids, same names).
export const SETTLEMENT_PRESET_IDS = SETTLEMENT_AREA_IDS;
export type SettlementPresetId = SettlementAreaId;
export type { LotClass };

export interface SettlementSettings {
  preset: SettlementPresetId;
  /**
   * grid: rectilinear streets; organic: one winding main street with side lanes; urban: a street
   * network traced through a tensor field (terrain, edges, incoming roads) with districts.
   */
  layout: 'grid' | 'organic' | 'urban';
  /** Urban layout only: an irregular Vietnamese town, a planned district, or a planned core with organic outskirts. */
  pattern?: UrbanPattern;
  /** 0..1: share of lots that get a building. */
  density: number;
  /** 0..1: jitter of street spacing, lot sizes and building choice. */
  randomness: number;
  /** 0..1: how strongly building density gathers at the centre. */
  concentration: number;
  mainRoadWidth: number;
  secondaryRoadWidth: number;
  alleyWidth: number;
  /** Spacing of the secondary streets (m). */
  blockSize: number;
  lotWidth: number;
  lotDepth: number;
  /** Distance from the lot front to the building (m). */
  setback: number;
  /** 0..1: preference for the largest building that fits a lot. */
  sizeBias: number;
  zoning: Record<LotClass, number>;
  treeDensity: number;
  propDensity: number;
  /** 0..1: wrecks, dead trees and debris. */
  decay: number;
  fences: boolean;
  lamps: boolean;
  perimeter: boolean;
  /** Quays, piers, a breakwater and cranes where the region meets the sea or a lake. */
  harbour: boolean;
  /** Steepest ground a building stands on (rise over run). */
  maxSlope: number;
  /** 0..1: cut and fill before building — how far the ground eases onto a gentle plane. */
  grading: number;
  maxBuildings: number;
  maxProps: number;
}

const base: Omit<SettlementSettings, 'preset'> = {
  layout: 'grid', density: .75, randomness: .35, concentration: .5,
  mainRoadWidth: 9, secondaryRoadWidth: 6.5, alleyWidth: 4, blockSize: 100, lotWidth: 20, lotDepth: 28, setback: 4, sizeBias: .5,
  zoning: { residential: .8, commercial: .2, industrial: 0, military: 0 },
  treeDensity: .5, propDensity: .5, decay: .25, fences: false, lamps: true, perimeter: false, harbour: false,
  maxSlope: .2, grading: .6, maxBuildings: 1200, maxProps: 6000,
};

export const SETTLEMENT_PRESETS: Array<{ id: SettlementPresetId; name: string; description: string; settings: SettlementSettings }> = [
  { id: 'small-village', name: SETTLEMENT_AREA_NAMES['small-village'], description: 'Một trục đường uốn lượn, nhà thưa có sân và hàng rào, nhiều cây.', settings: { ...base, preset: 'small-village', grading: .3, layout: 'organic', density: .55, concentration: .7, mainRoadWidth: 7, secondaryRoadWidth: 5, blockSize: 90, lotWidth: 24, lotDepth: 30, setback: 5, sizeBias: .3, zoning: { residential: .95, commercial: .05, industrial: 0, military: 0 }, treeDensity: .8, propDensity: .35, fences: true, lamps: false } },
  { id: 'rural-town', name: SETTLEMENT_AREA_NAMES['rural-town'], description: 'Lưới phố thưa quanh trục chính, ít cửa hàng ở trung tâm.', settings: { ...base, preset: 'rural-town', grading: .5, density: .65, mainRoadWidth: 8, secondaryRoadWidth: 6, blockSize: 110, lotWidth: 22, lotDepth: 30, zoning: { residential: .75, commercial: .2, industrial: .05, military: 0 }, treeDensity: .6, fences: true } },
  { id: 'dense-town', name: SETTLEMENT_AREA_NAMES['dense-town'], description: 'Ô phố nhỏ, lô hẹp, nhà sát nhau, có ngõ trong khối.', settings: { ...base, preset: 'dense-town', grading: .75, density: .9, concentration: .6, mainRoadWidth: 10, secondaryRoadWidth: 7, alleyWidth: 4, blockSize: 80, lotWidth: 14, lotDepth: 22, setback: 2, sizeBias: .6, zoning: { residential: .55, commercial: .4, industrial: .05, military: 0 }, treeDensity: .3, propDensity: .6 } },
  { id: 'small-city', name: SETTLEMENT_AREA_NAMES['small-city'], description: 'Đại lộ hai trục, khối lớn, chung cư và thương mại ở lõi.', settings: { ...base, preset: 'small-city', grading: .85, density: .95, concentration: .7, mainRoadWidth: 14, secondaryRoadWidth: 9, alleyWidth: 5, blockSize: 120, lotWidth: 26, lotDepth: 34, setback: 3, sizeBias: .85, zoning: { residential: .4, commercial: .5, industrial: .1, military: 0 }, treeDensity: .35, propDensity: .7 } },
  { id: 'industrial-zone', name: SETTLEMENT_AREA_NAMES['industrial-zone'], description: 'Đường rộng, lô lớn: nhà xưởng, container, bồn nước, bãi vật liệu.', settings: { ...base, preset: 'industrial-zone', grading: .85, density: .7, concentration: .3, mainRoadWidth: 12, secondaryRoadWidth: 9, blockSize: 150, lotWidth: 40, lotDepth: 48, setback: 6, sizeBias: .9, zoning: { residential: 0, commercial: .05, industrial: .95, military: 0 }, treeDensity: .15, propDensity: .85, lamps: true, harbour: true } },
  { id: 'military-base', name: SETTLEMENT_AREA_NAMES['military-base'], description: 'Lưới đều, doanh trại, lều, xe quân sự và hàng rào bao quanh.', settings: { ...base, preset: 'military-base', grading: .75, density: .75, randomness: .15, concentration: .3, mainRoadWidth: 10, secondaryRoadWidth: 7, blockSize: 110, lotWidth: 30, lotDepth: 36, setback: 5, sizeBias: .7, zoning: { residential: 0, commercial: 0, industrial: .1, military: .9 }, treeDensity: .1, propDensity: .8, perimeter: true } },
  { id: 'residential-district', name: SETTLEMENT_AREA_NAMES['residential-district'], description: 'Phố nhà ở san sát, sân trước, hàng rào và cây xanh.', settings: { ...base, preset: 'residential-district', grading: .65, density: .85, mainRoadWidth: 9, secondaryRoadWidth: 7, alleyWidth: 4, blockSize: 100, lotWidth: 16, lotDepth: 26, setback: 4, sizeBias: .4, zoning: { residential: .95, commercial: .05, industrial: 0, military: 0 }, treeDensity: .6, fences: true } },
  { id: 'abandoned-settlement', name: SETTLEMENT_AREA_NAMES['abandoned-settlement'], description: 'Nhà thưa, xe bỏ hoang trên đường, cây mọc um tùm, đổ nát.', settings: { ...base, preset: 'abandoned-settlement', grading: .2, layout: 'organic', density: .5, randomness: .55, concentration: .4, mainRoadWidth: 7, secondaryRoadWidth: 5, lotWidth: 22, lotDepth: 28, zoning: { residential: .8, commercial: .15, industrial: .05, military: 0 }, treeDensity: .95, propDensity: .7, decay: .9, fences: true, lamps: false } },
  { id: 'port', name: SETTLEMENT_AREA_NAMES['port'], description: 'Vẽ vùng chạm mặt nước: cầu cảng, bến nhô, đê chắn sóng, kè, cần cẩu, bãi container, kho bãi.', settings: { ...base, preset: 'port', grading: .8, density: .7, concentration: .3, mainRoadWidth: 12, secondaryRoadWidth: 9, blockSize: 130, lotWidth: 36, lotDepth: 44, setback: 5, sizeBias: .85, zoning: { residential: 0, commercial: .3, industrial: .7, military: 0 }, treeDensity: .1, propDensity: .9, harbour: true } },
  { id: 'vn-town', name: SETTLEMENT_AREA_NAMES['vn-town'], description: 'Phố tự phát theo địa hình: nhà ống mặt tiền hẹp san sát, nhà phố buôn bán dọc đường chính, ngõ hẻm cụt, chợ, trường, chùa.', settings: { ...base, preset: 'vn-town', layout: 'urban', pattern: 'vietnamese', grading: .55, density: .85, randomness: .55, concentration: .65, mainRoadWidth: 9, secondaryRoadWidth: 6, alleyWidth: 3, blockSize: 110, lotWidth: 12, lotDepth: 22, setback: 1, sizeBias: .5, zoning: { residential: .8, commercial: .15, industrial: .05, military: 0 }, treeDensity: .45, propDensity: .6, decay: .45 } },
  { id: 'planned-city', name: SETTLEMENT_AREA_NAMES['planned-city'], description: 'Mạng đường phân cấp (trục chính – đường khu vực) theo lưới, ô phố đều, khu thương mại lõi, công viên, trường, trụ sở.', settings: { ...base, preset: 'planned-city', layout: 'urban', pattern: 'planned', grading: .85, density: .9, randomness: .25, concentration: .7, mainRoadWidth: 14, secondaryRoadWidth: 8, alleyWidth: 4, blockSize: 120, lotWidth: 24, lotDepth: 30, setback: 3, sizeBias: .8, zoning: { residential: .55, commercial: .3, industrial: .15, military: 0 }, treeDensity: .4, propDensity: .7, decay: .4 } },
  { id: 'mixed-city', name: SETTLEMENT_AREA_NAMES['mixed-city'], description: 'Lõi quy hoạch theo lưới, vùng ven tự phát với nhà ống và ngõ hẻm; công nghiệp ở rìa theo đường ra.', settings: { ...base, preset: 'mixed-city', layout: 'urban', pattern: 'mixed', grading: .75, density: .9, randomness: .4, concentration: .7, mainRoadWidth: 12, secondaryRoadWidth: 7, alleyWidth: 3.5, blockSize: 115, lotWidth: 20, lotDepth: 26, setback: 2, sizeBias: .7, zoning: { residential: .6, commercial: .25, industrial: .15, military: 0 }, treeDensity: .4, propDensity: .7, decay: .45 } },
  { id: 'abandoned-city', name: SETTLEMENT_AREA_NAMES['abandoned-city'], description: 'Đô thị hỗn hợp đã bị bỏ: cả khu phố hoang cùng nhau, nhà đổ nát thành vỏ, gạch vụn, cây cỏ mọc lấn đường.', settings: { ...base, preset: 'abandoned-city', layout: 'urban', pattern: 'mixed', grading: .6, density: .8, randomness: .5, concentration: .6, mainRoadWidth: 12, secondaryRoadWidth: 7, alleyWidth: 3.5, blockSize: 115, lotWidth: 18, lotDepth: 26, setback: 2, sizeBias: .6, zoning: { residential: .65, commercial: .2, industrial: .15, military: 0 }, treeDensity: .85, propDensity: .75, decay: .85, lamps: false } },
];

export function presetSettings(id: SettlementPresetId): SettlementSettings {
  return structuredClone(SETTLEMENT_PRESETS.find((p) => p.id === id)!.settings);
}

export function validateSettlementSettings(s: SettlementSettings): string[] {
  const out: string[] = [];
  const unit = (v: number, name: string) => { if (!(v >= 0 && v <= 1)) out.push(`${name} phải trong khoảng 0–1.`); };
  unit(s.density, 'Mật độ'); unit(s.randomness, 'Độ ngẫu nhiên'); unit(s.concentration, 'Mức tập trung');
  unit(s.sizeBias, 'Ưu tiên kích thước'); unit(s.grading, 'Mức san nền'); unit(s.treeDensity, 'Mật độ cây'); unit(s.propDensity, 'Mật độ vật thể'); unit(s.decay, 'Mức xuống cấp');
  if (!(s.mainRoadWidth >= 4 && s.mainRoadWidth <= 24)) out.push('Đường chính rộng 4–24 m.');
  if (!(s.secondaryRoadWidth >= 3 && s.secondaryRoadWidth <= s.mainRoadWidth)) out.push('Đường phụ rộng từ 3 m và không rộng hơn đường chính.');
  if (!(s.alleyWidth >= 2.5 && s.alleyWidth <= s.secondaryRoadWidth)) out.push('Ngõ rộng từ 2,5 m và không rộng hơn đường phụ.');
  if (!(s.blockSize >= 40 && s.blockSize <= 300)) out.push('Kích thước ô phố 40–300 m.');
  if (!(s.lotWidth >= 8 && s.lotWidth <= 80) || !(s.lotDepth >= 10 && s.lotDepth <= 100)) out.push('Lô đất rộng 8–80 m, sâu 10–100 m.');
  if (!(s.setback >= 0 && s.setback <= 20)) out.push('Khoảng lùi 0–20 m.');
  if (s.lotDepth * 2 + s.secondaryRoadWidth > s.blockSize * 1.6) out.push('Lô quá sâu so với ô phố.');
  if (!(s.maxSlope > 0 && s.maxSlope <= .6)) out.push('Độ dốc tối đa 0–0,6.');
  if (!(s.maxBuildings >= 1 && s.maxBuildings <= 4000) || !(s.maxProps >= 0 && s.maxProps <= 20000)) out.push('Giới hạn đối tượng vượt phạm vi cho phép.');
  if (Object.values(s.zoning).every((v) => v <= 0)) out.push('Cần ít nhất một loại khu vực có tỷ trọng > 0.');
  return out;
}
