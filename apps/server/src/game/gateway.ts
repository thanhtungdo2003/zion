import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import { MAX_CLIENT_MESSAGE_BYTES, PROTOCOL_VERSION, VOICE_PATH, parseClientMessage } from '@zion/shared';
import type { AppConfig } from '../config';
import type { Logger } from '../logger';
import type { Metrics } from '../metrics';
import type { AuditLog } from '../repositories/audit';
import type { AuthService } from '../security/auth-service';
import { ConcurrencyCounter, KeyedWindowLimiter } from '../security/rate-limit';
import type { GameServer } from './game-server';
import type { MatchPool } from './match-pool';
import type { MatchSource } from './wave-rooms';
import type { VoiceHub } from './voice';
import { ClientSession, CloseCode } from './session';

const AUTH_TIMEOUT_MS = 5_000;
const HEARTBEAT_MS = 10_000;

/**
 * WebSocket edge: upgrade admission control (path, origin, global/per-IP connection caps, upgrade
 * rate), ticket authentication with timeout, heartbeat, per-message rate limiting, payload limits
 * and schema validation — before anything reaches the simulation.
 */
export class GameGateway {
  /** Pools of the published battle royale maps, by map id. */
  battleMaps: ((id: string) => MatchPool | undefined) | null = null;
  /** Pools of the Infection maps picked in the menu, by map id. */
  infectionMaps: ((id: string) => MatchPool | undefined) | null = null;
  /** Wave survival rooms: (map, party, bots) → where this connection plays, or null. */
  waves?: (mapId: string, party: boolean, bots: number) => MatchSource | null;
  /** Team voice rooms (`/voice`), when enabled. */
  voice: VoiceHub | null = null;
  private readonly wss: WebSocketServer;
  private readonly sessions = new Set<ClientSession>();
  private readonly sessionGames = new WeakMap<ClientSession, GameServer>();
  /** Match-mode sessions are assigned a match once authenticated (the squad is known then). */
  private readonly sessionPools = new WeakMap<ClientSession, MatchSource>();
  private readonly perIp = new ConcurrencyCounter();
  private readonly upgradeLimiter: KeyedWindowLimiter;
  private readonly allowedOrigins: Set<string>;
  private heartbeat: NodeJS.Timeout | null = null;
  private nextSessionId = 1;
  private accepting = true;
  private readonly log: Logger;

  constructor(
    private readonly config: AppConfig,
    logger: Logger,
    private readonly metrics: Metrics,
    private readonly auth: AuthService,
    private readonly game: GameServer,
    private readonly audit: AuditLog,
    /** Match modes: each "Play" is matched into one of many concurrent matches. */
    private readonly pools: { 'battle-royale'?: MatchPool; infection?: MatchPool } = {},
    /** Battle royale squad of an account (squadmates are matched into the same match). */
    private readonly squadOf: (accountId: string) => string | undefined = () => undefined,
  ) {
    this.log = logger.child({ module: 'gateway' });
    this.allowedOrigins = new Set(config.CORS_ORIGINS);
    this.upgradeLimiter = new KeyedWindowLimiter(config.WS_UPGRADES_PER_IP_PER_MIN, 60_000);
    this.wss = new WebSocketServer({
      noServer: true,
      maxPayload: MAX_CLIENT_MESSAGE_BYTES,
      perMessageDeflate: false, // no decompression bombs, no CPU amplification
      clientTracking: false,
    });
  }

  get connectionCount(): number {
    return this.sessions.size;
  }

