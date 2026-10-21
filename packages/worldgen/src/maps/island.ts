/**
 * Đảo Hắc Sơn — an abandoned military island, authored by hand for battle royale.
 *
 * Coordinates are world metres on the 4096 m battle map (x east, z south). Everything here is
 * plain data; `authored.ts` turns it into terrain, roads, buildings, vegetation and the grid.
 */

export type Point = readonly [number, number];

export type ZoneKind = 'port' | 'town' | 'military' | 'power_plant' | 'airfield' | 'village' | 'radar' | 'substation' | 'farm' | 'lighthouse' | 'school' | 'church' | 'station' | 'stadium' | 'park';

export interface MapZone {
  id: string;
  name: string;
  kind: ZoneKind;
  /** Label anchor and layout origin. */
  x: number;
  z: number;
  /** Approximate extent, for labels and the map overview. */
  radius: number;
}

/** `route`: the points are waypoints; between them the road finds its own way over the ground (a winding pass instead of a cutting). */
export interface MapRoad { points: Point[]; width: number; paved: boolean; route?: boolean }
export interface PowerLine { points: Point[]; kind: 'tower' | 'hframe'; spacing: number }
export interface Hill { x: number; z: number; radius: number; height: number }

export interface AuthoredMap {
  id: string;
  name: string;
  /** Closed coastline polygon (clockwise on the map). */
  coast: Point[];
  hills: Hill[];
  /** Areas where trees grow densely (centre + radius); elsewhere woods are sparse. */
  forests: Array<{ x: number; z: number; radius: number }>;
  zones: MapZone[];
  roads: MapRoad[];
  power: PowerLine[];
  /** Versioned local sculpt strokes; coast, POIs, roads and structure pads are protected. */
  terrainEdits?: Array<{ x: number; z: number; radius: number; delta: number }>;
  /** Supplemental homes in validated road-frontage lots; authored gameplay objects stay intact. */
  extraBuildings?: Array<{ id: string; zone: string; asset: number; x: number; z: number; yaw: number; lot?: { polygon: Point[]; frontage: [Point, Point] } }>;
  /** Dress supplemental homes with the existing fence and shrub assets. */
  dressExtraBuildings?: boolean;
  /** World Studio maps: the edited height grid (float32 little-endian, base64), replacing coast and hills. */
  terrainGrid?: { size: number; cell: number; data: string };
  /** World Studio maps: every building and prop as a site (replaces the island's districts). */
  placed?: Array<{ x: number; z: number; y: number; yaw: number; radius: number; halfX?: number; halfZ?: number; decal?: boolean; parts: Array<{ asset: number; x: number; y: number; z: number; yaw: number; scale: number }> }>;
  /** World Studio maps: painted vegetation [asset, x, z, yaw, scale] (replaces the forest scatter). */
  flora?: Array<[number, number, number, number, number]>;
}

