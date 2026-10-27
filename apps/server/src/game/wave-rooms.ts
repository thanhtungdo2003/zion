import { randomUUID } from 'node:crypto';
import { WAVE_MAX_BOTS, WAVE_TEAM_LIMIT, type TeamRecord, type WavePlayMode } from '@zion/shared';
import type { Logger } from '../logger';
import type { GameServer, WaveRoomConfig } from './game-server';

/** Anything the gateway can ask for a match to put a player in (a MatchPool, a wave room source). */
export interface MatchSource { pick(squad?: string, accountId?: string): GameServer | null }

/** Rooms running at once (each is a full game server: keep small servers safe). */
export const MAX_WAVE_ROOMS = 24;
const SWEEP_MS = 15_000;
/** A room nobody reached (or everyone left before the first wave) closes after this long. */
const EMPTY_MS = 90_000;

interface Room { key: string; server: GameServer; mapId: string; created: number; closing: boolean }

/**
 * Zombie Wave Survival matches are private: one room per party launch (friends) or per player
 * (bots). A room is made on the first connection with its key and closes once its match is over
 * and empty, or if nobody arrives.
 */
export class WaveRooms {
  private readonly rooms = new Map<string, Room>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly create: (cfg: WaveRoomConfig) => GameServer | null,
    /** The wave party an account is in (friends mode). */
    private readonly partyOf: (accountId: string) => TeamRecord | undefined,
    private readonly maps: (id: string) => { name: string } | null,
    private readonly log: Logger,
  ) {}

  get count(): number { return this.rooms.size; }
  /** Players in rooms on a map (for the map picker). */
  players(mapId: string): number { let n = 0; for (const r of this.rooms.values()) if (r.mapId === mapId) n += r.server.headcount; return n; }

  start(): void {
    this.timer = setInterval(() => { void this.sweep(); }, SWEEP_MS);
    this.timer.unref();
  }

  /**
   * The match source for one connection: `party` (friends mode) puts everyone of the leader's
   * latest launch in one room; otherwise the player gets a room of their own with `bots` bots.
   * Null when the map is not a wave map or the request is malformed.
   */
  source(mapId: string, party: boolean, bots: number): MatchSource | null {
    const map = this.maps(mapId);
    if (!map || !Number.isInteger(bots) || bots < 0 || bots > WAVE_MAX_BOTS || (party && bots)) return null;
    return {
      pick: (_squad, accountId) => {
        if (!accountId) return null;
        // Back into the room this player was in (a reconnect mid-match).
        for (const r of this.rooms.values()) if (!r.closing && !r.server.waveFinished && r.server.hasRejoin(accountId)) return r.server;
        let playMode: WavePlayMode = 'bots', key = `solo:${accountId}`, expected = 1;
        if (party) {
          const team = this.partyOf(accountId);
          // Only members of a party that was launched in the last minute, onto its map.
          if (!team?.launchId || Date.now() - team.launchedAt > 60_000 || (team.map && team.map !== mapId)) return null;
          playMode = 'friends'; key = `party:${team.id}:${team.launchId}`; expected = Math.min(WAVE_TEAM_LIMIT, team.members.length);
        }
        const existing = this.rooms.get(key);
        if (existing && !existing.closing && existing.server.canAdmit()) return existing.server;
        // A finished solo room is replaced by a fresh one ("play again").
        if (existing && !party) this.close(existing);
        else if (existing) return null;
        if (this.rooms.size >= MAX_WAVE_ROOMS) return null;
        const room: Room = { key, mapId, created: Date.now(), closing: false, server: null as unknown as GameServer };
        const server = this.create({
          matchId: randomUUID(), mapId, mapName: map.name, playMode, bots: party ? 0 : bots, expected,
          closed: () => this.close(room),
        });
        if (!server) return null;
        room.server = server;
        server.start();
        this.rooms.set(key, room);
        this.log.info({ key, mapId, playMode, bots, rooms: this.rooms.size }, 'wave room opened');
        return server;
      },
    };
  }

  private close(room: Room): void {
    if (room.closing) return;
    room.closing = true;
    if (this.rooms.get(room.key) === room) this.rooms.delete(room.key);
    void room.server.stop().catch((err: unknown) => this.log.error({ err }, 'wave room stop failed'));
    this.log.info({ key: room.key, rooms: this.rooms.size }, 'wave room closed');
  }

  private async sweep(): Promise<void> {
    const now = Date.now();
    for (const room of [...this.rooms.values()]) if (room.server.headcount === 0 && now - room.created > EMPTY_MS) this.close(room);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await Promise.all([...this.rooms.values()].map((r) => r.server.stop().catch(() => undefined)));
    this.rooms.clear();
  }
}
