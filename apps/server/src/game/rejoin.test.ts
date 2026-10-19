import { describe, expect, it, vi } from 'vitest';
import { createDefaultRegistry } from '@zion/assets';
import { BATTLE_MAP, type ServerJsonMessage } from '@zion/shared';
import { GENERATOR_VERSION, normalizeSeed } from '@zion/worldgen';
import { createLogger } from '../logger';
import { Metrics } from '../metrics';
import type { AppConfig } from '../config';
import type { AuditLog } from '../repositories/audit';
import type { PlayerStateRepository } from '../repositories/player-states';
import type { WorldRepository } from '../repositories/worlds';
import { WorldService } from '../world/world-service';
import { GameServer, REJOIN_GRACE_MS } from './game-server';
import type { BattleRoyaleMatch } from './battle-royale';
import type { ClientSession } from './session';

describe('rejoining a running battle royale match', () => {
  it('holds the place of a dropped player and puts them back with their kit, until the grace runs out', async () => {
    const logger = createLogger('silent', false), registry = createDefaultRegistry();
    const world = new WorldService({ seed: normalizeSeed(BATTLE_MAP.seed), sizeChunks: BATTLE_MAP.sizeChunks, generatorVersion: GENERATOR_VERSION, seaLevel: 20, mode: 'battle-royale' }, registry, 0, 512, logger);
    const repository = { load: vi.fn(), saveMany: vi.fn(), loadChest: vi.fn(), saveChestAndPlayer: vi.fn() };
    const game = new GameServer({ mode: 'battle-royale', world, registry, config: { DAY_LENGTH_MINUTES: 25 } as AppConfig, logger, metrics: new Metrics(), audit: { record: vi.fn() } as unknown as AuditLog, playerStates: repository as unknown as PlayerStateRepository, worlds: {} as WorldRepository, worldId: BATTLE_MAP.id, initialWorldTimeMs: 0 });
    const harness = game as unknown as { battle: BattleRoyaleMatch; serverTime: number; stepBattle(now: number): void; tick: number };
    const session = (id: number, account: string) => ({ id, open: true, buffered: 0, state: 'joining', account: { accountId: account, username: `P${account}` }, sendJson: vi.fn<(m: ServerJsonMessage) => void>(), sendText: vi.fn(), sendBinary: vi.fn(() => true), sendError: vi.fn(), close: vi.fn() }) as unknown as ClientSession;
    try {
      await world.start();
      const a = session(1, 'a'), b = session(2, 'b');
      await game.join(a); game.handleMessage(a, { t: 'ready' }); await game.join(b); game.handleMessage(b, { t: 'ready' });
      harness.battle.tick(0, 2); harness.battle.tick(30_000, 2);
      expect(harness.battle.phase).toBe('running');
      const p = a.player!, id = p.id;
      p.inv.add('ak47');
      Object.assign(p.state, { flight: 0, x: 900, z: 1100 });
      game.leave(a, 'disconnect');
      expect(harness.battle.eliminated.has(id)).toBe(false);
      expect(game.hasRejoin('a')).toBe(true);
      expect(game.headcount).toBe(2);
      // A brand-new player cannot join a running match, the dropped one can.
      const late = session(3, 'c');
      await game.join(late); game.handleMessage(late, { t: 'ready' });
      expect(late.player).toBeFalsy();
      const back = session(4, 'a');
      await game.join(back); game.handleMessage(back, { t: 'ready' });
      expect(back.player!.id).toBe(id);
      expect(back.player!.inv.items.map((i) => i.itemId)).toContain('ak47');
      expect(back.player!.state.x).toBeCloseTo(900);
      expect(game.hasRejoin('a')).toBe(true); // connected now
      // Dropped again and never back: out of the match after the grace.
      game.leave(back, 'disconnect');
      harness.stepBattle(harness.serverTime + REJOIN_GRACE_MS + 1);
      expect(harness.battle.eliminated.has(id)).toBe(true);
      expect(game.hasRejoin('a')).toBe(false);
    } finally {
      await game.stop();
      await world.close();
    }
  }, 60_000);
});