export const ISLAND: AuthoredMap = {
  id: 'hac-son',
  name: 'Đảo Hắc Sơn',
  coast: [
    [900, 700], [1300, 520], [1800, 430], [2300, 450], [2800, 560], [3200, 760],
    [3450, 1050], [3560, 1400], [3650, 1750], [3640, 2150], [3520, 2500], [3380, 2850],
    [3150, 3150], [2800, 3400], [2450, 3520],
    // The harbour basin cuts into the south coast.
    [2330, 3560], [2300, 3420], [2240, 3330], [2120, 3305], [1960, 3310], [1880, 3380], [1840, 3580],
    [1500, 3620], [1150, 3500], [850, 3300], [650, 3000],
    [520, 2650], [420, 2300], [400, 1950], [470, 1600], [560, 1250], [700, 950],
  ],
  hills: [
    // The northern spine (the base sits on its seaward shoulder, the radar on its summit).
    { x: 1550, z: 1250, radius: 420, height: 175 },
    { x: 2050, z: 1350, radius: 380, height: 120 },
    { x: 2600, z: 1250, radius: 380, height: 140 },
    { x: 1150, z: 1550, radius: 300, height: 85 },
    // Eastern uplands and the highland village plateau.
    { x: 3000, z: 1350, radius: 330, height: 90 },
    { x: 2950, z: 950, radius: 220, height: 40 },
    // Southern and western rolling hills.
    { x: 2900, z: 2650, radius: 300, height: 70 },
    { x: 950, z: 2650, radius: 260, height: 55 },
    { x: 1500, z: 2950, radius: 200, height: 30 },
    { x: 2500, z: 2450, radius: 220, height: 35 },
  ],
  forests: [
    { x: 1350, z: 1500, radius: 380 }, { x: 2350, z: 1550, radius: 320 }, { x: 2800, z: 1350, radius: 300 },
    { x: 1000, z: 2600, radius: 300 }, { x: 2950, z: 2600, radius: 330 }, { x: 1600, z: 900, radius: 250 },
    { x: 3300, z: 1250, radius: 220 }, { x: 1500, z: 3200, radius: 200 },
  ],
  zones: [
    { id: 'port', name: 'Cảng Hắc Hải', kind: 'port', x: 2080, z: 3150, radius: 260 },
    { id: 'town', name: 'Thị trấn Thạch Lâm', kind: 'town', x: 1980, z: 2680, radius: 200 },
    { id: 'base', name: 'Căn cứ Bắc Phong', kind: 'military', x: 2120, z: 820, radius: 170 },
    { id: 'plant', name: 'Nhà máy nhiệt điện Đông Sơn', kind: 'power_plant', x: 3330, z: 1960, radius: 170 },
    { id: 'airfield', name: 'Sân bay Tây Lĩnh', kind: 'airfield', x: 820, z: 1950, radius: 330 },
    { id: 'fishing', name: 'Làng chài Nam Vịnh', kind: 'village', x: 1180, z: 3250, radius: 120 },
    { id: 'highland', name: 'Làng Cao Nguyên', kind: 'farm', x: 2960, z: 960, radius: 120 },
    { id: 'radar', name: 'Trạm ra-đa Đỉnh Gió', kind: 'radar', x: 1560, z: 1240, radius: 60 },
    { id: 'substation', name: 'Trạm biến áp Thạch Lâm', kind: 'substation', x: 2240, z: 2300, radius: 50 },
    { id: 'eastvillage', name: 'Xóm Đồi Thông', kind: 'village', x: 2850, z: 2250, radius: 90 },
    { id: 'lighthouse', name: 'Mũi Hải Đăng', kind: 'lighthouse', x: 3480, z: 2700, radius: 40 },
    // Everyday island life: a school, a church, a fuel station, farms and hamlets along the roads.
    { id: 'school', name: 'Trường Thạch Lâm', kind: 'school', x: 2175, z: 2700, radius: 60 },
    { id: 'stadium', name: 'Sân vận động Thạch Lâm', kind: 'stadium', x: 2330, z: 2520, radius: 80 },
    { id: 'park', name: 'Công viên Hồ Sen', kind: 'park', x: 1690, z: 2790, radius: 50 },
    { id: 'church', name: 'Nhà thờ Thạch Lâm', kind: 'church', x: 1815, z: 2700, radius: 45 },
    { id: 'fuel', name: 'Cây xăng Đèo Gió', kind: 'station', x: 2195, z: 2185, radius: 35 },
    { id: 'westfarm', name: 'Trang trại Đồng Cỏ', kind: 'farm', x: 1380, z: 2440, radius: 70 },
    { id: 'southfarm', name: 'Trang trại Bãi Nam', kind: 'farm', x: 1610, z: 3010, radius: 70 },
    { id: 'eastfarm', name: 'Trang trại Đồi Thông', kind: 'farm', x: 2600, z: 2360, radius: 70 },
    { id: 'northfarm', name: 'Trang trại Gió Bắc', kind: 'farm', x: 3130, z: 1680, radius: 60 },
    { id: 'pinehamlet', name: 'Xóm Bãi Cát', kind: 'village', x: 1300, z: 2930, radius: 60 },
    { id: 'creek', name: 'Xóm Suối', kind: 'village', x: 2420, z: 2720, radius: 60 },
    { id: 'ridge', name: 'Xóm Sườn Đồi', kind: 'village', x: 3060, z: 2460, radius: 55 },
    { id: 'northbay', name: 'Xóm Vịnh Bắc', kind: 'village', x: 2480, z: 990, radius: 55 },
  ],
  roads: [
    // Main avenue: harbour gate → town high street → mountain pass → base.
    { paved: true, width: 11.34, points: [[2080, 3020], [2040, 2930], [1980, 2850], [1980, 2520], [2010, 2440], [2090, 2280], [2140, 2100]] },
    // ...then up through the mountains as a winding pass, round the slopes, over the col and down to the base.
    { paved: true, width: 9.2, route: true, points: [[2140, 2100], [1850, 1300], [2010, 1030], [2100, 960]] },
    // East road: town → substation → power plant.
    { paved: true, width: 10.26, points: [[2120, 2602], [2240, 2380], [2400, 2250], [2620, 2160], [2850, 2120], [3050, 2040], [3200, 1990]] },
    // West road: town → airfield.
    { paved: true, width: 9.72, points: [[1840, 2602], [1650, 2470], [1450, 2330], [1250, 2200], [1060, 2060], [960, 2000]] },
    // South coast road: port → fishing village → airfield.
    { paved: true, width: 7.56, points: [[1880, 3060], [1700, 3120], [1500, 3170], [1320, 3220], [1200, 3200], [1020, 3080], [880, 2900], [760, 2650], [700, 2400], [720, 2150]] },
    // North coast road: base → highland village → plant.
    { paved: true, width: 7.56, points: [[2240, 880], [2450, 850], [2700, 880], [2880, 940], [3060, 1060], [3220, 1300], [3330, 1550], [3360, 1800]] },
    // Radar spur.
    { paved: true, width: 6.48, points: [[1850, 1300], [1720, 1270], [1610, 1250]] },
    // East village and the lighthouse.
    { paved: true, width: 7.02, points: [[2620, 2160], [2760, 2230], [2850, 2260]] },
    { paved: true, width: 6.48, points: [[3200, 1990], [3330, 2150], [3420, 2400], [3470, 2650]] },
    // Airfield runway and taxiway.
    { paved: true, width: 20.25, points: [[800, 1640], [806, 1950], [812, 2260]] },
    { paved: true, width: 8.1, points: [[806, 1950], [900, 1950], [960, 2000]] },
    // Port quay road.
    { paved: true, width: 9.72, points: [[1880, 3060], [2080, 3020], [2300, 3040], [2420, 3120]] },
    // Town cross streets either side of the high street.
    { paved: true, width: 8.1, points: [[1840, 2602], [1980, 2602], [2120, 2602]] },
    { paved: true, width: 8.1, points: [[1840, 2760], [1980, 2760], [2120, 2760]] },
  ],
  power: [
    // Transmission line from the power station to the town substation.
    { kind: 'tower', spacing: 150, points: [[3230, 1930], [2950, 2010], [2650, 2090], [2400, 2190], [2260, 2280]] },
    // From the substation north over the pass to the base.
    { kind: 'tower', spacing: 160, points: [[2230, 2270], [2230, 2000], [2210, 1700], [2120, 1450], [2050, 1150], [2110, 920]] },
    // West to the airfield.
    { kind: 'tower', spacing: 160, points: [[2210, 2320], [1900, 2380], [1600, 2340], [1300, 2180], [1000, 2010], [880, 1990]] },
    // Distribution poles through town and down to the harbour.
    { kind: 'hframe', spacing: 36, points: [[2220, 2330], [2120, 2440], [1990, 2490], [1990, 2880], [2040, 2960], [2120, 3010], [2200, 3060]] },
    { kind: 'hframe', spacing: 70, points: [[1880, 3060], [1700, 3140], [1500, 3200], [1260, 3240]] },
  ],
};
