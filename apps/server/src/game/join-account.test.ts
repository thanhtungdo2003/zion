import { describe, expect, it, vi } from 'vitest';
import { GameServer } from './game-server';
import { CloseCode, type ClientSession } from './session';

function session(accountId: string): ClientSession {
  return { account: { accountId }, sendError: vi.fn(), close: vi.fn() } as unknown as ClientSession;
}

function setup(joinAccount: (client: ClientSession) => Promise<void>) {
  const server = Object.create(GameServer.prototype) as {
    join(client: ClientSession): Promise<void>;
  };
  Object.assign(server, { joiningAccounts: new Set(), players: new Map(), joinAccount });
  return server;
}

describe('account state and Quân nhu on concurrent login', () => {
  it('rejects a second socket before it can load a stale wallet or consume deliveries', async () => {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    const loadAndDeliver = vi.fn(() => pending);
    const server = setup(loadAndDeliver), first = session('same'), duplicate = session('same');
    const joined = server.join(first);
    await server.join(duplicate);
    expect(duplicate.close).toHaveBeenCalledWith(CloseCode.DuplicateSession, 'duplicate session');
    expect(loadAndDeliver).toHaveBeenCalledTimes(1);
    // Another account can still join while the first is loading.
    const other = server.join(session('other'));
    expect(loadAndDeliver).toHaveBeenCalledTimes(2);
    finish();
    await Promise.all([joined, other]);
  });

  it('allows a retry after loading fails', async () => {
    const loadAndDeliver = vi.fn().mockRejectedValueOnce(new Error('database unavailable')).mockResolvedValue(undefined);
    const server = setup(loadAndDeliver);
    await expect(server.join(session('same'))).rejects.toThrow('database unavailable');
    const retry = session('same');
    await server.join(retry);
    expect(retry.close).not.toHaveBeenCalled();
    expect(loadAndDeliver).toHaveBeenCalledTimes(2);
  });
});
