import { describe, expect, it, vi } from 'vitest';
import type { AtlasTile } from '@zion/shared';
import { getAtlasTile } from '@/lib/api';
import { AtlasTiles } from './atlas-tiles';

vi.mock('@/lib/api', () => ({ getAtlasTile: vi.fn() }));
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const tile = (x: number): AtlasTile => ({ worldId: 'test', x: x * 256, z: 0, size: 256, pixels: 1, rgb: 'AAAA' });

describe('visible map details', () => {
  it('limits downloads to two and discards the obsolete viewport queue', async () => {
    const pending = new Map<number, (tile: AtlasTile) => void>();
    vi.mocked(getAtlasTile).mockReset().mockImplementation((x) => new Promise((resolve) => pending.set(x, resolve)));
    const changed = vi.fn(), cache = new AtlasTiles('test', changed);
    cache.setVisible(['0:0', '1:0', '2:0', '3:0']);
    expect(getAtlasTile).toHaveBeenCalledTimes(2);
    cache.setVisible(['4:0']);
    pending.get(0)!(tile(0)); await settle();
    expect(getAtlasTile).toHaveBeenCalledTimes(3);
    expect(getAtlasTile).toHaveBeenLastCalledWith(4, 0, undefined);
    pending.get(1)!(tile(1)); pending.get(4)!(tile(4)); await settle();
    cache.setVisible(['4:0']);
    expect(getAtlasTile).toHaveBeenCalledTimes(3);
    expect(changed).toHaveBeenCalledTimes(3); cache.dispose();
  });
  it('ignores completion after closing the map', async () => {
    let resolve!: (tile: AtlasTile) => void;
    vi.mocked(getAtlasTile).mockReset().mockImplementation(() => new Promise((done) => { resolve = done; }));
    const changed = vi.fn(), cache = new AtlasTiles('test', changed);
    cache.setVisible(['0:0']); cache.dispose(); resolve(tile(0)); await settle();
    expect(cache.tiles.size).toBe(0); expect(changed).not.toHaveBeenCalled();
  });
  it('keeps the overview on failure without repeatedly requesting the same tile', async () => {
    vi.mocked(getAtlasTile).mockReset().mockResolvedValue({ ...tile(0), worldId: 'old-world' });
    const changed = vi.fn(), cache = new AtlasTiles('test', changed);
    cache.setVisible(['0:0']); await settle(); cache.setVisible(['0:0']); await settle();
    expect(getAtlasTile).toHaveBeenCalledTimes(1);
    expect(cache.tiles.size).toBe(0); expect(changed).not.toHaveBeenCalled(); cache.dispose();
  });
});
