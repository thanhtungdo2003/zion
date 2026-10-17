import { describe, expect, it, vi } from 'vitest';
import { createDefaultRegistry } from '@zion/assets';
import { Buttons, INFECTION, INFECTION_MAP, type InputMessage, type ServerJsonMessage } from '@zion/shared';
import { F13, GENERATOR_VERSION, friday13Spawns, normalizeSeed } from '@zion/worldgen';
import { createLogger } from '../logger';
import { Metrics } from '../metrics';
import type { AppConfig } from '../config';
import type { AuditLog } from '../repositories/audit';
import type { PlayerStateRepository } from '../repositories/player-states';
import type { WorldRepository } from '../repositories/worlds';
import { WorldService } from '../world/world-service';
import { GameServer } from './game-server';
import { InfectionMatch } from './infection';
import type { BattleBotDirector } from './battle-bots';
import type { ClientSession } from './session';
import type { Player } from './player';

interface Harness {
  physics: { ensureArea(cx: number, cz: number, radius: number): Promise<void> };
  applyInput(player: Player, input: InputMessage, now: number): void;
  infection: InfectionMatch;
  bots: BattleBotDirector;
  tick: number;
  stepInfection(now: number): void;
  playerAttackAllowed(a: Player, b: Player, now: number): boolean;
  damage(attacker: number | null, player: Player, amount: number, zone: string, x: number, y: number, z: number, now: number, weapon?: number | string): void;
  onReload(p: Player): void;
  stepReloads(now: number): void;
  activeScratch: Player[];
}

describe('infection rules', () => {
  it('counts down, turns a patient zero, and ends when the humans are gone or the clock runs out', () => {
    const m = new InfectionMatch(undefined, undefined, () => 0);
    m.join(1, 'a'); m.join(2, 'b'); m.join(3, 'c');
    // One player waits for a second one; after the lobby timeout the match starts anyway.
    expect(m.tick(0, 1).reset).toBeUndefined();
    expect(m.phase).toBe('waiting');
    expect(m.tick(1000, 2).reset).toBe(true);
    expect(m.phase).toBe('countdown');
    expect(m.accepting).toBe(true);
    expect(m.canHarm(1, 2)).toBe(false);
    m.tick(INFECTION.countdownMs + 1000, 1);
    expect(m.phase).toBe('running');
    expect(m.accepting).toBe(false);
    const ev = m.tick(INFECTION.countdownMs + 1000 + INFECTION.outbreakMs, 1);
    expect(ev.outbreak).toEqual([1]);
    expect(m.canHarm(1, 2)).toBe(true);
    expect(m.allies(2, 3)).toBe(true);
    expect(m.joinsAsZombie).toBe(true);
    m.infect(2); m.infect(3);
    let t = INFECTION.countdownMs + 1000 + INFECTION.outbreakMs + 1;
    expect(m.tick(t, 1).finished).toBe('zombies');
    expect(m.tick(t += INFECTION.finishedMs, 1).reset).toBe(true);
    expect(m.zombies.size).toBe(0);
    expect(m.round).toBe(2);
    // Later rounds run on; after the last one the match is over.
    for (let round = 2; round <= INFECTION.rounds; round++) {
      m.tick(t += INFECTION.countdownMs, 1);
      expect(m.tick(t += INFECTION.roundMs, 1).finished).toBeDefined();
      const next = m.tick(t += INFECTION.finishedMs, 1);
      expect(round < INFECTION.rounds ? next.reset : next.over).toBe(true);
    }
    expect(m.state(t).over).toBe(true);
  });

  it('starts a lone player after the lobby wait', () => {
    const m = new InfectionMatch();
    m.join(1, 'a');
    m.tick(0, 1);
    expect(m.phase).toBe('waiting');
    expect(m.tick(INFECTION.lobbyWaitMs, 1).reset).toBe(true);
  });
});

