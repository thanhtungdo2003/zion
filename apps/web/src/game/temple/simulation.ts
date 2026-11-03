/**
 * Chánh Điện: who is in the hall and what they are doing, without any rendering (unit tested).
 * Viewers come in on their first like, chat, follow or share and sit on a cushion. Every 10 likes
 * one walks up and makes a small offering (bows, sets a lotus lamp on the altar table); every
 * 50 likes, a follow or a share makes a big offering, which the camera follows from behind.
 * One person at the altar at a time, big offerings first. Gifts are ignored: they never make an
 * offering and are never ranked (the scene is entertainment, not a donation).
 */
export type PersonState = 'entering' | 'sitting' | 'toAltar' | 'bowing' | 'placing' | 'returning' | 'leaving';
export interface Seat { id: number; x: number; z: number; owner: string | null }
export interface Offering { kind: 'small' | 'big'; source: 'likes' | 'follow' | 'share'; at: number }
export interface Person {
  key: string; name: string; avatar: string | null; seed: number;
  x: number; z: number; yaw: number; state: PersonState; stateAt: number;
  path: Array<{ x: number; z: number }>; running: boolean; seat: Seat | null;
  likes: number; offerings: number; lastActive: number; offering: Offering | null; current: Offering | null;
  chat: string; chatUntil: number;
}
export interface TempleEventInput {
  kind: 'join' | 'like' | 'chat' | 'follow' | 'share' | 'gift';
  id: string; user: { id: string; name: string; avatar: string | null }; likes?: number; comment?: string;
}
export interface TempleCallbacks {
  /** A big offering starts (the camera should go to this person) or ends. */
  focus?(person: Person | null): void;
  /** An offering was made: a lamp goes on the altar table. */
  offered?(person: Person, offering: Offering): void;
  thanks?(person: Person, kind: 'follow' | 'share'): void;
  joined?(person: Person): void;
}

/** Hall geometry in metres; the altar is towards −Z, the door at +Z. */
export const HALL = {
  width: 14, depth: 18, door: { x: 0, z: 8.6 }, altar: { x: 0, z: -4.3 }, aisleX: 0,
  seats: [-2.4, -1.2, 0, 1.2, 2.4, 3.6, 4.8].flatMap((z, row) => [-3.9, -2.75, -1.6, 1.6, 2.75, 3.9].map((x, col) => ({ id: row * 6 + col, x, z }))),
} as const;
export const TEMPLE_RULES = { smallEvery: 10, bigEvery: 50, walk: 1.35, run: 4.6, inactiveSeconds: 300, followCooldown: 300, shareCooldown: 60, bowSeconds: 4.2, bigBowSeconds: 7, placeSeconds: 1.6, chatSeconds: 7 } as const;

const hash = (s: string) => [...s].reduce((n, c) => (Math.imul(n, 31) + c.charCodeAt(0)) >>> 0, 7);
export const yawTowards = (dx: number, dz: number) => Math.atan2(-dx, -dz);

export class TempleSimulation {
  time = 0;
  readonly people = new Map<string, Person>();
  readonly seats: Seat[] = HALL.seats.map((s) => ({ ...s, owner: null }));
  private readonly likeTotals = new Map<string, number>();
  private readonly actionAt = new Map<string, number>();
  private readonly seen = new Set<string>();
  /** Who is at (or on the way to) the altar. */
  active: Person | null = null;
  maxPeople = 24;

  constructor(private readonly on: TempleCallbacks = {}) {}

  receive(e: TempleEventInput): void {
    if (this.seen.has(e.id)) return;
    this.seen.add(e.id); if (this.seen.size > 20000) this.seen.delete(this.seen.values().next().value as string);
    if (e.kind === 'gift' || e.kind === 'join') return;
    const key = e.user.id;
    let p = this.people.get(key);
    if (p) { p.name = e.user.name; p.lastActive = this.time; if (e.user.avatar) p.avatar = e.user.avatar; }
    if (e.kind === 'chat') {
      if (!p || !e.comment) return;
      p.chat = e.comment.slice(0, 80); p.chatUntil = this.time + TEMPLE_RULES.chatSeconds; return;
    }
    // Likes count even while the hall is full; reaching 50 gets a place like a follow does.
    const before = this.likeTotals.get(key) ?? 0, total = e.kind === 'like' ? before + Math.max(1, Math.min(1000, e.likes ?? 1)) : before;
    const crossed = (n: number) => Math.floor(total / n) > Math.floor(before / n);
    this.likeTotals.set(key, total);
    p ??= this.join(key, e.user, e.kind !== 'like' || crossed(TEMPLE_RULES.bigEvery)) ?? undefined;
    if (!p) return;
    if (e.kind === 'like') {
      p.likes = total;
      if (crossed(TEMPLE_RULES.bigEvery)) this.request(p, { kind: 'big', source: 'likes', at: this.time });
      else if (crossed(TEMPLE_RULES.smallEvery)) this.request(p, { kind: 'small', source: 'likes', at: this.time });
    } else {
      const cooldown = e.kind === 'follow' ? TEMPLE_RULES.followCooldown : TEMPLE_RULES.shareCooldown, k = `${key}:${e.kind}`;
      if (this.time - (this.actionAt.get(k) ?? -Infinity) < cooldown) return;
      this.actionAt.set(k, this.time);
      this.on.thanks?.(p, e.kind);
      this.request(p, { kind: 'big', source: e.kind, at: this.time });
    }
  }

