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
  damage(attacker: number | null, target: Player, amount: number, zone: string, x: number, y: number, z: number, now: number): void;
  hitTarget(attacker: Player, target: Player, amount: number, zone: string, x: number, y: number, z: number, dx: number, dz: number, impulse: number, now: number): void;
  vegetation: { explode: () => void };
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
  server.deps = { teams }; server.players = new Map([[1, a], [2, b], [3, enemy]]);
  server.spawns = { inSafeZone: () => false }; server.broadcastNear = vi.fn();
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
