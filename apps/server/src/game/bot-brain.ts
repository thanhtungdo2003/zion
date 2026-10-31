import { Layer, makeRayHit, type CollisionWorld } from '@zion/physics';

/**
 * Battlefield bots' long-range navigation and tactics, shared by every bot of a server.
 *
 * Navigation is hierarchical (HPA*-style):
 * - a coarse grid of 4 m cells over the terrain, whose edges are tested lazily, once, against the
 *   physics world itself (a fence, wall or house between two cells blocks the edge; too steep a
 *   slope or deep water does too) and cached for everyone;
 * - A* over that grid gives the long way round (hundreds of metres, across fences and through
 *   gaps), time-sliced under one budget for all bots per tick;
 * - the bot hands the next stretch (a waypoint within reach) to the fine local search
 *   (navigation.ts, 0.5 m cells) that threads doors, stairs and ladders.
 * Recovery: an edge a bot gets stuck on is remembered as bad for everyone for a while, and the
 * route is planned again without it, so no bot loops on a broken route; a goal found unreachable
 * is reported, never walked at blindly.
 *
 * Tactics are utility-scored: each bot's personality weighs holding, taking cover, flanking,
 * pushing and falling back; firing positions round the fight are scored by sight of the target,
 * cover from it, range and spacing from teammates.
 */

export const NAV_CELL = 4;
const MAX_NODES = 9000;
const BAD_EDGE_MS = 25_000;
const STEP = 1.1;
const SLOPE = .85;

type Key = number;
const key = (cx: number, cz: number): Key => (cx + 32768) * 65536 + (cz + 32768);
const cxOf = (k: Key) => Math.floor(k / 65536) - 32768, czOf = (k: Key) => (k % 65536) - 32768;
const DIRS: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

export interface RoutePoint { x: number; z: number }

interface Search {
  goal: Key;
  open: Array<{ k: Key; f: number }>;
  g: Map<Key, number>;
  from: Map<Key, Key>;
  visited: number;
  done: boolean;
  path: RoutePoint[] | null;
}

/** The coarse navigation grid of one world: lazily tested edges, shared bad edges, budgeted searches. */
export class CoarseNav {
  /**
   * What is known of each cell and edge, in flat arrays over the whole map (0 untested, 1 open,
   * 2 blocked): a few MB however much the bots explore. (Maps keyed by strings grew to millions
   * of entries on a big battlefield with many bots, and the server ran out of memory.)
   */
  private readonly size: number;
  private readonly cells: Uint8Array;
  /** Per cell, its edges to (+1,−1), (+1,0), (+1,+1) and (0,+1): every edge once, from its lower end. */
  private readonly edges: Uint8Array;
  /** Edges bots got stuck on: avoided by everyone until then (ms). */
  private readonly bad = new Map<string, number>();
  private readonly hit = makeRayHit();
  private readonly pending = new Set<Search>();
  /** Edge tests and expanded nodes, since start (for the profile). */
  readonly stats = { edgeTests: 0, expanded: 0, searches: 0, failed: 0 };

  constructor(private readonly world: CollisionWorld, private readonly budget = 700, private readonly maxMs = 2.5) {
    this.size = Math.ceil(world.worldSize / NAV_CELL);
    this.cells = new Uint8Array(this.size * this.size);
    this.edges = new Uint8Array(this.size * this.size * 4);
  }

  private inGrid(cx: number, cz: number): boolean { return cx >= 0 && cz >= 0 && cx < this.size && cz < this.size; }

  private ground(cx: number, cz: number): number { return this.world.terrainHeight((cx + .5) * NAV_CELL, (cz + .5) * NAV_CELL); }

  /**
   * A cell one can stand in: not under water, not inside a solid. Ground not loaded (collision
   * streams round players and bots) is assumed open and not remembered: the long route plans
   * through it and is corrected once the bot gets there and it loads.
   */
  open(cx: number, cz: number): boolean {
    if (!this.inGrid(cx, cz)) return false;
    const i = cz * this.size + cx, known = this.cells[i]!;
    if (known) return known === 1;
    const x = (cx + .5) * NAV_CELL, z = (cz + .5) * NAV_CELL, y = this.world.terrainHeight(x, z);
    if (!Number.isFinite(y)) return true;
    const ok = this.world.waterLevel(x, z) - y < .9 && !this.world.overlapsCapsule(x, y + .5, z, x, y + 1.5, z, .35, Layer.Static);
    this.cells[i] = ok ? 1 : 2;
    return ok;
  }

