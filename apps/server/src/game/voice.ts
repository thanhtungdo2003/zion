import { createHmac } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import { VOICE_MAX_MESSAGE, parseVoiceClientMessage, type VoiceIceServer, type VoiceKind, type VoicePeer, type VoiceServerMessage } from '@zion/shared';
import type { Logger } from '../logger';

/** What the hub needs: tickets (the game's one-use join tickets) and each kind's team of an account. */
export interface VoiceDeps {
  consumeTicket(ticket: string): Promise<{ accountId: string; name: string } | null>;
  teamOf(kind: VoiceKind, accountId: string): string | undefined;
  ice: { stun: string[]; turn?: string[]; secret?: string };
}

interface Member { ws: WebSocket; id: string; name: string; room: string | null; kind: VoiceKind | null; speaking: boolean; muted: boolean; alive: boolean; budget: number }

/** A team's voice room never holds more than this (teams are at most four). */
const ROOM_LIMIT = 6;
/** Messages a member may send per second (offers, candidates, speaking flips). */
const MESSAGES_PER_SECOND = 40;
/** TURN credentials last this long; a reconnect fetches fresh ones. */
const TURN_TTL_S = 12 * 3600;

/** TURN REST credentials (coturn `use-auth-secret`): a time-limited username signed with the shared secret. */
export function turnCredentials(secret: string, accountId: string, now = Date.now()): { username: string; credential: string } {
  const username = `${Math.floor(now / 1000) + TURN_TTL_S}:${accountId}`;
  return { username, credential: createHmac('sha1', secret).update(username).digest('base64') };
}

/**
 * Team voice rooms: authenticates with a game ticket, puts the socket in its team's room, relays
 * WebRTC offers/answers/candidates between members of the same room only, and spreads who is
 * talking. Membership is re-checked every few seconds: leaving the team leaves its voice room.
 */
export class VoiceHub {
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: VOICE_MAX_MESSAGE, perMessageDeflate: false, clientTracking: false });
  private readonly rooms = new Map<string, Map<string, Member>>();
  private readonly members = new Set<Member>();
  private timer: NodeJS.Timeout | null = null;
  private readonly log: Logger;

  constructor(private readonly deps: VoiceDeps, logger: Logger) {
    this.log = logger.child({ module: 'voice' });
  }

  start(): void {
    this.timer = setInterval(() => this.tick(), 3000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    for (const m of this.members) m.ws.terminate();
  }

  get connectionCount(): number { return this.members.size; }

  upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    this.wss.handleUpgrade(req, socket, head, (ws) => this.onConnection(ws));
  }

  private onConnection(ws: WebSocket): void {
    const m: Member = { ws, id: '', name: '', room: null, kind: null, speaking: false, muted: false, alive: true, budget: MESSAGES_PER_SECOND * 3 };
    this.members.add(m);
    // Say hello within ten seconds or go.
    const hello = setTimeout(() => { if (!m.room) ws.close(4401, 'no hello'); }, 10_000);
    ws.on('pong', () => { m.alive = true; });
    ws.on('message', (raw: RawData, binary: boolean) => { if (!binary) void this.onMessage(m, raw.toString()); });
    ws.on('close', () => { clearTimeout(hello); this.drop(m); });
    ws.on('error', () => ws.terminate());
  }

  private send(m: Member, msg: VoiceServerMessage): void {
    if (m.ws.readyState === m.ws.OPEN) m.ws.send(JSON.stringify(msg));
  }

  private fail(m: Member, code: Extract<VoiceServerMessage, { t: 'error' }>['code'], message: string): void {
    this.send(m, { t: 'error', code, message });
    m.ws.close(4400, code);
  }

  private peer(m: Member): VoicePeer { return { id: m.id, name: m.name, speaking: m.speaking, muted: m.muted }; }

  private others(m: Member): Member[] {
    return m.room ? [...(this.rooms.get(m.room)?.values() ?? [])].filter((o) => o !== m) : [];
  }

  private ice(accountId: string): VoiceIceServer[] {
    const { stun, turn, secret } = this.deps.ice;
    const out: VoiceIceServer[] = stun.length ? [{ urls: stun }] : [];
    if (turn?.length && secret) out.push({ urls: turn, ...turnCredentials(secret, accountId) });
    return out;
  }

  private async onMessage(m: Member, raw: string): Promise<void> {
    if (--m.budget < 0) return this.fail(m, 'bad_message', 'too many messages');
    const msg = parseVoiceClientMessage(raw);
    if (!msg) return this.fail(m, 'bad_message', 'bad message');
    if (msg.t === 'hello') {
      if (m.id) return;
      m.id = 'pending';
      const account = await this.deps.consumeTicket(msg.ticket).catch(() => null);
      if (!account) return this.fail(m, 'auth', 'invalid or expired ticket');
      if (m.ws.readyState !== m.ws.OPEN) return;
      const team = this.deps.teamOf(msg.kind, account.accountId);
      if (!team) return this.fail(m, 'no_team', 'not in a team');
      const room = `${msg.kind}:${team}`;
      const members = this.rooms.get(room) ?? new Map<string, Member>();
      // The same account again (a second tab, a reconnect): the newest socket wins.
      const old = members.get(account.accountId);
      if (old) { old.ws.close(4409, 'replaced'); this.drop(old); }
      if (members.size >= ROOM_LIMIT) return this.fail(m, 'full', 'voice room full');
      Object.assign(m, { id: account.accountId, name: account.name, room, kind: msg.kind });
      this.rooms.set(room, members);
      this.send(m, { t: 'welcome', self: m.id, team, peers: [...members.values()].map((o) => this.peer(o)), ice: this.ice(m.id) });
      for (const o of members.values()) this.send(o, { t: 'join', peer: this.peer(m) });
      members.set(m.id, m);
      this.log.debug({ room, id: m.id, size: members.size }, 'voice join');
      return;
    }
    if (!m.room) return;
    if (msg.t === 'signal') {
      const to = this.rooms.get(m.room)?.get(msg.to);
      if (to && to !== m) this.send(to, { t: 'signal', from: m.id, data: msg.data });
    } else if (msg.t === 'speaking' || msg.t === 'muted') {
      if (msg.t === 'speaking') { if (m.speaking === msg.on) return; m.speaking = msg.on; }
      else { if (m.muted === msg.on) return; m.muted = msg.on; if (msg.on) m.speaking = false; }
      for (const o of this.others(m)) this.send(o, { t: msg.t, id: m.id, on: msg.on });
    }
  }

  private drop(m: Member): void {
    if (!this.members.delete(m)) return;
    if (!m.room) return;
    const members = this.rooms.get(m.room);
    if (members?.get(m.id) === m) {
      members.delete(m.id);
      for (const o of members.values()) this.send(o, { t: 'leave', id: m.id });
      if (!members.size) this.rooms.delete(m.room);
    }
    m.room = null;
  }

  private tick(): void {
    for (const m of [...this.members]) {
      m.budget = MESSAGES_PER_SECOND * 3;
      if (!m.alive) { m.ws.terminate(); this.drop(m); continue; }
      m.alive = false;
      try { m.ws.ping(); } catch { m.ws.terminate(); }
      // Left (or was moved out of) the team: out of its voice room.
      if (m.room && m.kind && `${m.kind}:${this.deps.teamOf(m.kind, m.id)}` !== m.room) {
        this.fail(m, 'no_team', 'left the team');
        this.drop(m);
      }
    }
  }

  /** Test hook: rooms and their member ids. */
  snapshot(): Record<string, string[]> {
    return Object.fromEntries([...this.rooms].map(([k, v]) => [k, [...v.keys()]]));
  }
}
