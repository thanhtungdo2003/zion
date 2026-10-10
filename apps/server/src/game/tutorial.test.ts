import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseClientMessage } from '@zion/shared';
import { BaseLife } from './base-life';
import { DEFAULT_BASE_LIFE } from '@zion/shared';
import { Player } from './player';
import type { ClientSession } from './session';
import { GameServer } from './game-server';
import type { Zombie } from './zombies';
import { recordZombieKill, tutorialProgress, tutorialProtected, updateTutorial } from './tutorial';

function player() {
  const p = new Player(1, 'account', 'Newcomer', { sendJson: vi.fn() } as unknown as ClientSession, 100, 0, 100);
  p.life = new BaseLife(DEFAULT_BASE_LIFE).initial();
  return p;
}
afterEach(() => vi.restoreAllMocks());

describe('first-time guide protection', () => {
  it('ends immediately on close and cannot be granted again after replay or reconnect', () => {
    const p = player();
    updateTutorial(p, { t: 'tutorial', op: 'open', id: 'chest' }, 0);
    expect(tutorialProtected(p, 10)).toBe(true);
    updateTutorial(p, { t: 'tutorial', op: 'close' }, 20);
    expect(tutorialProtected(p, 20)).toBe(false);
    updateTutorial(p, { t: 'tutorial', op: 'open', id: 'chest' }, 30);
    expect(tutorialProtected(p, 30)).toBe(false);
    const reload = player(); reload.life = structuredClone(p.life);
    updateTutorial(reload, { t: 'tutorial', op: 'open', id: 'chest' }, 40);
    expect(tutorialProtected(reload, 40)).toBe(false);
    updateTutorial(reload, { t: 'tutorial', op: 'open', id: 'intro', replay: true }, 50);
    expect(tutorialProtected(reload, 50)).toBe(false);
    updateTutorial(reload, { t: 'tutorial', op: 'open', id: 'nurse' }, 60);
    expect(tutorialProtected(reload, 60)).toBe(true);
  });
  it('renews only an active first viewing and expires if the client stops responding', () => {
    const p = player();
    updateTutorial(p, { t: 'tutorial', op: 'heartbeat' }, 0);
    expect(tutorialProtected(p, 0)).toBe(false);
    updateTutorial(p, { t: 'tutorial', op: 'open', id: 'intro' }, 0);
    updateTutorial(p, { t: 'tutorial', op: 'heartbeat' }, 20_000);
    expect(tutorialProtected(p, 35_000)).toBe(true);
    expect(tutorialProtected(p, 50_000)).toBe(false);
    updateTutorial(p, { t: 'tutorial', op: 'heartbeat' }, 50_001);
    expect(tutorialProtected(p, 50_001)).toBe(false);
  });
  it('blocks actual damage before health, armor wear or deferred damage while a guide is open', () => {
    const server = Object.create(GameServer.prototype) as { damage(attacker: null, p: Player, amount: number, zone: string, x: number, y: number, z: number, now: number): void };
    Object.assign(server, { epoch: 0, players: new Map(), broadcastNear: vi.fn() });
    const p = player(), now = performance.now();
    updateTutorial(p, { t: 'tutorial', op: 'open', id: 'chest' }, now);
    p.questBusy = true;
    const wear = vi.spyOn(p.inv, 'wearArmor');
    server.damage(null, p, 25, 'bite', 0, 0, 0, now);
    expect(p.health).toBe(100); expect(p.afterQuest).toHaveLength(0); expect(wear).not.toHaveBeenCalled();
    updateTutorial(p, { t: 'tutorial', op: 'close' }, now);
    p.questBusy = false;
    server.damage(null, p, 25, 'bite', 0, 0, 0, now);
    expect(p.health).toBe(75);
  });
  it('rejects unknown guide identifiers at the protocol boundary', () => {
    expect(parseClientMessage(JSON.stringify({ t: 'tutorial', op: 'open', id: 'godmode' })).ok).toBe(false);
    expect(parseClientMessage(JSON.stringify({ t: 'tutorial', op: 'open', id: 'chest' })).ok).toBe(true);
  });
});

describe('first zombie reward', () => {
  it('records the first kill once, surviving reconnect without giving another guaranteed drop', () => {
    const p = player(); expect(recordZombieKill(p)).toBe(true);
    const reload = player(); reload.life = structuredClone(p.life);
    expect(recordZombieKill(reload)).toBe(false);
    expect(tutorialProgress(reload).firstZombie).toBe(true);
  });
  it('guarantees the first drop through the real kill handler even when the random roll would fail', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const dropCoin = vi.fn();
    const server = Object.create(GameServer.prototype) as { hitZombie(p: Player, z: Zombie, amount: number, zone: string, x: number, y: number, zpos: number, dx: number, dz: number, impulse: number, now: number): void };
    Object.assign(server, { zombies: { hit: () => ({ killed: true }) }, deps: {}, broadcastAt: vi.fn(), queueQuestEvent: vi.fn(), dropCoin });
    const p = player(), zombie = { id: 123, state: { x: 10, y: 0, z: 20 } } as Zombie;
    server.hitZombie(p, zombie, 100, 'torso', 10, 0, 20, 0, 1, 0, 100);
    expect(dropCoin).toHaveBeenCalledTimes(1);
    expect(dropCoin).toHaveBeenCalledWith(10, 0, 20, 100);
    server.hitZombie(p, zombie, 100, 'torso', 10, 0, 20, 0, 1, 0, 200);
    expect(dropCoin).toHaveBeenCalledTimes(1);
    expect(p.session.sendJson).toHaveBeenCalledWith({ t: 'tutorialState', seen: [], firstZombie: true });
  });
});