describe('isolated infection server', () => {
  it('hands out the loadout, turns humans with one blow, shoves zombies back and never runs out of ammo', async () => {
    const logger = createLogger('silent', false), registry = createDefaultRegistry();
    const world = new WorldService({ seed: normalizeSeed(INFECTION_MAP.seed), sizeChunks: INFECTION_MAP.sizeChunks, generatorVersion: GENERATOR_VERSION, seaLevel: 20, mode: 'infection' }, registry, 0, 512, logger);
    const repository = { load: vi.fn(), saveMany: vi.fn(), loadChest: vi.fn(), saveChestAndPlayer: vi.fn() };
    const game = new GameServer({ mode: 'infection', world, registry, config: { DAY_LENGTH_MINUTES: 25 } as AppConfig, logger, metrics: new Metrics(), audit: { record: vi.fn() } as unknown as AuditLog, playerStates: repository as unknown as PlayerStateRepository, worlds: {} as WorldRepository, worldId: INFECTION_MAP.id, initialWorldTimeMs: 0 });
    const harness = game as unknown as Harness;
    const session = (id: number) => ({ id, open: true, buffered: 0, state: 'joining', account: { accountId: String(id), username: `Player ${id}` }, sendJson: vi.fn<(msg: ServerJsonMessage) => void>(), sendText: vi.fn(), sendBinary: vi.fn(() => true), sendError: vi.fn(), close: vi.fn() }) as unknown as ClientSession;
    const a = session(1), b = session(2);
    try {
      await world.start();
      await game.join(a); await game.join(b);
      const pa = a.player!, pb = b.player!;
      expect(a.sendJson).toHaveBeenCalledWith(expect.objectContaining({ t: 'welcome', mode: 'infection' }));
      // Default loadout: AK-47, UZI, katana, two frags and two flashbangs; spawned inside the walls.
      expect(pa.inv.items.map((i) => i.itemId).sort()).toEqual(['ak47', 'flashbang', 'flashbang', 'grenade', 'grenade', 'katana', 'uzi']);
      expect(Math.max(Math.abs(pa.state.x - F13.centre), Math.abs(pa.state.z - F13.centre))).toBeLessThan(F13.half);
      expect(repository.load).not.toHaveBeenCalled();

      // A chosen loadout replaces it before the round.
      game.handleMessage(a, { t: 'loadout', primary: 'm4a1', secondary: 'deagle', melee: 'machete' });
      expect(pa.inv.items.map((i) => i.itemId)).toEqual(expect.arrayContaining(['m4a1', 'deagle', 'machete']));
      game.handleMessage(a, { t: 'loadout', primary: 'rocket_launcher', secondary: 'deagle', melee: 'machete' });
      expect(pa.inv.items.some((i) => i.itemId === 'rocket_launcher')).toBe(false);
      game.handleMessage(a, { t: 'loadout', primary: 'ak47', secondary: 'uzi', melee: 'katana' });

      // Countdown, round, outbreak: player 2 is chosen.
      const m = harness.infection;
      harness.stepInfection(0);
      expect(m.phase).toBe('countdown');
      expect(harness.playerAttackAllowed(pa, pb, 1)).toBe(false);
      harness.bots.clear();
      for (const id of [...m.entrants.keys()]) if (id !== pa.id && id !== pb.id) m.leave(id);
      m.tick(INFECTION.countdownMs, 2);
      m.infect(pb.id);
      (m as unknown as { outbroke: boolean }).outbroke = true;
      expect(harness.playerAttackAllowed(pa, pb, 1)).toBe(true);

      // Zombie: no rolling or going prone, faster and higher jumping.
      game.handleMessage(b, { t: 'loadout', primary: 'ak47', secondary: 'uzi', melee: 'katana' });
      (game as unknown as { makeZombie(p: Player): void }).makeZombie(pb);
      expect(pb.inv.items.map((i) => i.itemId)).toEqual(['fire_axe']);
      expect(pb.speedMul).toBeCloseTo(INFECTION.zombieSpeed);
      await harness.physics.ensureArea(Math.floor(pb.state.x / 32), Math.floor(pb.state.z / 32), 1);
      pb.state.grounded = true;
      harness.applyInput(pb, { t: 'in', s: 1, mx: 0, mz: 0, yaw: 0, pitch: 0, b: Buttons.Prone | Buttons.Roll }, 1);
      expect(pb.state.prone).toBe(false);
      expect(pb.state.rollTicks).toBe(0);

      // Bullets: a little health and a shove, never a stun.
      Object.assign(pb.state, { x: F13.centre + 40, z: F13.centre + 2.5, pushX: 0, pushZ: 0 });
      Object.assign(pa.state, { x: F13.centre + 30, z: F13.centre + 2.5 });
      harness.damage(pa.id, pb, 20, 'torso', 0, 0, 0, 2, 1);
      expect(pb.health).toBeCloseTo(100 - 20 * 100 / INFECTION.zombieHealth);
      expect(pb.state.pushX).toBeGreaterThan(1);
      expect(pb.stunUntil).toBeLessThan(2);
      expect(pb.dead).toBe(false);

      // One blow from the zombie turns the human.
      harness.damage(pb.id, pa, 5, 'torso', 0, 0, 0, 3, 'fire_axe');
      expect(pa.dead).toBe(false);
      expect(m.isZombie(pa.id)).toBe(true);
      expect(pa.inv.items.map((i) => i.itemId)).toEqual(['fire_axe']);
    } finally {
      await game.stop();
      await world.close();
    }
  }, 60_000);

  it('reloads from nothing and places every spawn on open ground inside the walls', async () => {
    const logger = createLogger('silent', false), registry = createDefaultRegistry();
    const world = new WorldService({ seed: normalizeSeed(INFECTION_MAP.seed), sizeChunks: INFECTION_MAP.sizeChunks, generatorVersion: GENERATOR_VERSION, seaLevel: 20, mode: 'infection' }, registry, 0, 512, logger);
    const repository = { load: vi.fn(), saveMany: vi.fn(), loadChest: vi.fn(), saveChestAndPlayer: vi.fn() };
    const game = new GameServer({ mode: 'infection', world, registry, config: { DAY_LENGTH_MINUTES: 25 } as AppConfig, logger, metrics: new Metrics(), audit: { record: vi.fn() } as unknown as AuditLog, playerStates: repository as unknown as PlayerStateRepository, worlds: {} as WorldRepository, worldId: INFECTION_MAP.id, initialWorldTimeMs: 0 });
    const harness = game as unknown as Harness;
    const a = { id: 1, open: true, buffered: 0, state: 'joining', account: { accountId: '1', username: 'A' }, sendJson: vi.fn(), sendText: vi.fn(), sendBinary: vi.fn(() => true), sendError: vi.fn(), close: vi.fn() } as unknown as ClientSession;
    try {
      await world.start();
      await game.join(a);
      const p = a.player!;
      for (let cx = 3; cx <= 12; cx++) for (let cz = 3; cz <= 12; cz += 3) await harness.physics.ensureArea(cx, cz, 1);
      const open = friday13Spawns().filter((s) => (game as unknown as { spawns: { validateAt(x: number, z: number): unknown } }).spawns.validateAt(s.x, s.z));
      expect(open.length).toBeGreaterThan(friday13Spawns().length * .8);
      const gun = p.inv.equippedItem()!;
      expect(gun.itemId).toBe('ak47');
      gun.mag = 0;
      harness.onReload(p);
      expect(p.reloadAt).toBeGreaterThan(0);
      harness.activeScratch.length = 0; harness.activeScratch.push(p);
      harness.stepReloads(p.reloadAt + 1);
      expect(gun.mag).toBe(30);

      // A whole round with bots: the room fills, the outbreak spreads, nothing throws.
      const m = harness.infection;
      let infected = 0;
      for (let t = 0; t < (INFECTION.countdownMs + INFECTION.outbreakMs + 60_000) / 50; t++) {
        harness.tick++;
        harness.stepInfection(t * 50);
        if (m.phase === 'running') infected = Math.max(infected, m.zombies.size);
      }
      expect(m.entrants.size).toBe(INFECTION_MAP.botFill);
      expect(infected).toBeGreaterThan(1);
    } finally {
      await game.stop();
      await world.close();
    }
  }, 60_000);
});
