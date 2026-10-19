import { describe, expect, it, vi } from 'vitest';
import { GameServer } from './game-server';
import { TeamService } from './teams';
import { Player } from './player';
import type { ClientSession } from './session';

// Exercise the real damage gates without starting the world simulation or database.
interface CombatHarness {
  deps: { teams: TeamService };
  players: Map<number, Player>;
  spawns: { inSafeZone: () => boolean };
  broadcastNear: ReturnType<typeof vi.fn>;
  broadcastPlayerList: ReturnType<typeof vi.fn>;
  handleMessage(session: ClientSession, message: { t: 'pvp'; enabled: boolean }): void;
  damage(attacker: number | null, target: Player, amount: number, zone: string, x: number, y: number, z: number, now: number): void;
  hitTarget(attacker: Player, target: Player, amount: number, zone: string, x: number, y: number, z: number, dx: number, dz: number, impulse: number, now: number): void;
  vegetation: { explode: () => void };
  vehicles: { blast: () => void; release: () => void };
  zombies: { near: () => never[]; alert: () => void };
  grid: { query: () => Player[] };
  explode(id: number, x: number, y: number, z: number, radius: number, damage: number, owner: Player | null, kind: 'grenade', now: number): void;
}
async function setup() {
  const teams = new TeamService([], async () => {});
  const team = await teams.action('a', 'Alpha', { op: 'create', name: 'Squad', public: true });
  await teams.action('b', 'Bravo', { op: 'join', code: team.team!.code });
  const session = { sendJson: vi.fn() } as unknown as ClientSession;
  const a = new Player(1, 'a', 'Alpha', session, 500, 0, 500);
  const b = new Player(2, 'b', 'Bravo', session, 501, 0, 500);
  const enemy = new Player(3, 'c', 'Enemy', session, 502, 0, 500);
  const server = Object.create(GameServer.prototype) as CombatHarness;
  server.vehicles = { blast: vi.fn(), release: vi.fn() };
  Object.assign(server, { shocks: [] });
  server.deps = { teams }; server.players = new Map([[1, a], [2, b], [3, enemy]]);
  server.spawns = { inSafeZone: () => false }; server.broadcastNear = vi.fn();
  server.broadcastPlayerList = vi.fn();
  Object.defineProperty(server, 'serverTime', { value: 100 });
  return { server, a, b, enemy };
}
describe('team friendly fire', () => {
  it.each(['torso', 'slash', 'blast', 'fire'])('ignores allied %s damage before armor, health or bleed changes', async (zone) => {
    const { server, a, b } = await setup();
    const wear = vi.spyOn(b.inv, 'wearArmor');
    server.damage(a.id, b, 30, zone, 0, 0, 0, 0);
    expect(b.health).toBe(100); expect(wear).not.toHaveBeenCalled();
    b.downed = true; b.bleed = 80;
    server.damage(a.id, b, 30, zone, 0, 0, 0, 0);
    expect(b.bleed).toBe(80); expect(server.broadcastNear).not.toHaveBeenCalled();
  });
  it('prevents allied melee knockback while allowing enemy and environmental damage', async () => {
    const { server, a, b, enemy } = await setup();
    enemy.pvpEnabled = true; enemy.pvpUntil = 60_000;
    server.hitTarget(a, b, 20, 'slash', 0, 0, 0, 1, 0, 8, 0);
    expect(b.health).toBe(100); expect(b.state.vx).toBe(0);
    server.damage(enemy.id, b, 20, 'torso', 0, 0, 0, 0);
    expect(b.health).toBe(80);
    server.damage(null, b, 10, 'fall', 0, 0, 0, 0);
    expect(b.health).toBe(70);
  });
  it('protects teammates from a grenade even if its owner disconnects before detonation', async () => {
    const { server, a, b } = await setup();
    server.players.delete(a.id);
    server.vegetation = { explode: vi.fn() };
    server.zombies = { near: () => [], alert: vi.fn() };
    server.grid = { query: () => [b] };
    server.explode(1, b.state.x, b.state.y, b.state.z, 10, 100, a, 'grenade', 0);
    expect(b.health).toBe(100);
  });
});