  /** The slot of the edge between neighbouring cells a and b (−1 off the map). */
  private edgeSlot(ax: number, az: number, bx: number, bz: number): number {
    if (ax > bx || (ax === bx && az > bz)) { const tx = ax, tz = az; ax = bx; az = bz; bx = tx; bz = tz; }
    if (!this.inGrid(ax, az) || !this.inGrid(bx, bz)) return -1;
    const d = bx === ax ? 3 : bz - az + 1;
    return (az * this.size + ax) * 4 + d;
  }

  /** Whether one can walk from cell a to its neighbour b: slope, then fences and walls at knee and chest height. */
  passable(ax: number, az: number, bx: number, bz: number): boolean {
    const slot = this.edgeSlot(ax, az, bx, bz);
    if (slot < 0) return false;
    const known = this.edges[slot]!;
    if (known) return known === 1 && !this.isBad(ax, az, bx, bz);
    const ha = this.ground(ax, az), hb = this.ground(bx, bz);
    // Either end not loaded: assumed passable, tested (and remembered) once it loads.
    if (!Number.isFinite(ha) || !Number.isFinite(hb)) return this.open(ax, az) && this.open(bx, bz) && !this.isBad(ax, az, bx, bz);
    this.stats.edgeTests++;
    let ok = this.open(ax, az) && this.open(bx, bz);
    if (ok) {
      const len = Math.hypot(bx - ax, bz - az) * NAV_CELL;
      ok = Math.abs(hb - ha) / len < SLOPE;
      const x0 = (ax + .5) * NAV_CELL, z0 = (az + .5) * NAV_CELL, dx = (bx - ax) * NAV_CELL / len, dz = (bz - az) * NAV_CELL / len;
      // Two rays each side of the line (a body's width), at step and chest height over the ground.
      for (const side of [-.3, .3]) for (const h of [STEP, 1.5]) {
        if (!ok) break;
        const ox = x0 - dz * side, oz = z0 + dx * side, oy = Math.max(ha, hb) + h;
        if (this.world.raycast(ox, oy, oz, dx, (hb - ha) / len, dz, len, Layer.Static, this.hit)) ok = false;
      }
    }
    this.edges[slot] = ok ? 1 : 2;
    return ok && !this.isBad(ax, az, bx, bz);
  }

  private isBad(ax: number, az: number, bx: number, bz: number): boolean {
    if (!this.bad.size) return false;
    const id = ax < bx || (ax === bx && az < bz) ? `${ax},${az}>${bx},${bz}` : `${bx},${bz}>${ax},${az}`;
    const until = this.bad.get(id);
    if (until === undefined) return false;
    if (performance.now() < until) return true;
    this.bad.delete(id);
    return false;
  }

  /** A bot could not get from `a` to `b` (world points): that edge is avoided by everyone for a while. */
  blame(a: RoutePoint, b: RoutePoint): void {
    const ax = Math.floor(a.x / NAV_CELL), az = Math.floor(a.z / NAV_CELL), bx = Math.floor(b.x / NAV_CELL), bz = Math.floor(b.z / NAV_CELL);
    if (ax === bx && az === bz) return;
    const id = ax < bx || (ax === bx && az < bz) ? `${ax},${az}>${bx},${bz}` : `${bx},${bz}>${ax},${az}`;
    this.bad.set(id, performance.now() + BAD_EDGE_MS);
  }

  /** Starts a search from `from` to `to` (world points); advance it with `beginTick`. */
  plan(from: RoutePoint, to: RoutePoint): Search {
    const start = this.nearestOpen(Math.floor(from.x / NAV_CELL), Math.floor(from.z / NAV_CELL));
    const goal = this.nearestOpen(Math.floor(to.x / NAV_CELL), Math.floor(to.z / NAV_CELL));
    const s: Search = { goal: key(goal[0], goal[1]), open: [{ k: key(start[0], start[1]), f: 0 }], g: new Map([[key(start[0], start[1]), 0]]), from: new Map(), visited: 0, done: false, path: null };
    this.stats.searches++;
    this.pending.add(s);
    return s;
  }

