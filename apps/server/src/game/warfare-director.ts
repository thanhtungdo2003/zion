import { WARFARE_SIDES, formationSlot, otherSide, type WarfareClass, type WarfareOrder, type WarfarePointKind, type WarfareSide, type ZoneState } from '@zion/shared';
import type { BotObjective } from './battle-bots';

/**
 * Warfare AI, above the individual bot. Three layers, one owner each, so a bot never gets two
 * conflicting orders:
 *
 * - Battlefield director (this class): who holds what, where the fighting is, which zones are
 *   threatened; calls for reinforcements.
 * - Squad commander (`assign`): every few seconds gives each AI squad of a side a task (attack,
 *   defend, reinforce or scout a zone), spreading squads over zones instead of piling onto one
 *   and keeping tasks until they are done or something more urgent comes up.
 * - Squad AI (`objectives`): the leader heads for the task, the others keep a wedge on it on the
 *   way and take their own spots once there (cover, lookouts, a ring facing the enemy).
 *
 * The bot itself (BattleBotDirector) still sees, fights, heals and paths; its `objective` is the
 * only thing set from here. Bots a player recruited leave their AI squad and follow the player's
 * orders instead (`ledObjective`), which always win over the commander.
 */

export type WarfareTaskKind = 'attack' | 'defend' | 'reinforce' | 'scout';

export interface DirectorZone extends ZoneState {
  y: number;
  value: number;
  links: readonly string[];
  points: ReadonlyArray<{ x: number; z: number; y?: number; kind: WarfarePointKind }>;
  /** Deploy points set in the Studio (empty: round the ring). */
  spawns: ReadonlyArray<{ x: number; z: number; y?: number }>;
}

export interface DirectorUnit {
  id: number;
  side: WarfareSide;
  x: number;
  y: number;
  z: number;
  health: number;
  alive: boolean;
  /** Shooting at someone right now. */
  fighting: boolean;
  cls?: WarfareClass;
}

export interface AiSquad {
  id: number;
  side: WarfareSide;
  members: number[];
  leader: number | null;
  task: { kind: WarfareTaskKind; zone: string; since: number } | null;
}

const ASSIGN_MS = 3000;
/** A task is kept at least this long unless it is done or something urgent appears. */
const STICKY_MS = 40_000;
/** Each squad already sent to a zone makes it this much less attractive to the next. */
const CROWDING = .45;
const STUCK_MS = 9000;
const RETREAT_MS = 6000;
const CALL_MS = 30_000;

const yawTo = (fx: number, fz: number, tx: number, tz: number) => Math.atan2(-(tx - fx), -(tz - fz));

export class WarfareDirector {
  readonly squads = new Map<number, AiSquad>();
  private readonly squadOf = new Map<number, number>();
  private nextSquad = 1;
  private assignedAt = -Infinity;
  private readonly moved = new Map<number, { x: number; z: number; at: number }>();
  private readonly detour = new Map<number, { x: number; z: number; until: number }>();
  private readonly retreat = new Map<number, number>();
  private readonly calledAt = new Map<string, number>();

  constructor(
    private readonly bases: Record<WarfareSide, { x: number; y: number; z: number }>,
    private readonly squadSize: number,
  ) {}

  /** Puts a bot into an AI squad of its side with room (or a new one). */
  enlist(id: number, side: WarfareSide): AiSquad {
    const have = this.squadOf.get(id);
    if (have !== undefined) {
      const sq = this.squads.get(have)!;
      if (sq.side === side) return sq;
      this.discharge(id);
    }
    let sq = [...this.squads.values()].find((s) => s.side === side && s.members.length < this.squadSize);
    if (!sq) {
      sq = { id: this.nextSquad++, side, members: [], leader: null, task: null };
      this.squads.set(sq.id, sq);
    }
    sq.members.push(id);
    this.squadOf.set(id, sq.id);
    return sq;
  }

