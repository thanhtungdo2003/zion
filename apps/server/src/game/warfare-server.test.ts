import { describe, expect, it, vi } from 'vitest';
import { createDefaultRegistry } from '@zion/assets';
import { INFECTION_MAP, type ServerJsonMessage, type WarfareConfig, type WarfareStateMessage } from '@zion/shared';
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
import type { BattleBot, BattleBotDirector } from './battle-bots';
import type { ClientSession } from './session';
import type { Player } from './player';

interface Harness {
  warfare: WarfareMatch;
  wfCfg: WarfareConfig;
  stepWarfare(now: number): void;
  prepareWarfareArea(): Promise<void>;
  bots: BattleBotDirector;
  wfSide: Map<number, string>;
  wfLeader: Map<number, number>;
  serverTime: number;
  damage(a: number | null, t: Player, n: number, zone: string, x: number, y: number, z: number, now: number): void;
  warfareBotDamage(bot: BattleBot, n: number, by: number | null, from: { x: number; z: number } | null, zone: string, now: number): void;
}

/** The built-in yard as a battlefield: one player, a bot army capped small, a few seconds per step. */
describe('warfare server', () => {
  it('deploy screen, kits, bots under the cap, one ticket per death, 7 s respawn, G recruits, the end and a full clean-up', async () => {
    const logger = createLogger('silent', false), registry = createDefaultRegistry();
    const world = new WorldService({ seed: normalizeSeed(INFECTION_MAP.seed), sizeChunks: INFECTION_MAP.sizeChunks, generatorVersion: GENERATOR_VERSION, seaLevel: 20, mode: 'infection' }, registry, 0, 512, logger);
    const repository = { load: vi.fn(), saveMany: vi.fn(), loadChest: vi.fn(), saveChestAndPlayer: vi.fn() };
    const closed = vi.fn();
    const game = new GameServer({ mode: 'warfare', warfare: { matchId: 'w1', mapId: 'warehouse', mapName: 'Kho', closed }, world, registry, config: { DAY_LENGTH_MINUTES: 25 } as AppConfig, logger, metrics: new Metrics(), audit: { record: vi.fn() } as unknown as AuditLog, playerStates: repository as unknown as PlayerStateRepository, worlds: {} as WorldRepository, worldId: INFECTION_MAP.id, initialWorldTimeMs: 0 });
    const h = game as unknown as Harness;
    // A small battle keeps the test quick: 8 on the field, 20 tickets a side.
    Object.assign(h.wfCfg, { maxActive: 8, tickets: 20, countdownSeconds: 2 });
    Object.assign(h.warfare.ledger.tickets, { blue: 20, red: 20 });
    const sent: ServerJsonMessage[] = [];
    const session = { id: 1, open: true, buffered: 0, state: 'joining', account: { accountId: '00000000-0000-0000-0000-000000000001', username: 'Ann' }, sendJson: vi.fn((m: ServerJsonMessage) => sent.push(m)), sendText: vi.fn((t: string) => sent.push(JSON.parse(t) as ServerJsonMessage)), sendBinary: vi.fn(() => true), sendError: vi.fn(), close: vi.fn() } as unknown as ClientSession;
    const last = () => sent.filter((m): m is WarfareStateMessage => m.t === 'warfare').at(-1)!;
    const active = () => [...h.bots.bots].filter((b) => !b.dead).length + (session.player && !session.player.dead ? 1 : 0);
    try {
      await world.start();
      await game.join(session);
      await h.prepareWarfareArea();
      const p = session.player!;
      expect(session.sendJson).toHaveBeenCalledWith(expect.objectContaining({ t: 'welcome', mode: 'warfare' }));
      // On the deploy screen: not on the field, nothing in hand.
      expect(p.dead).toBe(true);
      expect(p.inv.items).toHaveLength(0);
      expect(h.wfSide.get(p.id)).toBe('blue');
      // A public room keeps taking players while the match runs.
      expect(game.canAdmit()).toBe(true);

      let now = 1000;
      h.stepWarfare(now);
      expect(h.warfare.phase).toBe('countdown');
      // Deploy as support with a chosen sidearm; a gun from another class is refused.
      game.handleMessage(session, { t: 'wfDeploy', cls: 'support', loadout: { primary: 'awm', secondary: 'deagle' }, ready: true });
      for (let i = 0; i < 12; i++) { now += 250; h.stepWarfare(now); }
      expect(p.dead).toBe(false);
      const kit = p.inv.items.map((i) => i.itemId);
      expect(kit).toContain('pkm');
      expect(kit).toContain('deagle');
      expect(kit).not.toContain('awm');
      expect(h.warfare.phase).toBe('fighting');
      // Bots fill both sides, never past the active cap.
      for (let i = 0; i < 40; i++) { now += 250; h.stepWarfare(now); expect(active()).toBeLessThanOrEqual(8); }
      expect(h.bots.bots.length).toBeGreaterThan(0);
      expect(active()).toBe(8);
      const state = last();
      expect(state.you).toMatchObject({ side: 'blue', cls: 'support', respawnIn: null });
      expect(state.zones.length).toBeGreaterThan(0);
      expect(state.deploy.some((d) => d.id === 'base')).toBe(true);
      // Enemies' positions are never sent.
      expect(state.units.filter((u) => u.side === 'red').every((u) => u.x === undefined)).toBe(true);
      // AI squads got tasks on the zones.
      expect(state.tasks.length).toBeGreaterThan(0);
      expect(h.bots.bots.filter((b) => !b.dead && h.wfSide.get(b.id) === 'blue').every((b) => b.objective)).toBe(true);

      // Left to themselves, the bots go out and take zones.
      for (let i = 0; i < 200 && !h.warfare.capture.zones.some((z) => z.owner); i++) { now += 250; h.stepWarfare(now); }
      expect(h.warfare.capture.zones.some((z) => z.owner)).toBe(true);

      // A red bot falls: exactly one red ticket, even if its death is reported twice.
      const red = h.bots.bots.find((b) => !b.dead && h.wfSide.get(b.id) === 'red')!;
      const before = h.warfare.ledger.tickets.red;
      h.warfareBotDamage(red, 500, p.id, p.state, 'head', now);
      h.warfareBotDamage(red, 500, p.id, p.state, 'head', now);
      expect(red.dead).toBe(true);
      expect(h.warfare.ledger.tickets.red).toBe(before - 1);
      // Back after the respawn delay (7 s), not before.
      for (let t = 0; t < 6000; t += 250) { now += 250; h.stepWarfare(now); }
      expect(red.dead).toBe(true);
      for (let t = 0; t < 2500; t += 250) { now += 250; h.stepWarfare(now); }
      expect(red.dead).toBe(false);

      // No friendly fire: a blue bot cannot hurt the player.
      const blue = h.bots.bots.find((b) => !b.dead && h.wfSide.get(b.id) === 'blue')!;
      h.damage(blue.id, p, 40, 'torso', p.state.x, p.state.y, p.state.z, now);
      expect(p.health).toBe(100);

      // G with nothing aimed: the nearest allies follow (bring one close first).
      Object.assign(blue.state, { x: p.state.x + 3, z: p.state.z });
      game.handleMessage(session, { t: 'wfRecruit' });
      expect(h.wfLeader.get(blue.id)).toBe(p.id);
      now += 250; h.stepWarfare(now);
      expect(last().you!.followers).toContain(blue.id);
      // Dismissed: back to its AI squad.
      game.handleMessage(session, { t: 'wfRecruit', dismiss: true });
      expect(h.wfLeader.has(blue.id)).toBe(false);

      // The player dies: one blue ticket, the deploy screen again.
      const blueBefore = h.warfare.ledger.tickets.blue;
      h.damage(red.id, p, 500, 'head', p.state.x, p.state.y, p.state.z, now);
      expect(p.dead).toBe(true);
      expect(h.warfare.ledger.tickets.blue).toBe(blueBefore - 1);
      now += 250; h.stepWarfare(now);
      expect(last().you!.respawnIn).toBeGreaterThan(0);

      // Red runs out of tickets: blue wins; the room closes after the result screen and nothing stays.
      h.warfare.ledger.tickets.red = 0;
      now += 250; h.stepWarfare(now);
      expect(h.warfare.phase).toBe('over');
      expect(game.canAdmit()).toBe(false);
      expect(last().result).toMatchObject({ winner: 'blue', reason: 'tickets' });
      now += h.wfCfg.overSeconds * 1000 + 500; h.stepWarfare(now);
      expect(closed).toHaveBeenCalledTimes(1);
      expect(h.bots.bots).toHaveLength(0);
      now += 250; h.stepWarfare(now);
      expect(closed).toHaveBeenCalledTimes(1);
    } finally {
      await game.stop();
      await world.close();
    }
  }, 240_000);
});