  cancel(s: Search | null): void { if (s) this.pending.delete(s); }

  private nearestOpen(cx: number, cz: number): [number, number] {
    if (this.open(cx, cz)) return [cx, cz];
    for (let r = 1; r <= 3; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) === r && this.open(cx + dx, cz + dz)) return [cx + dx, cz + dz];
    }
    return [cx, cz];
  }

  /** Advances every pending search within this tick's budget (nodes and milliseconds). */
  beginTick(): void {
    if (this.bad.size > 64) { const t = performance.now(); for (const [id, until] of this.bad) if (t >= until) this.bad.delete(id); }
    let budget = this.budget;
    const deadline = performance.now() + this.maxMs;
    for (const s of [...this.pending]) {
      if (budget <= 0 || performance.now() > deadline) break;
      budget -= this.advance(s, Math.min(budget, 260), deadline);
      if (s.done) this.pending.delete(s);
    }
  }

  private advance(s: Search, budget: number, deadline: number): number {
    let used = 0;
    const gx = cxOf(s.goal), gz = czOf(s.goal), h = (cx: number, cz: number) => Math.hypot(cx - gx, cz - gz) * 1.2;
    while (!s.done && used < budget) {
      if ((used & 15) === 15 && performance.now() > deadline) break;
      // Lowest f (a small binary heap would be faster; the open lists stay short on a coarse grid).
      let bi = 0;
      for (let i = 1; i < s.open.length; i++) if (s.open[i]!.f < s.open[bi]!.f) bi = i;
      const node = s.open.splice(bi, 1)[0];
      if (!node || s.visited >= MAX_NODES) { s.done = true; this.stats.failed++; break; }
      used++; s.visited++; this.stats.expanded++;
      if (node.k === s.goal) { s.path = this.unwind(s); s.done = true; break; }
      const cx = cxOf(node.k), cz = czOf(node.k), g0 = s.g.get(node.k)!;
      for (const [dx, dz] of DIRS) {
        const nx = cx + dx, nz = cz + dz;
        // Diagonals only where both sides are open (no corner cutting through a wall's end).
        if (dx && dz && (!this.passable(cx, cz, cx + dx, cz) || !this.passable(cx, cz, cx, cz + dz))) continue;
        if (!this.passable(cx, cz, nx, nz)) continue;
        const nk = key(nx, nz), g = g0 + Math.hypot(dx, dz);
        if ((s.g.get(nk) ?? Infinity) <= g) continue;
        s.g.set(nk, g); s.from.set(nk, node.k);
        s.open.push({ k: nk, f: g + h(nx, nz) });
      }
    }
    return used;
  }

  /** The cell path as world points, string-pulled: a point is dropped while its neighbours see each other along open edges. */
  private unwind(s: Search): RoutePoint[] {
    const cells: Key[] = [];
    for (let k: Key | undefined = s.goal; k !== undefined; k = s.from.get(k)) cells.push(k);
    cells.reverse();
    const out: RoutePoint[] = [];
    let anchor = 0;
    for (let i = 2; i <= cells.length; i++) {
      if (i < cells.length && this.straight(cells[anchor]!, cells[i]!)) continue;
      const k = cells[i - 1]!;
      out.push({ x: (cxOf(k) + .5) * NAV_CELL, z: (czOf(k) + .5) * NAV_CELL });
      anchor = i - 1;
    }
    return out;
  }

  /** Cells a and b joined by a straight run of passable edges (Bresenham over the grid). */
  private straight(a: Key, b: Key): boolean {
    let x = cxOf(a), z = czOf(a);
    const x1 = cxOf(b), z1 = czOf(b), dx = Math.abs(x1 - x), dz = Math.abs(z1 - z), sx = Math.sign(x1 - x), sz = Math.sign(z1 - z);
    if (dx + dz > 12) return false;
    let err = dx - dz;
    while (x !== x1 || z !== z1) {
      const e2 = 2 * err, px = x, pz = z;
      if (e2 > -dz) { err -= dz; x += sx; }
      if (e2 < dx) { err += dx; z += sz; }
      if (!this.passable(px, pz, x, z)) return false;
    }
    return true;
  }
}