  /** Takes a bot out of its AI squad (recruited by a player, or gone). */
  discharge(id: number): void {
    const sid = this.squadOf.get(id);
    this.squadOf.delete(id);
    this.moved.delete(id); this.detour.delete(id); this.retreat.delete(id);
    if (sid === undefined) return;
    const sq = this.squads.get(sid);
    if (!sq) return;
    sq.members = sq.members.filter((m) => m !== id);
    if (sq.leader === id) sq.leader = null;
    if (!sq.members.length) this.squads.delete(sid);
  }

  squadIdOf(id: number): number | undefined {
    return this.squadOf.get(id);
  }

  /** Every task, for the tactical map. */
  tasks(side: WarfareSide): { squad: number; kind: WarfareTaskKind; zone: string; size: number }[] {
    return [...this.squads.values()].filter((s) => s.side === side && s.task).map((s) => ({ squad: s.id, kind: s.task!.kind, zone: s.task!.zone, size: s.members.length }));
  }

  /**
   * One think: elect leaders, (re)assign tasks, and return each squad bot's objective plus the
   * zones that need reinforcements.
   */
  think(now: number, zones: readonly DirectorZone[], units: ReadonlyMap<number, DirectorUnit>, presence: ReadonlyMap<string, Record<WarfareSide, number>>, force = false): { objectives: Map<number, BotObjective>; calls: { side: WarfareSide; zone: DirectorZone }[] } {
    for (const sq of this.squads.values()) {
      // Leader: the first member still standing (the squad goes on when it falls).
      if (sq.leader === null || !units.get(sq.leader)?.alive) sq.leader = sq.members.find((m) => units.get(m)?.alive) ?? null;
    }
    if (force || now - this.assignedAt >= ASSIGN_MS) {
      this.assignedAt = now;
      for (const side of WARFARE_SIDES) this.assign(side, now, zones, units, presence);
    }
    const calls: { side: WarfareSide; zone: DirectorZone }[] = [];
    for (const z of zones) {
      if (!z.owner) continue;
      const p = presence.get(z.id) ?? { blue: 0, red: 0 };
      if (p[otherSide(z.owner)] > p[z.owner] && now - (this.calledAt.get(z.id) ?? -Infinity) > CALL_MS) {
        this.calledAt.set(z.id, now);
        calls.push({ side: z.owner, zone: z });
      }
    }
    const objectives = new Map<number, BotObjective>();
    const byId = new Map(zones.map((z) => [z.id, z]));
    for (const sq of this.squads.values()) {
      const zone = sq.task ? byId.get(sq.task.zone) : undefined;
      const lead = sq.leader !== null ? units.get(sq.leader) : undefined;
      const alive = sq.members.filter((m) => units.get(m)?.alive);
      alive.forEach((id, i) => {
        const u = units.get(id)!;
        let o = zone && lead ? this.squadObjective(sq, zone, u, lead, i, alive.length) : this.baseObjective(sq.side);
        o = this.guard(now, u, o, zones);
        objectives.set(id, o);
      });
    }
    return { objectives, calls };
  }

  /** Retreat when badly hurt in a fight, and a detour when a bot makes no headway. */
  private guard(now: number, u: DirectorUnit, o: BotObjective, zones: readonly DirectorZone[]): BotObjective {
    if (u.fighting && u.health < 35 && !this.retreat.has(u.id)) this.retreat.set(u.id, now + RETREAT_MS);
    const until = this.retreat.get(u.id);
    if (until !== undefined) {
      if (now > until) this.retreat.delete(u.id);
      else {
        const safe = this.nearestHeld(u.side, u, zones);
        return { x: safe.x, y: safe.y, z: safe.z, radius: 4, sprint: true };
      }
    }
    const far = Math.hypot(o.x - u.x, o.z - u.z) > o.radius + 2;
    const last = this.moved.get(u.id);
    if (!last || Math.hypot(u.x - last.x, u.z - last.z) > 1.5 || !far) this.moved.set(u.id, { x: u.x, z: u.z, at: now });
    else if (now - last.at > STUCK_MS && !u.fighting) {
      // No headway for a while: try a way round, a little to one side of the straight line.
      const dx = o.x - u.x, dz = o.z - u.z, d = Math.hypot(dx, dz) || 1, side = Math.random() < .5 ? -1 : 1, off = 6 + Math.random() * 6;
      this.detour.set(u.id, { x: u.x + dx / d * Math.min(d, 10) - dz / d * off * side, z: u.z + dz / d * Math.min(d, 10) + dx / d * off * side, until: now + 7000 });
      this.moved.set(u.id, { x: u.x, z: u.z, at: now });
    }
    const way = this.detour.get(u.id);
    if (way) {
      if (now > way.until || Math.hypot(way.x - u.x, way.z - u.z) < 2) this.detour.delete(u.id);
      else return { x: way.x, y: u.y, z: way.z, radius: 1.5, sprint: true };
    }
    return o;
  }

