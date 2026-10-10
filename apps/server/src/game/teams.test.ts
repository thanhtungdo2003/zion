import { afterEach, describe, expect, it, vi } from 'vitest';
import { TEAM_QUESTS, type TeamRecord } from '@zion/shared';
import { TeamService } from './teams';
import type { PlayerStateRecord } from '../repositories/player-states';

afterEach(() => vi.useRealTimers());
const target = { x: 100, z: 200, radius: 10 };
const position = (x = target.x, z = target.z) => ({ entityId: 1, x, y: 0, z, health: 100, downed: false });
const wallet = (accountId: string): PlayerStateRecord => ({ accountId, x: 0, y: 0, z: 0, yaw: 0, health: 100, coins: 10 });
async function setup(publicTeam = true) {
  const persist = vi.fn(async (_id: string, _team: TeamRecord | null, _player?: PlayerStateRecord) => {});
  const service = new TeamService([], persist);
  const lobby = await service.action('a', 'Alpha', { op: 'create', name: 'Survivors', public: publicTeam });
  const code = lobby.team!.code;
  await service.action('b', 'Bravo', { op: 'join', code });
  return { service, persist, code };
}
async function reachKillStage(service: TeamService, quest = TEAM_QUESTS[0]) {
  await service.quest('a', quest.id, 'accept', { target, x: 0, z: 0 });
  service.position('a', position()); service.position('b', position());
  await service.progress('a');
  for (let i = 0; i < quest.count; i++) {
    const drop = service.forAccount('a')!.quests[quest.id]!.drops[0]!;
    await service.quest('a', quest.id, 'retrieve', { index: 0, ...drop });
  }
}

describe('persistent team membership and lobby', () => {
  it('serializes concurrent joins to enforce five members and one team per account', async () => {
    const { service, code } = await setup();
    const results = await Promise.allSettled(['c', 'd', 'e', 'f', 'g'].map((id) => service.action(id, id, { op: 'join', code })));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
    expect(service.view('a')!.members).toHaveLength(5);
    await expect(service.action('a', 'Alpha', { op: 'create', name: 'Another', public: true })).rejects.toMatchObject({ status: 409 });
  });

  it('keeps private teams and their chat out of outsider lobby responses', async () => {
    const { service } = await setup(false);
    await service.action('a', 'Alpha', { op: 'chat', text: 'private location' });
    expect(service.lobby('outsider')).toEqual({ team: null, available: [] });
    expect(service.view('b')!.chat[0]!.text).toBe('private location');
    await expect(service.action('outsider', 'Outsider', { op: 'joinPublic', id: service.view('a')!.id })).rejects.toMatchObject({ status: 404 });
  });

  it('requires leader authority, transfers leadership on leave and deletes an empty team', async () => {
    const { service, persist } = await setup();
    await expect(service.action('b', 'Bravo', { op: 'kick', accountId: 'a' })).rejects.toMatchObject({ status: 403 });
    await service.action('a', 'Alpha', { op: 'leave' });
    expect(service.view('b')!.leaderId).toBe('b');
    expect(service.allied('a', 'b')).toBe(false);
    await service.action('b', 'Bravo', { op: 'leave' });
    expect(service.view('b')).toBeNull();
    expect(persist).toHaveBeenLastCalledWith(expect.any(String), null, undefined);
  });

  it('launches only when everyone is online and ready and resets on roster changes', async () => {
    vi.useFakeTimers();
    const { service, code } = await setup();
    await expect(service.action('a', 'Alpha', { op: 'launch' })).rejects.toMatchObject({ status: 409 });
    await service.action('a', 'Alpha', { op: 'ready', ready: true });
    await service.action('b', 'Bravo', { op: 'ready', ready: true });
    vi.advanceTimersByTime(16_000);
    await expect(service.action('a', 'Alpha', { op: 'launch' })).rejects.toMatchObject({ status: 409 });
    service.heartbeat('a'); service.heartbeat('b');
    const launched = await service.action('a', 'Alpha', { op: 'launch' });
    expect(launched.team!.launchId).toBeTruthy();
    expect(launched.team!.members.every((m) => !m.ready)).toBe(true);
    await service.action('c', 'Charlie', { op: 'join', code });
    expect(service.view('a')!.launchId).toBeNull();
  });

  it('publishes changes only after persistence succeeds and resumes after failure', async () => {
    const { service, persist } = await setup();
    persist.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(service.action('b', 'Bravo', { op: 'leave' })).rejects.toThrow('database unavailable');
    expect(service.allied('a', 'b')).toBe(true);
    await service.action('b', 'Bravo', { op: 'leave' });
    expect(service.allied('a', 'b')).toBe(false);
  });
});

