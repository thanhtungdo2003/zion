import { describe, expect, it, vi } from 'vitest';
import { createDefaultRegistry } from '@zion/assets';
import { INFECTION_MAP, WAVE_COUNTDOWN_MS, type ServerJsonMessage, type WaveResult, type WaveStateMessage } from '@zion/shared';
import { GENERATOR_VERSION, normalizeSeed } from '@zion/worldgen';
import { createLogger } from '../logger';
import { Metrics } from '../metrics';
import type { AppConfig } from '../config';
import type { AuditLog } from '../repositories/audit';
import type { PlayerStateRepository } from '../repositories/player-states';
import type { WorldRepository } from '../repositories/worlds';
import { WorldService } from '../world/world-service';
import { GameServer, type WaveRoomConfig } from './game-server';
import type { WaveMatch } from './waves';
import type { ZombieDirector } from './zombies';
import type { BattleBotDirector } from './battle-bots';
import type { ClientSession } from './session';

interface Harness { waves: WaveMatch; stepWaves(now: number): void; zombies: ZombieDirector; bots: BattleBotDirector }

/** One small arena, one player, two bots, a few simulated seconds per step (bounded). */
describe('wave survival server', () => {
  it('a player with two bots: kit, countdown, zombies that hunt bots too, a break with supplies, the result recorded on Trio Bot', async () => {
    const logger = createLogger('silent', false), registry = createDefaultRegistry();
    const world = new WorldService({ seed: normalizeSeed(INFECTION_MAP.seed), sizeChunks: INFECTION_MAP.sizeChunks, generatorVersion: GENERATOR_VERSION, seaLevel: 20, mode: 'infection' }, registry, 0, 512, logger);
    const repository = { load: vi.fn(), saveMany: vi.fn(), loadChest: vi.fn(), saveChestAndPlayer: vi.fn() };
    const recorded: WaveResult[] = [];
    const closed = vi.fn();
    const waves: WaveRoomConfig = { matchId: 'm1', mapId: 'warehouse', mapName: 'Kho', playMode: 'bots', bots: 2, expected: 1, record: async (r) => { recorded.push(r); return 1; }, closed };
    const game = new GameServer({ mode: 'waves', waves, world, registry, config: { DAY_LENGTH_MINUTES: 25 } as AppConfig, logger, metrics: new Metrics(), audit: { record: vi.fn() } as unknown as AuditLog, playerStates: repository as unknown as PlayerStateRepository, worlds: {} as WorldRepository, worldId: INFECTION_MAP.id, initialWorldTimeMs: 0 });
    const h = game as unknown as Harness;
    const sent: ServerJsonMessage[] = [];
    const session = { id: 1, open: true, buffered: 0, state: 'joining', account: { accountId: '00000000-0000-0000-0000-000000000001', username: 'Ann' }, sendJson: vi.fn((m: ServerJsonMessage) => sent.push(m)), sendText: vi.fn((t: string) => sent.push(JSON.parse(t) as ServerJsonMessage)), sendBinary: vi.fn(() => true), sendError: vi.fn(), close: vi.fn() } as unknown as ClientSession;
    try {
      await world.start();
      await game.join(session); game.handleMessage(session, { t: 'ready' });
      const p = session.player!;
      expect(session.sendJson).toHaveBeenCalledWith(expect.objectContaining({ t: 'welcome', mode: 'waves' }));
      expect(p.inv.items.map((i) => i.itemId).sort()).toEqual(['ammo_9mm', 'ammo_9mm', 'ammo_9mm', 'gl18', 'machete', 'medkit']);
      expect(game.canAdmit()).toBe(true);

      let now = 1000;
      h.stepWaves(now);
      expect(h.bots.bots).toHaveLength(2);
      expect(h.waves.phase).toBe('countdown');
      // Nothing hurts before the first wave.
      (game as unknown as { damage(a: number | null, t: typeof p, n: number, zone: string, x: number, y: number, z: number, now: number): void }).damage(null, p, 30, 'bite', 0, 0, 0, now);
      expect(p.health).toBe(100);
      now += WAVE_COUNTDOWN_MS;
      h.stepWaves(now);
      expect(h.waves.phase).toBe('fighting');
      expect(game.canAdmit()).toBe(false);
      for (let i = 0; i < 40; i++) { now += 250; h.stepWaves(now); }
      const zombies = [...h.zombies.zombies.values()].filter((z) => !z.dead);
      expect(zombies.length).toBeGreaterThan(0);
      expect(zombies.every((z) => z.horde)).toBe(true);
      // Zombies take the team's players and bots alike as prey.
      expect(zombies.some((z) => z.target && (z.target as unknown) !== p)).toBe(true);

      // Clear the wave: every remaining zombie falls; supplies drop and a break begins.
      const plan = h.waves.plan!;
      h.waves.spawned = plan.count;
      for (const z of h.zombies.zombies.values()) { z.dead = true; z.deadAt = now; }
      sent.length = 0;
      now += 250; h.stepWaves(now);
      expect(h.waves.phase).toBe('break');
      expect(sent.some((m) => m.t === 'ground')).toBe(true);
      const state = sent.filter((m): m is WaveStateMessage => m.t === 'waves').at(-1)!;
      expect(state).toMatchObject({ phase: 'break', cleared: 1, wave: 2, playMode: 'bots' });
      expect(state.members.filter((m) => m.bot)).toHaveLength(2);

      // The whole team goes down: over, recorded once on the Trio Bot board.
      p.dead = true;
      for (const b of h.bots.bots) b.dead = true;
      now += 250; h.stepWaves(now);
      await new Promise((r) => setTimeout(r, 10));
      expect(h.waves.phase).toBe('over');
      expect(recorded).toHaveLength(1);
      expect(recorded[0]).toMatchObject({ matchId: 'm1', mapId: 'warehouse', board: 'trio_bot', cleared: 1 });
      expect(recorded[0]!.members.filter((m) => m.bot)).toHaveLength(2);
      now += 250; h.stepWaves(now);
      expect(recorded).toHaveLength(1);
    } finally {
      await game.stop();
      await world.close();
    }
  }, 180_000);
});