/** A bot's long route: the search in progress, the waypoints, how it is going. */
export class RouteState {
  search: Search | null = null;
  points: RoutePoint[] = [];
  goal: RoutePoint | null = null;
  /** Progress check: where it was, and when. */
  checkAt = 0;
  checkFrom: RoutePoint | null = null;
  fails = 0;
  /** No way found to this goal: walk no further at it until then (ms). */
  blockedUntil = 0;
}

/**
 * The next point to walk to on the long way to `goal` (or null while planning or when there is
 * none): plans when the goal moved or the route ran out, skips waypoints as they are passed,
 * and blames the edge ahead when the bot stops making progress (then plans round it).
 */
export function routeStep(nav: CoarseNav, r: RouteState, from: RoutePoint, goal: RoutePoint, now: number): RoutePoint | null {
  if (!r.goal || Math.hypot(r.goal.x - goal.x, r.goal.z - goal.z) > NAV_CELL * 2) {
    nav.cancel(r.search);
    r.goal = { ...goal }; r.points = []; r.fails = 0; r.blockedUntil = 0;
    r.search = nav.plan(from, goal);
  }
  if (r.search?.done) {
    r.points = r.search.path ?? [];
    if (!r.search.path) r.blockedUntil = now + 6000;
    r.search = null; r.checkAt = now + 3000; r.checkFrom = { ...from };
  }
  if (r.search) return null;
  if (!r.points.length) {
    if (now >= r.blockedUntil) r.search = nav.plan(from, goal);
    return null;
  }
  // Passed: a waypoint within half a cell, or one behind us with the next nearer.
  while (r.points.length > 1 && Math.hypot(r.points[0]!.x - from.x, r.points[0]!.z - from.z) < NAV_CELL * .75) r.points.shift();
  const next = r.points[0]!;
  // Stuck: hardly moved in 3 s while heading for this waypoint: that edge is bad, plan again.
  if (now >= r.checkAt) {
    if (r.checkFrom && Math.hypot(from.x - r.checkFrom.x, from.z - r.checkFrom.z) < 1.5) {
      nav.blame(from, next);
      r.fails++;
      r.points = [];
      r.search = r.fails > 4 ? null : nav.plan(from, goal);
      if (r.fails > 4) { r.blockedUntil = now + 8000; r.fails = 0; }
    }
    r.checkAt = now + 3000; r.checkFrom = { ...from };
  }
  return r.points[0] ?? null;
}

/* ------------------------------------------------------------------------------- tactics */

/** How a bot fights: its weights for each choice and the range it likes. */
export interface Personality {
  name: 'aggressive' | 'defensive' | 'tactical' | 'cautious';
  aggression: number;
  caution: number;
  flanking: number;
  /** The range it likes to fight at (m). */
  range: number;
  /** Below this health it looks to fall back. */
  retreat: number;
}
export const PERSONALITIES: readonly Personality[] = [
  { name: 'aggressive', aggression: .9, caution: .2, flanking: .5, range: 14, retreat: 20 },
  { name: 'defensive', aggression: .3, caution: .7, flanking: .2, range: 32, retreat: 40 },
  { name: 'tactical', aggression: .55, caution: .5, flanking: .9, range: 24, retreat: 30 },
  { name: 'cautious', aggression: .25, caution: .9, flanking: .4, range: 38, retreat: 55 },
];
export const personalityOf = (id: number): Personality => PERSONALITIES[((id * 2654435761) >>> 0) % PERSONALITIES.length]!;

export type Tactic = 'hold' | 'cover' | 'flank' | 'push' | 'fallback';
export interface FightSituation {
  health: number;
  distance: number;
  /** The bot is reloading, or out of ammunition for the fight. */
  reloading: boolean;
  /** Teammates within 25 m, and enemies known about. */
  allies: number;
  enemies: number;
  /** Seconds this fight has gone on, and since the bot was last hit. */
  fightSec: number;
  hurtSec: number;
  /** A cover spot was found near. */
  coverNear: boolean;
}