  private nearestHeld(side: WarfareSide, at: { x: number; z: number }, zones: readonly DirectorZone[]): { x: number; y: number; z: number } {
    let best: { x: number; y: number; z: number } = this.bases[side], d = Math.hypot(best.x - at.x, best.z - at.z);
    for (const z of zones) {
      if (z.owner !== side || z.contested) continue;
      const dd = Math.hypot(z.x - at.x, z.z - at.z);
      if (dd < d && dd > z.radius) { best = z; d = dd; }
    }
    return best;
  }

  private baseObjective(side: WarfareSide): BotObjective {
    const b = this.bases[side];
    return { x: b.x, y: b.y, z: b.z, radius: 10, faceYaw: yawTo(b.x, b.z, this.bases[otherSide(side)].x, this.bases[otherSide(side)].z) };
  }

  /** Squad commander for one side. */
  private assign(side: WarfareSide, now: number, zones: readonly DirectorZone[], units: ReadonlyMap<number, DirectorUnit>, presence: ReadonlyMap<string, Record<WarfareSide, number>>): void {
    const squads = [...this.squads.values()].filter((s) => s.side === side && s.members.some((m) => units.get(m)?.alive)).sort((a, b) => a.id - b.id);
    if (!squads.length || !zones.length) return;
    const enemy = otherSide(side);
    const held = zones.filter((z) => z.owner === side);
    // The front: our base and every zone we hold.
    const anchors = [this.bases[side], ...held];
    const front = (z: { x: number; z: number }) => Math.min(...anchors.map((a) => Math.hypot(a.x - z.x, a.z - z.z)));
    const score = new Map<string, { kind: WarfareTaskKind; value: number }>();
    for (const z of zones) {
      const p = presence.get(z.id) ?? { blue: 0, red: 0 };
      if (z.owner === side) {
        const slipping = (side === 'blue' ? z.progress < 1 : z.progress > -1) ? 1.5 : 0;
        const threat = p[enemy] + (z.contested ? 2 : 0) + slipping;
        score.set(z.id, threat > 0 ? { kind: 'reinforce', value: z.value * (1.2 + threat * 1.4) } : { kind: 'defend', value: z.value * .35 });
      } else {
        const proximity = 1 / (1 + front(z) / 120);
        const neutral = z.owner === null ? 1.3 : 1;
        // Already being taken by us: finish the job.
        const finishing = p[side] > 0 && (side === 'blue' ? z.progress > 0 : z.progress < 0) ? 1.25 : 1;
        score.set(z.id, { kind: 'attack', value: z.value * neutral * proximity * finishing / (1 + p[enemy] * .25) });
      }
    }
    const taken = new Map<string, number>();
    const pick = (exclude?: WarfareTaskKind) => {
      let best: { id: string; kind: WarfareTaskKind; value: number } | null = null;
      for (const [id, s] of score) {
        if (exclude && s.kind === exclude) continue;
        const v = s.value * CROWDING ** (taken.get(id) ?? 0);
        if (!best || v > best.value) best = { id, kind: s.kind, value: v };
      }
      return best;
    };
    const valid = (t: AiSquad['task']) => {
      if (!t) return false;
      const z = zones.find((zz) => zz.id === t.zone);
      if (!z) return false;
      // An attack on a zone we now hold is done; a zone we were holding and lost is an attack now.
      return t.kind === 'attack' || t.kind === 'scout' ? z.owner !== side : z.owner === side;
    };
    const scouting = squads.length >= 4 && zones.some((z) => z.owner === enemy);
    squads.forEach((sq, i) => {
      // The last squad of a big side scouts round the far side of the enemy's deepest zone.
      if (scouting && i === squads.length - 1) {
        const deep = zones.filter((z) => z.owner === enemy).sort((a, b) => front(b) - front(a))[0]!;
        if (!valid(sq.task) || sq.task!.kind !== 'scout') sq.task = { kind: 'scout', zone: deep.id, since: now };
        return;
      }
      const best = pick();
      const keep = valid(sq.task) && now - sq.task!.since < STICKY_MS
        && !(best && best.kind === 'reinforce' && sq.task!.kind !== 'reinforce' && best.value > (score.get(sq.task!.zone)?.value ?? 0) * 2);
      if (keep) { taken.set(sq.task!.zone, (taken.get(sq.task!.zone) ?? 0) + 1); return; }
      if (!best) return;
      sq.task = sq.task && sq.task.zone === best.id && sq.task.kind === best.kind ? sq.task : { kind: best.kind, zone: best.id, since: now };
      taken.set(best.id, (taken.get(best.id) ?? 0) + 1);
    });
    // Holding zones but nobody guarding any: the weakest attacking squad stays back on the front.
    if (held.length && squads.length >= 3 && !squads.some((s) => s.task?.kind === 'defend' || s.task?.kind === 'reinforce')) {
      const enemyBase = this.bases[enemy];
      const frontline = [...held].sort((a, b) => Math.hypot(a.x - enemyBase.x, a.z - enemyBase.z) - Math.hypot(b.x - enemyBase.x, b.z - enemyBase.z))[0]!;
      const weakest = [...squads].filter((s) => s.task?.kind !== 'scout').sort((a, b) => a.members.filter((m) => units.get(m)?.alive).length - b.members.filter((m) => units.get(m)?.alive).length)[0];
      if (weakest) weakest.task = { kind: 'defend', zone: frontline.id, since: now };
    }
  }