  attach(server: Server): void {
    server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => this.onUpgrade(req, socket, head));
    this.heartbeat = setInterval(() => this.beat(), HEARTBEAT_MS);
    this.heartbeat.unref();
  }

  private clientIp(req: IncomingMessage): string {
    if (this.config.TRUST_PROXY) {
      const fwd = req.headers['x-forwarded-for'];
      const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim();
      if (first) return first;
    }
    return req.socket.remoteAddress ?? 'unknown';
  }

  private reject(socket: Duplex, status: number, reason: string): void {
    this.metrics.reject(reason);
    const text = status === 429 ? 'Too Many Requests' : status === 503 ? 'Service Unavailable' : status === 403 ? 'Forbidden' : 'Bad Request';
    socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    socket.destroy();
  }

  private onUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    socket.on('error', () => socket.destroy());
    const url = req.url ?? '';
    // Team voice rooms share the port: same origin and upgrade limits, their own hub.
    if (this.voice && (url === VOICE_PATH || url.startsWith(`${VOICE_PATH}?`))) {
      if (!this.accepting) return this.reject(socket, 503, 'shutting_down');
      const origin = req.headers.origin;
      if (origin !== undefined && !this.allowedOrigins.has(origin)) return this.reject(socket, 403, 'origin');
      if (!this.upgradeLimiter.hit(this.clientIp(req))) return this.reject(socket, 429, 'upgrade_rate');
      return this.voice.upgrade(req, socket, head);
    }
    if (url !== '/ws' && !url.startsWith('/ws?')) return this.reject(socket, 400, 'path');
    if (!this.accepting) return this.reject(socket, 503, 'shutting_down');
    const origin = req.headers.origin;
    if (origin !== undefined && !this.allowedOrigins.has(origin)) return this.reject(socket, 403, 'origin');
    const ip = this.clientIp(req);
    if (!this.upgradeLimiter.hit(ip)) return this.reject(socket, 429, 'upgrade_rate');
    if (this.sessions.size >= this.config.MAX_CONNECTIONS) return this.reject(socket, 503, 'capacity');
    if (this.perIp.get(ip) >= this.config.MAX_CONNECTIONS_PER_IP) return this.reject(socket, 429, 'per_ip');
    const query = new URL(url, 'http://localhost').searchParams, mode = query.get('mode'), squad = mode === 'battle-royale' && query.get('squad') === '1';
    if (mode && mode !== 'survival' && mode !== 'battle-royale' && mode !== 'infection' && mode !== 'waves') return this.reject(socket, 400, 'mode');
    let pool: MatchSource | undefined = mode === 'battle-royale' || mode === 'infection' ? this.pools[mode] : undefined;
    // Wave survival: a private room for this player (bots) or their launched party (friends).
    if (mode === 'waves') {
      const map = query.get('map') ?? '', bots = Number(query.get('bots') ?? '0');
      pool = this.waves?.(map, query.get('party') === '1', bots) ?? undefined;
      if (!pool) return this.reject(socket, 404, 'map');
    }
    // A battle royale map chosen in the mode menu (the built-in island when absent).
    const mapId = mode === 'battle-royale' || mode === 'infection' ? query.get('map') : null;
    if (mode === 'battle-royale' && mapId && mapId !== 'hac-son') {
      pool = this.battleMaps?.(mapId);
      if (!pool) return this.reject(socket, 404, 'map');
    }
    // An Infection map picked in the menu (the active map when absent).
    if (mode === 'infection' && mapId) {
      pool = this.infectionMaps?.(mapId);
      if (!pool) return this.reject(socket, 404, 'map');
    }
    if ((mode === 'battle-royale' || mode === 'infection' || mode === 'waves') && !pool) return this.reject(socket, 503, 'mode_unavailable');
    this.wss.handleUpgrade(req, socket, head, (ws) => this.onConnection(ws, ip, pool ? undefined : this.game, squad, pool));
  }

  private onConnection(ws: WebSocket, ip: string, game: GameServer | undefined, squad = false, pool?: MatchSource): void {
    const session = new ClientSession(this.nextSessionId++, ws, ip, this.metrics);
    session.squad = squad;
    if (game) this.sessionGames.set(session, game);
    if (pool) this.sessionPools.set(session, pool);
    this.sessions.add(session);
    this.perIp.inc(ip);
    this.metrics.connections = this.sessions.size;

    const authTimer = setTimeout(() => {
      if (session.state === 'authenticating') {
        session.sendError('auth_timeout', 'authentication timed out', true);
        session.close(CloseCode.AuthTimeout, 'auth timeout');
      }
    }, AUTH_TIMEOUT_MS);

    ws.on('pong', () => {
      session.alive = true;
    });
    ws.on('message', (data: RawData, isBinary: boolean) => this.onMessage(session, data, isBinary));
    ws.on('error', (err) => this.log.debug({ err: err.message, sid: session.id }, 'socket error'));
    ws.on('close', () => {
      clearTimeout(authTimer);
      this.sessionGames.get(session)?.leave(session, 'disconnect');
      session.state = 'closed';
      if (this.sessions.delete(session)) {
        this.perIp.dec(ip);
        this.metrics.connections = this.sessions.size;
      }
    });
  }

  private onMessage(session: ClientSession, data: RawData, isBinary: boolean): void {
    if (session.state === 'closed') return;
    this.metrics.messagesIn++;
    if (!session.messageBucket.take()) {
      session.sendError('rate_limited', 'message rate exceeded', true);
      session.close(CloseCode.RateLimited, 'rate limited');
      this.audit.record({ event: 'ws.rate_limited', accountId: session.account?.accountId, ip: session.ip, severity: 'warn' });
      return;
    }
    if (isBinary) {
      session.strike();
      return;
    }
    const text = Buffer.isBuffer(data)
      ? data.toString('utf8')
      : Array.isArray(data)
        ? Buffer.concat(data).toString('utf8')
        : Buffer.from(data).toString('utf8');
    const parsed = parseClientMessage(text);
    if (!parsed.ok) {
      if (session.state === 'authenticating') {
        session.sendError('invalid_message', 'expected auth message', true);
        session.close(CloseCode.PolicyViolation, 'invalid auth');
        return;
      }
      session.strike();
      return;
    }
    const msg = parsed.message;
    if (session.state === 'authenticating') {
      if (msg.t !== 'auth') {
        session.sendError('invalid_message', 'expected auth message', true);
        session.close(CloseCode.PolicyViolation, 'invalid auth');
        return;
      }
      session.state = 'joining';
      void this.authenticate(session, msg.v, msg.ticket);
      return;
    }
    if (session.state === 'playing') (this.sessionGames.get(session) ?? this.game).handleMessage(session, msg);
    // Messages while joining are dropped (client waits for welcome).
  }

  private async authenticate(session: ClientSession, version: number, ticket: string): Promise<void> {
    if (version !== PROTOCOL_VERSION) {
      session.sendError('protocol_version', `server speaks protocol ${PROTOCOL_VERSION}; please refresh`, true);
      session.close(CloseCode.ProtocolVersion, 'protocol version');
      return;
    }
    try {
      const account = await this.auth.consumeTicket(ticket);
      if (!account) {
        this.audit.record({ event: 'ws.auth_failed', ip: session.ip, severity: 'warn' });
        session.sendError('auth_failed', 'invalid or expired ticket', true);
        session.close(CloseCode.AuthFailed, 'auth failed');
        return;
      }
      if (!session.open) return;
      session.account = account;
      const pool = this.sessionPools.get(session);
      if (pool) {
        const match = pool.pick(session.squad ? this.squadOf(account.accountId) : undefined, account.accountId);
        if (!match) { session.sendError('server_full', 'Mọi trận đều đang đầy. Hãy thử lại sau ít phút.', true); session.close(CloseCode.ServerFull, 'no match'); return; }
        this.sessionGames.set(session, match);
      }
      await (this.sessionGames.get(session) ?? this.game).join(session);
    } catch (err) {
      this.log.error({ err, sid: session.id }, 'join failed');
      session.sendError('internal', 'could not join the world', true);
      session.close(CloseCode.InternalError, 'join failed');
    }
  }

  private beat(): void {
    for (const s of this.sessions) {
      if (!s.alive) {
        s.ws.terminate();
        continue;
      }
      s.alive = false;
      try {
        s.ws.ping();
      } catch {
        s.ws.terminate();
      }
    }
  }

  /** Stops accepting connections; existing sessions are closed by GameServer.stop(). */
  stopAccepting(): void {
    this.accepting = false;
  }

  async close(): Promise<void> {
    this.accepting = false;
    if (this.heartbeat) clearInterval(this.heartbeat);
    for (const s of this.sessions) s.close(CloseCode.GoingAway, 'server shutdown');
    await new Promise<void>((resolve) => this.wss.close(() => resolve()));
  }
}