describe('opt-in player combat', () => {
  it.each(['torso', 'slash', 'blast', 'fire'])('allows a peaceful player to deal %s damage to an enemy with PvP enabled', async zone => {
    const { server, a, enemy } = await setup();
    enemy.pvpEnabled = true; enemy.pvpUntil = 60_000;
    server.hitTarget(a, enemy, 20, zone, 0, 0, 0, 1, 0, 8, 100);
    expect(enemy.health).toBe(80);
    expect(enemy.state.vx).toBe(6);
    expect(a.pvpEnabled).toBe(false);
    enemy.downed = true; enemy.bleed = 80;
    server.damage(a.id, enemy, 20, zone, 0, 0, 0, 200);
    expect(enemy.bleed).toBeLessThan(80);
  });
  it('still protects allies with PvP enabled and enemies whose PvP has expired', async () => {
    const { server, a, b, enemy } = await setup();
    b.pvpEnabled = enemy.pvpEnabled = true;
    b.pvpUntil = 60_000; enemy.pvpUntil = 50;
    for (const target of [b, enemy]) {
      server.hitTarget(a, target, 20, 'slash', 0, 0, 0, 1, 0, 8, 100);
      expect(target.health).toBe(100);
      expect(target.state.vx).toBe(0);
    }
  });
  it.each(['torso', 'slash', 'blast', 'fire'])('reveals control for a minute but blocks default %s damage, armor wear and bleed', async (zone) => {
    const { server, a, enemy } = await setup();
    const wear = vi.spyOn(enemy.inv, 'wearArmor');
    server.damage(a.id, enemy, 25, zone, 0, 0, 0, 100);
    expect(enemy.health).toBe(100); expect(wear).not.toHaveBeenCalled();
    expect(a.pvpUntil).toBe(60_100); expect(a.pvpEnabled).toBe(false);
    expect(a.session.sendJson).toHaveBeenCalledWith({ t: 'pvp', enabled: false, remainingMs: 60_000 });
    enemy.downed = true; enemy.bleed = 80;
    server.damage(a.id, enemy, 25, zone, 0, 0, 0, 200);
    expect(enemy.bleed).toBe(80); expect(a.pvpUntil).toBe(60_200);
    expect(server.broadcastNear).not.toHaveBeenCalled();
  });
  it('blocks knockback until enabled, allows enemies, still protects teammates and permits disabling', async () => {
    const { server, a, b, enemy } = await setup();
    server.hitTarget(a, enemy, 20, 'slash', 0, 0, 0, 1, 0, 8, 100);
    expect(enemy.state.vx).toBe(0);
    const session = { player: a } as ClientSession;
    server.handleMessage(session, { t: 'pvp', enabled: true });
    expect(a.pvpEnabled).toBe(true);
    server.hitTarget(a, enemy, 20, 'slash', 0, 0, 0, 1, 0, 8, 200);
    expect(enemy.health).toBe(80); expect(enemy.state.vx).toBe(6);
    server.damage(a.id, b, 20, 'fire', 0, 0, 0, 200);
    expect(b.health).toBe(100);
    server.handleMessage(session, { t: 'pvp', enabled: false });
    server.damage(a.id, enemy, 20, 'blast', 0, 0, 0, 300);
    expect(enemy.health).toBe(80);
  });
  it('rejects enabling before a hit or after expiry and never revives expired combat with another hit', async () => {
    const { server, a, enemy } = await setup();
    const session = { player: a } as ClientSession;
    server.handleMessage(session, { t: 'pvp', enabled: true });
    expect(a.pvpEnabled).toBe(false);
    a.pvpUntil = 50;
    server.handleMessage(session, { t: 'pvp', enabled: true });
    expect(a.pvpEnabled).toBe(false);
    a.pvpEnabled = true;
    server.damage(a.id, enemy, 20, 'torso', 0, 0, 0, 100);
    expect(enemy.health).toBe(100); expect(a.pvpEnabled).toBe(false);
    expect(a.pvpUntil).toBe(60_100);
  });
  it('protects players from explosions whose owner has disconnected', async () => {
    const { server, a, enemy } = await setup();
    server.players.delete(a.id);
    server.damage(a.id, enemy, 20, 'blast', 0, 0, 0, 100);
    expect(enemy.health).toBe(100);
    server.damage(null, enemy, 20, 'fall', 0, 0, 0, 100);
    expect(enemy.health).toBe(80);
  });
});