  /** Where one squad member goes for its squad's task. */
  private squadObjective(sq: AiSquad, zone: DirectorZone, u: DirectorUnit, lead: DirectorUnit, index: number, size: number): BotObjective {
    const enemyBase = this.bases[otherSide(sq.side)];
    const face = yawTo(zone.x, zone.z, enemyBase.x, enemyBase.z);
    const kind = sq.task!.kind;
    if (kind === 'scout') {
      // A flank lookout beside the zone, lying low, watching it.
      const own = this.bases[sq.side], ax = zone.x - own.x, az = zone.z - own.z, l = Math.hypot(ax, az) || 1;
      const off = zone.radius + 14, side = sq.id % 2 ? 1 : -1;
      const x = zone.x - az / l * off * side + (index - size / 2) * 3, z = zone.z + ax / l * off * side;
      return { x, y: zone.y, z, radius: 3, prone: true, faceYaw: yawTo(x, z, zone.x, zone.z) };
    }
    const leadIn = Math.hypot(lead.x - zone.x, lead.z - zone.z) < zone.radius * 1.3;
    // On the way: the leader makes for the zone, the rest keep a wedge on the leader.
    if (!leadIn && u.id !== lead.id && Math.hypot(u.x - zone.x, u.z - zone.z) > zone.radius) {
      const heading = yawTo(lead.x, lead.z, zone.x, zone.z), slot = formationSlot(index - 1);
      const c = Math.cos(heading), s = Math.sin(heading);
      // Leader frame: x right (cos, -sin), z back (sin, cos).
      const x = lead.x + slot.x * c + slot.z * s, z = lead.z - slot.x * s + slot.z * c;
      return { x, y: lead.y, z, radius: 2.5, sprint: Math.hypot(x - u.x, z - u.z) > 8, faceYaw: heading };
    }
    if (!leadIn && u.id === lead.id) return { x: zone.x, y: zone.y, z: zone.z, radius: zone.radius * .6, sprint: true, faceYaw: face };
    // At the zone: everyone takes a spot of their own.
    if (kind === 'defend' || kind === 'reinforce') {
      const wanted: WarfarePointKind[] = u.cls === 'recon' ? ['sniper', 'overwatch', 'defend', 'cover'] : u.cls === 'support' ? ['defend', 'overwatch', 'cover'] : ['cover', 'defend', 'overwatch'];
      for (const k of wanted) {
        const spots = zone.points.filter((p) => p.kind === k);
        if (spots.length) {
          const p = spots[(sq.id + index) % spots.length]!;
          return { x: p.x, y: p.y ?? zone.y, z: p.z, radius: 1.5, prone: k === 'sniper' || k === 'overwatch', faceYaw: yawTo(p.x, p.z, enemyBase.x, enemyBase.z) };
        }
      }
    }
    // A ring inside the capture area, the open side towards the enemy.
    const a = face + Math.PI + ((index + .5) / Math.max(1, size) - .5) * Math.PI * 1.4;
    const r = zone.radius * (kind === 'attack' ? .45 : .7);
    const x = zone.x - Math.sin(a) * r, z = zone.z - Math.cos(a) * r;
    return { x, y: zone.y, z, radius: Math.max(1.5, zone.radius * .15), faceYaw: face, prone: kind === 'defend' && u.cls === 'support' };
  }
}

