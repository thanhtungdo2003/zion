import { describe, expect, it, vi } from 'vitest';
import { createDefaultRegistry } from '@zion/assets';
import { INFECTION_MAP, type ServerJsonMessage, type WarfareConfig } from '@zion/shared';
import { GENERATOR_VERSION, normalizeSeed } from '@zion/worldgen';
import { createLogger } from '../logger';
import { Metrics } from '../metrics';
import type { AppConfig } from '../config';
import type { AuditLog } from '../repositories/audit';
import type { PlayerStateRepository } from '../repositories/player-states';
import type { WorldRepository } from '../repositories/worlds';
import { WorldService } from '../world/world-service';
import { GameServer } from './game-server';
import type { WarfareMatch } from './warfare';
import type { ClientSession } from './session';
import type { BattleBotDirector } from './battle-bots';

interface Harness {
  bots: BattleBotDirector;
  warfare: WarfareMatch;
  wfCfg: WarfareConfig;
  prepareWarfareArea(): Promise<void>;
  step(): void;
}

/**
 * The whole server tick (not only the warfare step) through a match: a player joins, loads,
 * deploys and plays among the bots. Any exception in the tick would take the whole server down
 * (every match and every player with it), so none may escape.
 */
describe('warfare soak', () => {
  it('runs the full tick through join, loading, deploy and fighting without an exception', async () => {
    const logger = createLogger('silent', false), registry = createDefaultRegistry();
    const world = new WorldService({ seed: normalizeSeed(INFECTION_MAP.seed), sizeChunks: INFECTION_MAP.sizeChunks, generatorVersion: GENERATOR_VERSION, seaLevel: 20, mode: 'infection' }, registry, 0, 512, logger);
    const repository = { load: vi.fn(), saveMany: vi.fn(), loadChest: vi.fn(), saveChestAndPlayer: vi.fn() };
    const game = new GameServer({ mode: 'warfare', warfare: { matchId: 'w1', mapId: 'warehouse', mapName: 'Kho', closed: vi.fn() }, world, registry, config: { DAY_LENGTH_MINUTES: 25 } as AppConfig, logger, metrics: new Metrics(), audit: { record: vi.fn() } as unknown as AuditLog, playerStates: repository as unknown as PlayerStateRepository, worlds: {} as WorldRepository, worldId: INFECTION_MAP.id, initialWorldTimeMs: 0 });
    const h = game as unknown as Harness;
    Object.assign(h.wfCfg, { maxActive: 10, countdownSeconds: 40 });
    const sent: ServerJsonMessage[] = [];
    const session = { id: 1, open: true, buffered: 0, loading: false, state: 'joining', account: { accountId: '00000000-0000-0000-0000-000000000001', username: 'Ann' }, sendJson: vi.fn((m: ServerJsonMessage) => sent.push(m)), sendText: vi.fn(), sendBinary: vi.fn(() => true), sendError: vi.fn(), close: vi.fn() } as unknown as ClientSession;
    try {
      await world.start();
      await game.join(session);
      await h.prepareWarfareArea();
      const p = session.player!;
      // Game time runs a tick per step (the real clock would barely move in a test).
      const real = performance.now.bind(performance);
      let offset = 0;
      vi.spyOn(performance, 'now').mockImplementation(() => real() + offset);
      const run = async (ticks: number) => {
        for (let i = 0; i < ticks; i++) {
          offset += 1000 / 30;
          h.step();
          // Let chunk loads (promises) land between ticks, as the event loop would.
          if (i % 10 === 0) await new Promise((r) => setTimeout(r, 0));
        }
      };
      await run(60);
      game.handleMessage(session, { t: 'ready' });
      // The field full of bots when the player presses deploy (as after a rejoin: their place went
      // to a bot while they were away): fewer places than bots on the field, nobody dying.
      await run(600);
      const bots = () => h.bots.bots.filter((b) => !b.dead).length;
      expect(bots()).toBe(9);
      h.wfCfg.maxActive = 9;
      game.handleMessage(session, { t: 'wfDeploy', cls: 'assault', ready: true });
      // In within a few seconds all the same: a bot of the side makes room.
      await run(90);
      expect(p.dead).toBe(false);
      expect(bots()).toBeLessThanOrEqual(8);
      // Playing: walking about while the bots fight.
      for (let s = 1; s < 300; s++) {
        game.handleMessage(session, { t: 'in', s, f: 1, yaw: s * .01, pitch: 0, dt: 33 } as never);
        await run(1);
      }
      expect(sent.some((m) => m.t === 'error')).toBe(false);
    } finally {
      vi.restoreAllMocks();
      await game.stop();
      await world.close();
    }
  }, 300_000);
});
