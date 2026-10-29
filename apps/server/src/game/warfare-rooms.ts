import { randomUUID } from 'node:crypto';
import { WARFARE_MAX_ROOMS } from '@zion/shared';
import type { Logger } from '../logger';
import type { GameServer } from './game-server';
import type { MatchSource } from './wave-rooms';

/** What a Warfare game server needs to know about its room. */
export interface WarfareRoomConfig {
  matchId: string;
  mapId: string;
  mapName: string;
  /** The match is over (or abandoned): the pool tears the room down. */
  closed: () => void;
}

/** Minimal surface the pool uses (a GameServer satisfies it; tests use fakes). */
export type WarfareRoomServer = Pick<GameServer, 'start' | 'stop' | 'headcount' | 'canAdmit' | 'hasRejoin'>;

const SWEEP_MS = 15_000;
/** A room nobody reached closes after this long. */
const EMPTY_MS = 90_000;

interface Room { key: string; server: WarfareRoomServer; mapId: string; created: number; closing: boolean }

/**
 * Warfare matches are public: players are put into any open room on the chosen map (rejoin
 * first), and a new room is opened when every room there is full or finished.
 */
export class WarfareRooms {
  private readonly rooms = new Map<string, Room>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly create: (cfg: WarfareRoomConfig) => WarfareRoomServer | null,
    private readonly maps: (id: string) => { name: string } | null,
    private readonly log: Logger,
    private readonly maxRooms = WARFARE_MAX_ROOMS,
  ) {}

  get count(): number { return this.rooms.size; }
  /** Players in rooms on a map (for the map picker). */
  players(mapId: string): number { let n = 0; for (const r of this.rooms.values()) if (r.mapId === mapId && !r.closing) n += r.server.headcount; return n; }

  start(): void {
    this.timer = setInterval(() => this.sweep(), SWEEP_MS);
    this.timer.unref();
  }

  /** The match source for a connection onto `mapId` (null when it is not a Warfare map). */
  source(mapId: string): MatchSource | null {
    const map = this.maps(mapId);
    if (!map) return null;
    return {
      pick: (_squad, accountId) => {
        if (!accountId) return null;
        for (const r of this.rooms.values()) if (!r.closing && r.server.hasRejoin(accountId)) return r.server as GameServer;
        for (const r of this.rooms.values()) if (!r.closing && r.mapId === mapId && r.server.canAdmit()) return r.server as GameServer;
        if (this.rooms.size >= this.maxRooms) return null;
        const key = `wf:${mapId}:${randomUUID()}`;
        const room: Room = { key, mapId, created: Date.now(), closing: false, server: null as unknown as WarfareRoomServer };
        const server = this.create({ matchId: randomUUID(), mapId, mapName: map.name, closed: () => this.close(room) });
        if (!server) return null;
        room.server = server;
        server.start();
        this.rooms.set(key, room);
        this.log.info({ key, mapId, rooms: this.rooms.size }, 'warfare room opened');
        return server as GameServer;
      },
    };
  }

  private close(room: Room): void {
    if (room.closing) return;
    room.closing = true;
    if (this.rooms.get(room.key) === room) this.rooms.delete(room.key);
    void room.server.stop().catch((err: unknown) => this.log.error({ err }, 'warfare room stop failed'));
    this.log.info({ key: room.key, rooms: this.rooms.size }, 'warfare room closed');
  }

  /** Exposed for tests. */
  sweep(now = Date.now()): void {
    for (const room of [...this.rooms.values()]) if (room.server.headcount === 0 && now - room.created > EMPTY_MS) this.close(room);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await Promise.all([...this.rooms.values()].map((r) => r.server.stop().catch(() => undefined)));
    this.rooms.clear();
  }
}