/**
 * Where a bot led by a player goes for that player's order. `index` is its place among the
 * player's followers; `hold` is where the bot stood when told to hold.
 */
export function ledObjective(order: WarfareOrder, leader: { x: number; y: number; z: number; yaw: number }, index: number, self: { x: number; y: number; z: number }, zone?: { x: number; y: number; z: number; radius: number }): BotObjective {
  const c = Math.cos(leader.yaw), s = Math.sin(leader.yaw);
  switch (order.kind) {
    case 'hold':
      return { x: order.x ?? self.x, y: self.y, z: order.z ?? self.z, radius: 1.5, faceYaw: leader.yaw };
    case 'move':
    case 'attack': {
      // Spread round the point so a group does not stand in one spot.
      const a = index * 2.399, r = index ? 1.8 + index * .6 : 0;
      const x = (order.x ?? leader.x) + Math.cos(a) * r, z = (order.z ?? leader.z) + Math.sin(a) * r;
      const heading = yawTo(leader.x, leader.z, order.x ?? leader.x, order.z ?? leader.z);
      return { x, y: self.y, z, radius: order.kind === 'attack' ? 3 : 1.8, sprint: order.kind === 'attack' || Math.hypot(x - self.x, z - self.z) > 12, faceYaw: heading };
    }
    case 'defend': {
      if (zone) {
        const a = index * 2.399, r = zone.radius * .6;
        return { x: zone.x + Math.cos(a) * r, y: zone.y, z: zone.z + Math.sin(a) * r, radius: 2, faceYaw: Math.atan2(-Math.cos(a), -Math.sin(a)) };
      }
      return { x: order.x ?? self.x, y: self.y, z: order.z ?? self.z, radius: 3, faceYaw: leader.yaw };
    }
    case 'follow':
    case 'regroup':
    default: {
      const slot = formationSlot(index);
      const x = leader.x + slot.x * c + slot.z * s, z = leader.z - slot.x * s + slot.z * c;
      return { x, y: leader.y, z, radius: order.kind === 'regroup' ? 1.5 : 2.5, sprint: order.kind === 'regroup' || Math.hypot(x - self.x, z - self.z) > 6, faceYaw: leader.yaw };
    }
  }
}
