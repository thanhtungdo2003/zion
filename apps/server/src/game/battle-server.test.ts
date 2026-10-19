import { describe, expect, it, vi } from 'vitest';
import { createDefaultRegistry } from '@zion/assets';
import { BATTLE_MAP, Buttons, TICK_RATE, type ChestData, type InputMessage, type ServerJsonMessage } from '@zion/shared';
import { GENERATOR_VERSION, normalizeSeed } from '@zion/worldgen';
import { createLogger } from '../logger';
import { Metrics } from '../metrics';
import type { AppConfig } from '../config';
import type { AuditLog } from '../repositories/audit';
import type { PlayerStateRepository } from '../repositories/player-states';
import type { WorldRepository } from '../repositories/worlds';
import { WorldService } from '../world/world-service';
import { GameServer } from './game-server';
import type { BattleRoyaleMatch } from './battle-royale';
import type { ClientSession } from './session';
import type { Player } from './player';

interface Harness {
  physics: { ensureArea(cx: number, cz: number, radius: number): Promise<void> };
  applyInput(player: Player, input: InputMessage, now: number): void;
  battleDoors: Map<number, { x: number; y: number; z: number; open: boolean }>;
  battle: BattleRoyaleMatch;
  tick: number;
  stepBattle(now: number): void;
  playerAttackAllowed(a: Player, b: Player, now: number): boolean;
  damage(attacker: number | null, player: Player, amount: number, zone: string, x: number, y: number, z: number, now: number, weapon?: number | string): void;
  persistAll(all: boolean): Promise<void>;
  groundItems: Map<number, { expiresAt: number }>;
  deathCrates: Map<string, { id: string; x: number; y: number; z: number }>;
  battleChests: Map<string, ChestData>;
  expireGroundItems(now: number): void;
}
describe('isolated Battle Royale simulation', () => {
  it('starts fresh, forces PvP, eliminates without revival, applies zone damage and never saves survival data', async () => {
    const logger = createLogger('silent', false), registry = createDefaultRegistry();
    const world = new WorldService({ seed: normalizeSeed(BATTLE_MAP.seed), sizeChunks: BATTLE_MAP.sizeChunks, generatorVersion: GENERATOR_VERSION, seaLevel: 20, mode: 'battle-royale' }, registry, 0, 512, logger);
    const repository = { load: vi.fn(), saveMany: vi.fn(), loadChest: vi.fn(), saveChestAndPlayer: vi.fn() };
    const game = new GameServer({ mode: 'battle-royale', world, registry, config: { DAY_LENGTH_MINUTES: 25 } as AppConfig, logger, metrics: new Metrics(), audit: { record: vi.fn() } as unknown as AuditLog, playerStates: repository as unknown as PlayerStateRepository, worlds: {} as WorldRepository, worldId: BATTLE_MAP.id, initialWorldTimeMs: 0 });
    const harness = game as unknown as Harness;
    const session = (id: number) => ({ id, open: true, buffered: 0, state: 'joining', account: { accountId: String(id), username: `Player ${id}` }, sendJson: vi.fn<(msg: ServerJsonMessage) => void>(), sendText: vi.fn(), sendBinary: vi.fn(() => true), sendError: vi.fn(), close: vi.fn() }) as unknown as ClientSession;
    const a = session(1), b = session(2);
    try {
      await world.start(); await game.join(a); game.handleMessage(a, { t: 'ready' }); await game.join(b); game.handleMessage(b, { t: 'ready' });
      expect(a.player!.inv.items).toEqual([]); expect(a.player!.coins).toBe(0);
      expect(a.sendJson).toHaveBeenCalledWith(expect.objectContaining({ t: 'welcome', mode: 'battle-royale' }));
      expect(game.content.npcs).toEqual([]); expect(game.content.quests).toEqual([]);
      expect(Math.hypot(a.player!.state.x - b.player!.state.x, a.player!.state.z - b.player!.state.z)).toBeGreaterThanOrEqual(30);
      expect(harness.playerAttackAllowed(a.player!, b.player!, 0)).toBe(false);
      const [doorId, door] = [...harness.battleDoors][0]!;
      game.handleMessage(a, { t: 'door', id: doorId }); expect(door.open).toBe(false);
      Object.assign(a.player!.state, { x: door.x, y: door.y, z: door.z + 1.5 });
      game.handleMessage(a, { t: 'door', id: doorId }); expect(door.open).toBe(true);
      expect(b.sendText).toHaveBeenCalledWith(expect.stringContaining('"open":true'));
      harness.battle.tick(0); harness.battle.tick(30_000);
      expect(harness.playerAttackAllowed(a.player!, b.player!, 30_001)).toBe(true);
      game.handleMessage(a, { t: 'pvp', enabled: false });
      expect(harness.playerAttackAllowed(a.player!, b.player!, 30_002)).toBe(true);
      const player = b.player!;
      player.inv.add('ak47'); player.inv.add('medkit');
      player.state.x = 1; player.state.z = 1;
      harness.tick = TICK_RATE; harness.stepBattle(30_003);
      expect(player.state.flight).toBe(1);
      await harness.physics.ensureArea(Math.floor(a.player!.state.x / 32), Math.floor(a.player!.state.z / 32), 1);
      const input = (s: number, b: number): InputMessage => ({ t: 'in', s, mx: 0, mz: 0, yaw: 0, pitch: 0, b });
      harness.applyInput(a.player!, input(1, Buttons.Jump), 30_004); expect(a.player!.state.flight).toBe(2);
      harness.applyInput(a.player!, input(2, 0), 30_005);
      harness.applyInput(a.player!, input(3, Buttons.Jump), 30_006); expect(a.player!.state.flight).toBe(2); // too soon to deploy
      a.player!.state.freefall = 10;
      harness.applyInput(a.player!, input(4, 0), 30_007);
      harness.applyInput(a.player!, input(5, Buttons.Jump), 30_008); expect(a.player!.state.flight).toBe(3);
      harness.stepBattle(85_001); expect(player.state.flight).toBe(2);
      // Simulate having jumped and landed before exercising ground combat/zone rules.
      player.state.flight = 0; a.player!.state.flight = 0;
      player.state.x = 1; player.state.z = 1;
      harness.stepBattle(30_003);
      expect(player.health).toBe(99);
      const scattered = harness.groundItems.size;
      harness.damage(a.player!.id, player, 1000, 'torso', 0, 0, 0, 30_004, 1);
      expect(player.dead).toBe(true); expect(player.downed).toBe(false); expect(player.inv.items).toEqual([]);
      // Death drops nothing loose: the inventory goes into a crate (floor loot was there already).
      expect(harness.groundItems.size).toBe(scattered);
      expect(harness.deathCrates.size).toBe(1);
      const crateId = [...harness.deathCrates.keys()][0]!;
      const loot = harness.battleChests.get(crateId)!;
      expect(loot.searched).toBe(true);
      expect(loot.items.map(item => item.itemId)).toEqual(['ak47', 'medkit']);
      expect(a.sendText).toHaveBeenCalledWith(expect.stringContaining('"t":"lootCrates"'));
      harness.expireGroundItems(24 * 60 * 60 * 1000);
      expect(harness.deathCrates.size).toBe(1);
      expect(a.sendText).toHaveBeenCalledWith(expect.stringContaining('BATTLE ROYALE'));
      game.handleMessage(b, { t: 'respawn' }); expect(player.dead).toBe(true);
      harness.battle.tick(30_005); expect(harness.battle.state(30_005).winner?.id).toBe(a.player!.id);
      game.leave(a, 'test'); game.leave(b, 'test'); await harness.persistAll(true);
      for (const method of Object.values(repository)) expect(method).not.toHaveBeenCalled();
      harness.stepBattle(30_006); expect(harness.battle.phase).toBe('waiting'); expect(harness.battle.alive).toBe(0);
    } finally { await game.stop(); await world.close(); }
  }, 45_000);
});
