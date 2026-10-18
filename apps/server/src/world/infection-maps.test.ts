import { describe, expect, it, vi } from 'vitest';
import { createDefaultRegistry } from '@zion/assets';
import { DEFAULT_INFECTION_MAP, blankInfectionMap } from '@zion/shared';
import { createLogger } from '../logger';
import { InfectionMapService } from './infection-maps';
import type { Db } from '../db/pool';

describe('infection map service', () => {
  it('previews, saves, activates and refuses to delete the active map', async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const service = new InfectionMapService({ query } as unknown as Db, createDefaultRegistry(), 64, createLogger('silent', false), 0);
    await service.load();
    try {
      expect(service.active.id).toBe(DEFAULT_INFECTION_MAP.id);
      const map = blankInfectionMap('hill-town', 'Hill town', 'h1');
      const preview = service.preview(map);
      expect(preview.heights).toHaveLength(preview.size * preview.size);
      expect(preview.nature.length).toBeGreaterThan(0);
      const switched = vi.fn(); service.onSwitch = switched;
      await service.save(map);
      expect(service.maps.maps).toHaveLength(2);
      expect(switched).not.toHaveBeenCalled();
      const before = service.world;
      await service.activate('hill-town');
      expect(switched).toHaveBeenCalledOnce();
      expect(service.world).not.toBe(before);
      expect(service.worldId).toContain('hill-town');
      // Changing only the rules (time of day, day-night cycle) keeps the world and applies at once.
      const world = service.world;
      await service.save({ ...map, rules: { ...map.rules, timeOfDay: .25, dayCycleMinutes: 20 } });
      expect(service.world).toBe(world);
      expect(world.generator.config.infection?.rules).toMatchObject({ timeOfDay: .25, dayCycleMinutes: 20 });
      await expect(service.remove('hill-town')).rejects.toThrow();
      await expect(service.save({ ...map, half: 5 })).rejects.toThrow();
      expect(query).toHaveBeenCalledWith(expect.stringContaining('infection_maps'), expect.any(Array));
    } finally { await service.close(); }
  }, 60_000);
});