  /** One waiting offering per person; a big one replaces a waiting small one. */
  private request(p: Person, o: Offering): void {
    if (p.offering && (p.offering.kind === 'big' || o.kind === 'small')) return;
    p.offering = o;
  }

  private join(key: string, user: TempleEventInput['user'], important: boolean): Person | null {
    let seat = this.seats.find((s) => !s.owner);
    if (!seat || this.people.size >= this.maxPeople) {
      // Full: someone quiet (sitting, nothing waiting) leaves to make room for a follow or share.
      if (!important) return null;
      const quiet = [...this.people.values()].filter((q) => q.state === 'sitting' && !q.offering).sort((a, b) => a.lastActive - b.lastActive)[0];
      if (!quiet) return null;
      this.leave(quiet); seat = this.seats.find((s) => !s.owner);
      if (!seat) return null;
    }
    seat.owner = key;
    const p: Person = {
      key, name: user.name, avatar: user.avatar, seed: hash(key), x: HALL.door.x + ((hash(key) % 100) / 100 - .5), z: HALL.door.z, yaw: 0,
      state: 'entering', stateAt: this.time, path: this.pathToSeat(seat, HALL.door), running: false, seat,
      likes: 0, offerings: 0, lastActive: this.time, offering: null, current: null, chat: '', chatUntil: 0,
    };
    this.people.set(key, p); this.on.joined?.(p); return p;
  }

  private leave(p: Person): void {
    if (p.seat) p.seat.owner = null;
    p.seat = null; p.state = 'leaving'; p.stateAt = this.time; p.running = false;
    p.path = [{ x: p.x, z: p.z + .6 }, { x: HALL.aisleX + .5, z: p.z + .6 }, { ...HALL.door }, { x: HALL.door.x, z: HALL.door.z + 2 }];
  }

  /** Door → up the aisle → along the row (just behind it) → onto the cushion. */
  private pathToSeat(seat: Seat, from: { x: number; z: number }) {
    return [{ x: HALL.aisleX, z: Math.max(from.z, seat.z + .6) }, { x: HALL.aisleX, z: seat.z + .6 }, { x: seat.x, z: seat.z + .6 }, { x: seat.x, z: seat.z }];
  }

  private go(p: Person, state: PersonState, path: Person['path'], running = false): void { p.state = state; p.stateAt = this.time; p.path = path; p.running = running; }

  update(dt: number): void {
    this.time += dt;
    // Next offering: big ones first, then the oldest.
    if (!this.active) {
      const next = [...this.people.values()].filter((p) => p.offering && p.state === 'sitting')
        .sort((a, b) => (a.offering!.kind === 'big' ? 0 : 1) - (b.offering!.kind === 'big' ? 0 : 1) || a.offering!.at - b.offering!.at)[0];
      if (next) {
        this.active = next; next.current = next.offering; next.offering = null;
        const a = HALL.altar, far = Math.hypot(next.x - a.x, next.z - a.z) > 5;
        this.go(next, 'toAltar', [{ x: next.x, z: next.z + .6 }, { x: HALL.aisleX, z: next.z + .6 }, { x: a.x, z: a.z + .4 }, { ...a }], far);
        if (next.current!.kind === 'big') this.on.focus?.(next);
      }
    }
    for (const p of this.people.values()) {
      const arrived = this.walk(p, dt), age = this.time - p.stateAt;
      if (p.chatUntil && p.chatUntil < this.time) { p.chat = ''; p.chatUntil = 0; }
      if (p.state === 'entering' && arrived) { p.state = 'sitting'; p.yaw = 0; }
      else if (p.state === 'toAltar' && arrived) { p.state = 'bowing'; p.stateAt = this.time; p.yaw = 0; }
      else if (p.state === 'bowing' && age >= (p.current?.kind === 'big' ? TEMPLE_RULES.bigBowSeconds : TEMPLE_RULES.bowSeconds)) { p.state = 'placing'; p.stateAt = this.time; }
      else if (p.state === 'placing' && age >= TEMPLE_RULES.placeSeconds) {
        p.offerings++; const done = p.current!; p.current = null;
        this.on.offered?.(p, done);
        if (done.kind === 'big') this.on.focus?.(null);
        this.active = null;
        if (p.seat) this.go(p, 'returning', [{ x: HALL.aisleX, z: HALL.altar.z + .4 }, ...this.pathToSeat(p.seat, { x: HALL.aisleX, z: HALL.altar.z })]);
        else this.leave(p);
      } else if (p.state === 'returning' && arrived) { p.state = 'sitting'; p.yaw = 0; }
      else if (p.state === 'leaving' && arrived) this.people.delete(p.key);
      if (p.state === 'sitting' && !p.offering && this.time - p.lastActive > TEMPLE_RULES.inactiveSeconds) this.leave(p);
    }
  }

  /** Moves along the path; true once the path is done. */
  private walk(p: Person, dt: number): boolean {
    let step = (p.running ? TEMPLE_RULES.run : TEMPLE_RULES.walk) * dt;
    while (p.path.length && step > 0) {
      const t = p.path[0]!, dx = t.x - p.x, dz = t.z - p.z, d = Math.hypot(dx, dz);
      if (d > 1e-3) p.yaw = yawTowards(dx, dz);
      if (d <= step) { p.x = t.x; p.z = t.z; p.path.shift(); step -= d; }
      else { p.x += dx / d * step; p.z += dz / d * step; step = 0; }
    }
    return p.path.length === 0;
  }
}