/** Utility of each tactic for a personality in a situation; the best wins (see chooseTactic). */
export function tacticScores(p: Personality, s: FightSituation): Record<Tactic, number> {
  const hurt = 1 - s.health / 100, outnumbered = Math.max(0, s.enemies - s.allies), far = s.distance / p.range;
  return {
    hold: .5 + (1 - Math.abs(1 - far)) * .4 - hurt * .3,
    cover: (s.coverNear ? .3 : -.5) + hurt * (.1 + p.caution * .9) + (s.hurtSec < 2 ? .4 * p.caution : 0) + (s.reloading ? .5 : 0) + outnumbered * .15,
    flank: (s.fightSec > 6 ? .35 : 0) + p.flanking * .5 - hurt * .4 + (s.allies > 0 ? .15 : -.1) - (s.reloading ? .4 : 0),
    push: p.aggression * .6 + (far > 1.3 ? .3 : 0) - hurt * .6 - outnumbered * .2 - (s.reloading ? .6 : 0) + (s.allies >= s.enemies ? .1 : 0),
    fallback: s.health < p.retreat ? .6 + p.caution * .5 + outnumbered * .2 : -1,
  };
}

/** Picks a tactic, sticking with the current one unless another is clearly better (no dithering). */
export function chooseTactic(p: Personality, s: FightSituation, current: Tactic | null): Tactic {
  const scores = tacticScores(p, s);
  let best: Tactic = 'hold';
  for (const t of Object.keys(scores) as Tactic[]) if (scores[t] > scores[best]) best = t;
  return current && scores[current] > scores[best] - .15 ? current : best;
}

/**
 * The best firing position round a fight (Tactical Position Scoring): candidates on rings round
 * the bot, each scored for seeing the target from it, standing in cover from it (a low wall
 * between), lying at the personality's range, keeping apart from teammates and not being far to
 * go. `lateral` > 0 favours positions off to the side of the line to the target (a flank).
 */
export function tacticalPosition(world: CollisionWorld, from: { x: number; y: number; z: number }, target: { x: number; y: number; z: number }, p: Personality, mates: ReadonlyArray<{ x: number; z: number }>, lateral: number): { x: number; y: number; z: number; score: number } | null {
  const hit = makeRayHit(), tx = target.x - from.x, tz = target.z - from.z, d0 = Math.hypot(tx, tz) || 1, ux = tx / d0, uz = tz / d0;
  let best: { x: number; y: number; z: number; score: number } | null = null;
  for (const radius of [6, 12]) for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2, x = from.x + Math.cos(a) * radius, z = from.z + Math.sin(a) * radius, y = world.terrainHeight(x, z);
    if (!Number.isFinite(y) || world.waterLevel(x, z) - y > .6 || world.overlapsCapsule(x, y + .5, z, x, y + 1.5, z, .35, Layer.Static)) continue;
    const dx = target.x - x, dz = target.z - z, d = Math.hypot(dx, dz) || 1;
    const sees = !world.raycast(x, y + 1.5, z, dx / d, (target.y + 1.2 - y - 1.5) / d, dz / d, d, Layer.Static | Layer.Terrain, hit);
    const covered = world.raycast(x, y + .6, z, dx / d, (target.y + 1 - y - .6) / d, dz / d, Math.min(d, 6), Layer.Static, hit);
    const side = Math.abs((x - from.x) * -uz + (z - from.z) * ux) / radius;
    const crowd = mates.reduce((n, m) => n + (Math.hypot(m.x - x, m.z - z) < 4 ? 1 : 0), 0);
    const score = (sees ? 1 : -.4) + (covered ? .7 : 0) - Math.abs(d - p.range) / p.range * .6 + side * lateral - crowd * .4 - radius * .02;
    if (!best || score > best.score) best = { x, y, z, score };
  }
  return best;
}

/** Steering away from teammates closer than `radius` (Reynolds separation), as a world vector. */
export function separation(self: { x: number; z: number }, mates: ReadonlyArray<{ x: number; z: number }>, radius = 1.8): { x: number; z: number } {
  let x = 0, z = 0;
  for (const m of mates) {
    const dx = self.x - m.x, dz = self.z - m.z, d = Math.hypot(dx, dz);
    if (d < 1e-3 || d > radius) continue;
    const push = (radius - d) / radius;
    x += dx / d * push; z += dz / d * push;
  }
  return { x, z };
}
