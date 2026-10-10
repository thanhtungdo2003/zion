import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorldInfo } from '@zion/shared';
import { currentAccount } from '@/lib/api';
import { Exploration, WorldMapStore } from './world-map';

vi.mock('@/lib/api', () => ({ currentAccount: vi.fn(() => ({ id: 'alpha' })), getWorldAtlas: vi.fn(async () => ({ worldId: 'world', size: 4096, pixels: 1, rgb: 'AAAA', structures: [] })) }));
const world: WorldInfo = { worldId: 'world', sizeChunks: 128, chunkSize: 32, seaLevel: 0, generatorVersion: 1, dayLengthSec: 600, cosmeticSeed: 123, camp: { x: 1500, z: 1500, halfSize: 50 } };
beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
  vi.mocked(currentAccount).mockReturnValue({ id: 'alpha', username: 'Alpha', guest: true, role: 'player' });
});
afterEach(() => vi.unstubAllGlobals());

describe('50 metre exploration footprints', () => {
  it('reveals a square centred on the player without revealing surrounding cells', () => {
    const fog = new Exploration();
    fog.reveal(100, 200, 4096);
    expect(fog.rows.size).toBe(50);
    for (const spans of fog.rows.values()) expect(spans).toEqual([[75, 125]]);
    expect(fog.has(75, 175)).toBe(true); expect(fog.has(124.9, 224.9)).toBe(true);
    expect(fog.has(125, 200)).toBe(false); expect(fog.has(100, 225)).toBe(false);
  });
  it('merges journeys in both directions while preserving unexplored gaps', () => {
    const fog = new Exploration();
    fog.reveal(100, 100, 4096); fog.reveal(200, 100, 4096);
    expect(fog.has(150, 100)).toBe(false);
    fog.reveal(150, 100, 4096); fog.reveal(50, 100, 4096);
    expect(fog.rows.get(100)).toEqual([[25, 225]]);
    expect(fog.reveal(150, 100, 4096)).toBe(false);
    expect(new Exploration(fog.serialize()).has(150, 100)).toBe(true);
  });
  it('clips footprints to world boundaries', () => {
    const fog = new Exploration();
    fog.reveal(0, 0, 512); expect(fog.rows.get(0)).toEqual([[0, 25]]);
    expect(fog.rows.size).toBe(25);
    expect(fog.reveal(-100, -100, 512)).toBe(false);
    fog.reveal(512, 512, 512); expect(fog.rows.get(511)).toEqual([[487, 512]]);
  });
});

describe('personal map notebook', () => {
  it('starts with a 1 km circular known area and expands only around movement', () => {
    const map = new WorldMapStore(); map.initialize(world);
    expect(map.known(2500, 1500)).toBe(true);
    expect(map.known(2501, 1500)).toBe(false);
    expect(map.known(2300, 2300)).toBe(false);
    map.explore(3000, 3000);
    expect(map.known(3024, 3024)).toBe(true); expect(map.known(3026, 3000)).toBe(false);
    expect(map.known(2700, 2700)).toBe(false); // Teleport does not reveal the path between endpoints.
    map.dispose();
  });
  it('locks base locations while allowing custom names, icons and direction toggles', () => {
    const map = new WorldMapStore(); map.initialize(world);
    map.updateFixed([{ role: 'farmer', x: 1510, z: 1500 }, { role: 'target', x: 3000, z: 3000 }]);
    expect(map.get().locations).toHaveLength(2);
    map.remove('base:home'); map.edit('base:home', { name: 'Changed', icon: 'lucide:skull', guide: true });
    expect(map.get().locations[0]).toMatchObject({ name: 'Căn cứ', icon: 'lucide:house', guide: true });
    const id = map.add(1520, 1520, '  Supply cache  ', 'lucide:boxes')!;
    expect(id).toBeTruthy();
    map.edit(id, { name: 'Safe camp', icon: 'lucide:tent', guide: true });
    expect(map.get().locations.find((m) => m.id === id)).toMatchObject({ name: 'Safe camp', icon: 'lucide:tent', guide: true });
    expect(map.add(3100, 3100, 'Unknown', 'lucide:flag')).toBeNull();
    map.remove(id); expect(map.get().locations.some((m) => m.id === id)).toBe(false);
    map.dispose();
  });
  it('persists exploration, markers and arrow settings and isolates accounts and worlds', () => {
    const map = new WorldMapStore(); map.initialize(world);
    map.explore(3000, 3000); map.add(3000, 3000, 'Outpost', 'lucide:flag'); map.setArrows(false); map.edit('base:home', { guide: true }); map.dispose();
    const reload = new WorldMapStore(); reload.initialize(world);
    expect(reload.known(3000, 3000)).toBe(true);
    expect(reload.get().locations.some((m) => m.name === 'Outpost')).toBe(true);
    expect(reload.get().arrows).toBe(false); expect(reload.get().locations[0]!.guide).toBe(true);
    reload.dispose();
    vi.mocked(currentAccount).mockReturnValue({ id: 'bravo', username: 'Bravo', guest: true, role: 'player' });
    const other = new WorldMapStore(); other.initialize(world);
    expect(other.known(3000, 3000)).toBe(false); expect(other.get().locations).toHaveLength(1); other.dispose();
    const changed = new WorldMapStore(); changed.initialize({ ...world, cosmeticSeed: 456 });
    expect(changed.known(3000, 3000)).toBe(false); changed.dispose();
  });
});
