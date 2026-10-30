import { describe, expect, it } from 'vitest';
import { validateWarfareLayout } from '@zion/shared';
import { createMapDoc, defaultTerrainSettings, type Region, type WorldMapDoc } from './index';
import { settlementWarfareLayout } from './warfare-auto';

/** A region whose only content is buildings round a centre (what the zoning reads). */
function place(name: string, x: number, z: number, count: number, spread: number, preset: Region['preset'] = 'small-village'): Region {
  const buildings = Array.from({ length: count }, (_, i) => {
    const a = i * 2.4, r = spread * Math.sqrt((i + 1) / count);
    return { x: x + Math.cos(a) * r, z: z + Math.sin(a) * r };
  });
  return { id: name, name, preset, result: { buildings } } as unknown as Region;
}

function doc(regions: Region[]): WorldMapDoc {
  const d = createMapDoc({ name: 't', kind: 'warfare', template: 'blank', terrain: defaultTerrainSettings('tectonic', 'zion', 2048) });
  d.regions = regions;
  return d;
}

describe('Warfare zones from the map’s settlements', () => {
  it('one zone per village, lettered from the blue base to the red one, a valid layout', () => {
    const l = settlementWarfareLayout(doc([
      place('Làng Mai', 800, 1000, 20, 30), place('Xóm Đông', 1000, 1010, 15, 25), place('Đồn Bắc', 1200, 990, 25, 30, 'military-base'),
      place('Bến Cũ', 1000, 1180, 12, 20), place('Xa Lắm', 1900, 200, 30, 30),
    ]))!;
    expect(l).not.toBeNull();
    expect(validateWarfareLayout(l)).toEqual([]);
    // The whole map is the battlefield: every village is a zone.
    expect(l.zones.map((z) => z.name.slice(2)).sort()).toEqual(['Bến Cũ', 'Làng Mai', 'Xa Lắm', 'Xóm Đông', 'Đồn Bắc'].sort());
    expect(l.zones.map((z) => z.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(l.zones.find((z) => z.name.endsWith('Đồn Bắc'))!.value).toBe(2);
    // Every zone has neighbours; the bases sit at opposite ends.
    expect(l.zones.every((z) => z.links.length > 0)).toBe(true);
    expect(Math.hypot(l.bases!.blue.x - l.bases!.red.x, l.bases!.blue.z - l.bases!.red.z)).toBeGreaterThan(200);
    expect(l.vehicleSpawns.length).toBe(6);
  });

  it('a city is split into several zones; no settlement means no layout', () => {
    const l = settlementWarfareLayout(doc([place('Thành phố', 1024, 1024, 200, 160, 'small-city')]))!;
    expect(l.zones.length).toBeGreaterThanOrEqual(3);
    expect(validateWarfareLayout(l)).toEqual([]);
    expect(settlementWarfareLayout(doc([]))).toBeNull();
  });

  it('regions not built yet and the match setup’s named places count too', () => {
    const d = doc([{ id: 'r', name: 'Phố Cổ', preset: 'small-village', polygon: [[900, 900], [960, 900], [960, 960], [900, 960]], result: null } as unknown as Region]);
    d.gameplay[0]!.pois.push({ id: 'p1', name: 'Đồn Biên', kind: 'military', x: 1100, z: 940, radius: 40 }, { id: 'p2', name: 'Chợ', kind: 'town', x: 1000, z: 1060, radius: 30 });
    const l = settlementWarfareLayout(d)!;
    expect(l.zones.map((z) => z.name.slice(2)).sort()).toEqual(['Chợ', 'Phố Cổ', 'Đồn Biên'].sort());
    expect(validateWarfareLayout(l)).toEqual([]);
  });
});