describe('cooperative mission authority and rewards', () => {
  it('requires two living participants, validates retrieval range and shares progress', async () => {
    const { service } = await setup();
    const quest = TEAM_QUESTS[0];
    await expect(service.quest('b', quest.id, 'accept', { target, x: 0, z: 0 })).rejects.toMatchObject({ status: 403 });
    await service.quest('a', quest.id, 'accept', { target, x: 0, z: 0 });
    service.position('a', position()); service.position('b', { ...position(), downed: true });
    await service.progress('a');
    expect(service.forAccount('a')!.quests[quest.id]!.stage).toBe(0);
    service.position('b', position()); await service.progress('b');
    expect(service.questViews('a')[0]!.stage).toBe(1);
    expect(await service.quest('b', quest.id, 'retrieve', { index: 0, x: 0, z: 0 })).toBe(false);
    const drop = service.forAccount('a')!.quests[quest.id]!.drops[0]!;
    await service.quest('b', quest.id, 'retrieve', { index: 0, ...drop });
    expect(service.questViews('a')[0]!.progress).toBe(1);
    expect(service.questViews('b')[0]!.drops).toHaveLength(quest.count - 1);
  });

  it('counts kills only within the assigned objective and pays each participant once', async () => {
    const { service, persist } = await setup();
    const quest = TEAM_QUESTS[0];
    await reachKillStage(service);
    await service.progress('a', { x: 999, z: 999 });
    expect(service.questViews('a')[0]!.progress).toBe(0);
    for (let i = 0; i < quest.kills; i++) await service.progress(i % 2 ? 'a' : 'b', target);
    expect(service.questViews('b')[0]!.status).toBe('ready');
    const claims = await Promise.all([0, 1].map(() => service.quest('a', quest.id, 'turnin', { x: 0, z: 0, reward: () => wallet('a') })));
    expect(claims).toEqual([true, false]);
    expect(service.questViews('a')[0]!.status).toBe('claimed');
    expect(service.questViews('b')[0]!.status).toBe('ready');
    await service.quest('b', quest.id, 'turnin', { x: 0, z: 0, reward: () => wallet('b') });
    expect(persist.mock.calls.filter((call) => call[2]).map((call) => call[2]!.coins)).toEqual([10 + quest.coins, 10 + quest.coins]);
  });

  it('does not grant late joiners objectives or rewards', async () => {
    const { service, code } = await setup();
    await reachKillStage(service);
    await service.action('c', 'Charlie', { op: 'join', code });
    expect(service.questViews('c')[0]).toMatchObject({ locked: true });
    expect(service.questViews('c')[0]!.target).toBeUndefined();
    await expect(service.quest('c', TEAM_QUESTS[0].id, 'turnin', { x: 0, z: 0, reward: () => wallet('c') })).rejects.toMatchObject({ status: 403 });
  });

  it('rolls back failed reward claims and preserves missions across restart and UTC reset', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-10T23:59:00Z'));
    const { service, persist } = await setup();
    await reachKillStage(service);
    for (let i = 0; i < TEAM_QUESTS[0].kills; i++) await service.progress('a', target);
    persist.mockRejectedValueOnce(new Error('transaction failed'));
    await expect(service.quest('a', TEAM_QUESTS[0].id, 'turnin', { x: 0, z: 0, reward: () => wallet('a') })).rejects.toThrow('transaction failed');
    expect(service.questViews('a')[0]!.status).toBe('ready');
    await service.quest('a', TEAM_QUESTS[1].id, 'accept', { target, x: 0, z: 0 });
    const reloaded = new TeamService([structuredClone(service.forAccount('a')!)], persist);
    expect(reloaded.questViews('b')[0]!.status).toBe('ready');
    vi.advanceTimersByTime(61_000);
    expect(reloaded.questViews('a')[0]!.status).toBe('available');
    expect(reloaded.questViews('a')[1]!.status).toBe('active');
  });
});
