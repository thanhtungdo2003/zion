import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { VoiceServerMessage } from '@zion/shared';
import { VoiceHub, turnCredentials } from './voice';

const logger = { child: () => logger, debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined } as never;

let server: Server | null = null;
let hub: VoiceHub | null = null;
afterEach(() => { hub?.stop(); server?.close(); server = hub = null; });

/** A hub on a random port; tickets are "t-<account>", teams come from `team`. */
async function start(team: Record<string, string>): Promise<string> {
  hub = new VoiceHub({
    consumeTicket: async (t) => (t.startsWith('t-') ? { accountId: t.slice(2), name: t.slice(2).toUpperCase() } : null),
    teamOf: (kind, id) => (kind === 'waves' ? team[id] : undefined),
    ice: { stun: ['stun:example.org'], turn: ['turn:example.org:3478'], secret: 'a-very-long-shared-secret' },
  }, logger);
  server = createServer();
  server.on('upgrade', (req, socket, head) => hub!.upgrade(req, socket, head));
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
  return `ws://127.0.0.1:${(server.address() as AddressInfo).port}/voice`;
}

/** A client that collects what it is sent. */
async function client(url: string, account: string) {
  const ws = new WebSocket(url), got: VoiceServerMessage[] = [];
  ws.on('message', (d) => got.push(JSON.parse(d.toString()) as VoiceServerMessage));
  await new Promise((r) => ws.on('open', r));
  ws.send(JSON.stringify({ t: 'hello', ticket: `t-${account}`, kind: 'waves' }));
  const until = async (pred: (m: VoiceServerMessage) => boolean) => {
    for (let i = 0; i < 100; i++) { const m = got.find(pred); if (m) return m; await new Promise((r) => setTimeout(r, 10)); }
    throw new Error(`no message for ${account}`);
  };
  return { ws, got, until, send: (m: unknown) => ws.send(JSON.stringify(m)) };
}

describe('team voice hub', () => {
  it('introduces teammates, relays signals only inside the team and spreads who talks', async () => {
    const url = await start({ ann: 'A', bao: 'A', cy: 'B' });
    const ann = await client(url, 'ann');
    const welcome = await ann.until((m) => m.t === 'welcome') as Extract<VoiceServerMessage, { t: 'welcome' }>;
    expect(welcome.peers).toEqual([]);
    expect(welcome.ice[1]!.username).toMatch(/^\d+:ann$/);
    const bao = await client(url, 'bao');
    const w2 = await bao.until((m) => m.t === 'welcome') as Extract<VoiceServerMessage, { t: 'welcome' }>;
    expect(w2.peers.map((p) => p.id)).toEqual(['ann']);
    await ann.until((m) => m.t === 'join' && m.peer.id === 'bao');
    const cy = await client(url, 'cy');
    await cy.until((m) => m.t === 'welcome');
    expect(hub!.snapshot()).toEqual({ 'waves:A': ['ann', 'bao'], 'waves:B': ['cy'] });

    bao.send({ t: 'signal', to: 'ann', data: { kind: 'offer', sdp: 'v=0' } });
    cy.send({ t: 'signal', to: 'ann', data: { kind: 'offer', sdp: 'evil' } });
    await ann.until((m) => m.t === 'signal' && m.from === 'bao');
    bao.send({ t: 'speaking', on: true });
    await ann.until((m) => m.t === 'speaking' && m.id === 'bao' && m.on);
    await new Promise((r) => setTimeout(r, 50));
    expect(ann.got.some((m) => m.t === 'signal' && m.from === 'cy')).toBe(false);
    expect(cy.got.some((m) => m.t === 'speaking')).toBe(false);

    bao.ws.close();
    await ann.until((m) => m.t === 'leave' && m.id === 'bao');
    ann.ws.close(); cy.ws.close();
  });

  it('refuses a bad ticket and a player with no team', async () => {
    const url = await start({ ann: 'A' });
    const nobody = await client(url, 'zed');
    expect(await nobody.until((m) => m.t === 'error')).toMatchObject({ code: 'no_team' });
    const ws = new WebSocket(url), got: VoiceServerMessage[] = [];
    ws.on('message', (d) => got.push(JSON.parse(d.toString()) as VoiceServerMessage));
    await new Promise((r) => ws.on('open', r));
    ws.send(JSON.stringify({ t: 'hello', ticket: 'forged', kind: 'waves' }));
    await new Promise((r) => ws.on('close', r));
    expect(got[0]).toMatchObject({ t: 'error', code: 'auth' });
  });

  it('signs TURN credentials the way coturn checks them', () => {
    const c = turnCredentials('secret-secret-secret', 'acc', 1_000_000);
    expect(c.username).toBe(`${1000 + 12 * 3600}:acc`);
    expect(c.credential).toBe(createHmac('sha1', 'secret-secret-secret').update(c.username).digest('base64'));
  });
});
