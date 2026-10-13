import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_BASE_LIFE, type ClientMessage } from '@zion/shared';
import { BaseLife, type LifeWorld } from './base-life';
import { GameServer } from './game-server';
import { Player } from './player';
import type { ClientSession } from './session';

interface FarmingHarness {
  deps: object;
  log: object;
  players: Map<number, Player>;
  byAccount: Map<string, Player>;
  pendingSaves: Map<string, Promise<void>>;
  speechAt: Map<string, number>;
  grid: object;
  life: BaseLife;
  lifeWorld: LifeWorld;
  lifeBusy: boolean;
  plotLocks: Map<string, number>;
  sendLife: ReturnType<typeof vi.fn>;
  broadcastPlayerList: ReturnType<typeof vi.fn>;
  onLife(p: Player, msg: Extract<ClientMessage, { t: 'life' }>): Promise<void>;
  cancelLifeAction(p: Player, notify?: boolean): void;
  leave(session: ClientSession, reason: string): void;
}

function setup() {
  // Exercise the actual action and disconnect handlers without starting simulation or a database.
  const server = Object.create(GameServer.prototype) as FarmingHarness;
  const life = new BaseLife(structuredClone(DEFAULT_BASE_LIFE));
  const camp = { x: 100, y: 10, z: 100 }, plot = life.config.plots[0]!;
  const saveMany = vi.fn(async () => {});
  Object.assign(server, {
    deps: { world: { generator: { camp } }, playerStates: { saveMany }, metrics: { players: 0 } },
    log: { info: vi.fn(), error: vi.fn() },
    players: new Map(), byAccount: new Map(), pendingSaves: new Map(), speechAt: new Map(), requisitionRetries: new Map(),
    grid: { remove: vi.fn() }, life, lifeWorld: { plots: {}, nextGrowth: 0 }, lifeBusy: false,
    zombies: { suspend: vi.fn(() => []) },
    vehicles: { release: vi.fn() },
    plotLocks: new Map(), sendLife: vi.fn(), broadcastPlayerList: vi.fn(),
  });
  const connect = (id: number) => {
    const session = { open: true, sendJson: vi.fn(), player: null } as unknown as ClientSession;
    const p = new Player(id, 'account', 'Farmer', session, camp.x + plot.x, camp.y, camp.z + plot.z);
    p.life = life.initial(); p.active = true; p.inv.add('potato');
    session.player = p;
    server.players.set(p.id, p); server.byAccount.set(p.accountId, p);
    return p;
  };
  return { server, plot, connect, saveMany };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe('farming after page reload', () => {
  it.each(['plant', 'harvest'] as const)('releases an interrupted %s so the reconnected player can use the same plot', async (op) => {
    const { server, plot, connect, saveMany } = setup();
    if (op === 'harvest') server.lifeWorld.plots[plot.id] = { crop: 'potato', stage: 2 };
    const original = connect(1), before = original.inv.countOf('potato');
    const action = { t: 'life', op, target: plot.id, choice: 'potato' } as const;
    await server.onLife(original, action);
    expect(original.lifeAction?.kind).toBe(op);
    expect(server.plotLocks.get(plot.id)).toBe(original.id);
    server.leave(original.session, 'socket_close');
    expect(original.lifeAction).toBeNull(); expect(server.plotLocks.has(plot.id)).toBe(false);
    expect(original.inv.countOf('potato')).toBe(before);
    expect(server.lifeWorld.plots[plot.id]).toEqual(op === 'harvest' ? { crop: 'potato', stage: 2 } : undefined);
    expect(saveMany).toHaveBeenCalledTimes(1);
    await server.pendingSaves.get(original.accountId);
    const reconnected = connect(2);
    await server.onLife(reconnected, action);
    expect(reconnected.lifeAction?.kind).toBe(op);
    expect(server.plotLocks.get(plot.id)).toBe(reconnected.id);
    // A late close from the old socket must not unlock the new session's action.
    server.leave(original.session, 'late_close');
    expect(server.plotLocks.get(plot.id)).toBe(reconnected.id);
  });

  it('keeps an actively used plot locked for other players', async () => {
    const { server, plot, connect } = setup();
    server.lifeWorld.plots[plot.id] = { crop: 'potato', stage: 2 };
    const a = connect(1), b = connect(2);
    const action = { t: 'life', op: 'harvest', target: plot.id } as const;
    await server.onLife(a, action); await server.onLife(b, action);
    expect(b.lifeAction).toBeNull(); expect(server.plotLocks.get(plot.id)).toBe(a.id);
    server.leave(a.session, 'reload'); await server.onLife(b, action);
    expect(b.lifeAction?.kind).toBe('harvest'); expect(server.plotLocks.get(plot.id)).toBe(b.id);
  });
});
