import { describe, expect, it, vi } from 'vitest';
import { autoWarfareLayout } from '@zion/shared';
import { createLogger } from '../logger';
import type { Db } from '../db/pool';
import type { AssetRegistry } from '@zion/assets';
import type { GameServer } from '../game/game-server';
import { BattleMapService } from './battle-maps';

/** A published map without building a world: the service's own entry, a fake world and match. */
function service() {
  const queries: Array<[string, unknown[]]> = [];
  const db = { query: vi.fn(async (sql: string, args: unknown[]) => { queries.push([sql, args]); return { rows: [] }; }) } as unknown as Db;
  const created = vi.fn(() => ({ start: vi.fn(), stop: vi.fn(async () => {}), playerCount: 0 }) as unknown as GameServer);
  const svc = new BattleMapService(db, {} as AssetRegistry, 16, createLogger('silent', false), created);
  const world = { generator: { worldSize: 4096 }, close: vi.fn(async () => {}) };
  const entry = { id: 'island', name: 'Đảo', thumbnail: null, updatedAt: '', warfare: null, modes: [], world, worldId: 'br-island', pool: null, atlas: vi.fn(), tiles: vi.fn() };
  (svc as unknown as { maps: Map<string, unknown> }).maps.set('island', entry);
  (svc as unknown as { applyModes(e: unknown, m: string[]): void }).applyModes(entry, ['battle-royale']);
  return { svc, queries, created };
}
const layout = { ...autoWarfareLayout(200), area: { x: 2048, z: 2048, half: 200 } };

describe('World Studio maps and their game modes', () => {
  it('a battle royale map is listed for battle royale only', () => {
    const { svc } = service();
    expect(svc.list().map((m) => m.id)).toEqual(['island']);
    expect(svc.pool('island')).toBeDefined();
    expect(svc.warfareMaps()).toEqual([]);
  });

  it('assigning a battlefield adds Warfare; dropping battle royale takes it out of the battle royale picker', async () => {
    const { svc, queries } = service();
    await svc.setWarfare('island', layout);
    expect(svc.warfareMaps().map((m) => m.id)).toEqual(['island']);
    expect(svc.list().map((m) => m.id)).toEqual(['island']);
    await svc.setModes('island', ['warfare']);
    expect(svc.list()).toEqual([]);
    expect(svc.pool('island')).toBeUndefined();
    expect(svc.warfareMaps().map((m) => m.id)).toEqual(['island']);
    expect(queries.at(-1)![1]).toEqual(['island', ['warfare']]);
    // And back.
    await svc.setModes('island', ['battle-royale', 'warfare']);
    expect(svc.pool('island')).toBeDefined();
  });

  it('refuses Warfare without a valid battlefield, and a map with no mode at all', async () => {
    const { svc } = service();
    await expect(svc.setModes('island', ['warfare'])).rejects.toThrow(/Chiến trường/);
    await expect(svc.setModes('island', [])).rejects.toThrow();
    await expect(svc.setWarfare('island', { ...layout, zones: [] })).rejects.toThrow(/không hợp lệ|chưa hợp lệ/);
    await svc.setWarfare('island', layout);
    await svc.setModes('island', ['warfare']);
    // Turning the battlefield off would leave the map with no mode.
    await expect(svc.setWarfare('island', null)).rejects.toThrow(/gỡ bản đồ/);
  });

  it('a map not on the server says so (the Studio then publishes it for Warfare only)', async () => {
    const { svc } = service();
    await expect(svc.setWarfare('nowhere', layout)).rejects.toThrow(/chưa được xuất bản/);
  });
});
