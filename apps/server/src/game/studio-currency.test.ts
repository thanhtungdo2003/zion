import { describe, expect, it, vi } from 'vitest';
import { GameServer } from './game-server';
import { Player } from './player';
import { ProgressionService } from './progression';
import type { PlayerStateRecord } from '../repositories/player-states';
import type { Db } from '../db/pool';
import type { ClientSession } from './session';

const grant = { requestId: '11111111-1111-4111-8111-111111111111', accountId: '22222222-2222-4222-8222-222222222222', amount: 500, reason: 'Event' };

describe('durable Studio credits', () => {
  it('records a repeated request only once and refuses to reuse its ID with another recipient or amount', async () => {
    const receipts = new Map<string, { account_id: string; world_id: string; reward: Record<string, unknown> }>();
    const query = vi.fn(async (sql: string, params: unknown[] = []) => {
      const id = String(params[0]);
      if (sql.startsWith('INSERT INTO survival_requisitions') && !receipts.has(id)) {
        receipts.set(id, { account_id: String(params[1]), world_id: String(params[2]), reward: JSON.parse(String(params[3])) as Record<string, unknown> });
        return { rows: [{ id }] };
      }
      if (sql.startsWith('SELECT account_id')) return { rows: receipts.has(id) ? [receipts.get(id)] : [] };
      return { rows: [] };
    });
    const service = new ProgressionService({ query } as unknown as Db, 'survival');
    expect(await service.grantCoins(grant, null)).toBe(true);
    expect(await service.grantCoins(grant, null)).toBe(false);
    expect(receipts.size).toBe(1);
    await expect(service.grantCoins({ ...grant, amount: 600 }, null)).rejects.toMatchObject({ statusCode: 409 });
    await expect(service.grantCoins({ ...grant, accountId: '33333333-3333-4333-8333-333333333333' }, null)).rejects.toMatchObject({ statusCode: 409 });
    await expect(service.grantCoins(grant, 'another-operator')).rejects.toMatchObject({ statusCode: 409 });
    expect(receipts.size).toBe(1);
  });

  it('does not acknowledge a credit for a nonexistent account', async () => {
    const service = new ProgressionService({ query: vi.fn(async () => ({ rows: [] })) } as unknown as Db, 'survival');
    await expect(service.grantCoins(grant, null)).rejects.toMatchObject({ statusCode: 404 });
  });
});

function game() {
  const session = { open: true, sendJson: vi.fn() } as unknown as ClientSession;
  const player = new Player(1, grant.accountId, 'Survivor', session, 10, 1, 10);
  player.active = true; player.coins = 100;
  const saveMany = vi.fn(async () => {});
  const deliver = vi.fn(async (state: PlayerStateRecord) => ({ ...state, coins: state.coins! + 500 }));
  const server = Object.create(GameServer.prototype) as { receiveStudioCurrency(accountId: string): Promise<void> };
  const retries = new Map<string, number>();
  Object.assign(server, { byAccount: new Map([[player.accountId, player]]), joiningAccounts: new Set(), requisitionRetries: retries,
    deps: { playerStates: { deliverRequisitions: deliver, saveMany } }, reply: vi.fn(), log: { error: vi.fn() } });
  return { server, player, retries, deliver, saveMany };
}

describe('Studio credits during gameplay', () => {
  it('defers delivery while a quest or trade is mutating the wallet', async () => {
    const { server, player, retries, deliver } = game();
    player.questBusy = true;
    await server.receiveStudioCurrency(player.accountId);
    expect(deliver).not.toHaveBeenCalled(); expect(player.coins).toBe(100);
    expect(retries.has(player.accountId)).toBe(true);
    player.questBusy = false; player.coins = 200;
    await server.receiveStudioCurrency(player.accountId);
    expect(player.coins).toBe(700);
    expect(deliver).toHaveBeenCalledWith(expect.objectContaining({ coins: 200 }), true);
    expect(player.session.sendJson).toHaveBeenCalledWith({ t: 'wallet', coins: 700 });
    expect(retries.has(player.accountId)).toBe(false);
  });

  it('saves the granted balance again if the player disconnects while it is being delivered', async () => {
    const { server, player, deliver, saveMany } = game();
    let finish!: () => void;
    deliver.mockImplementation((state) => new Promise((resolve) => { finish = () => resolve({ ...state, coins: 600 }); }));
    const pending = server.receiveStudioCurrency(player.accountId);
    expect(player.questBusy).toBe(true);
    let leaveFinished = false;
    player.onLeaveSaved = () => { leaveFinished = true; };
    finish();
    await pending;
    await Promise.resolve();
    expect(saveMany).toHaveBeenCalledWith([expect.objectContaining({ coins: 600 })]);
    expect(player.questBusy).toBe(false);
    // The promise tracked by reconnect is released only after the final save.
    await vi.waitFor(() => expect(leaveFinished).toBe(true));
  });
});
