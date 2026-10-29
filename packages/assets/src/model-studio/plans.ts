import { DocBuilder } from './build';
import { subtree, type FloorPlan, type ModelDoc, type Opening } from './doc';
import { materialFromPreset, matchPreset } from './materials';
import { spiralRadius, stairFlightLines } from './mesh';
import { doorZone, junctionBands } from './procedural';

/**
 * Floor plans: the AI (or the admin) draws each storey first — rooms, walls with their doors and
 * windows, stairs, stairwell voids — gets it checked like an architect would (are the rooms
 * closed and big enough, can every room be reached through a door, do doors fit a person, do
 * the stairs fit and climb, is there a well above them), fixes it, and only then builds it:
 * the parts are exactly what the plan says, nothing designed in advance.
 */
export interface PlanIssue { level: 'error' | 'warning' | 'info'; message: string }

/** Riser and tread of plans drawn before stairs were designed per building. */
const RISER = .18, TREAD = .27;

/**
 * Stair design rules by what the building is for (design values within common building codes:
 * homes allow steeper, narrower stairs than schools, offices, hospitals or blocks of flats).
 * maxFlight: risers in one flight before a landing; headroom: clear height above the nosings;
 * guard: height of the balustrade round a stairwell.
 */
export interface StairRules { use: 'residential' | 'public'; maxRiser: number; minTread: number; maxTread: number; minWidth: number; maxFlight: number; headroom: number; guard: number }
const STAIR_RULES: Record<StairRules['use'], StairRules> = {
  residential: { use: 'residential', maxRiser: .18, minTread: .25, maxTread: .32, minWidth: .9, maxFlight: 18, headroom: 2, guard: .95 },
  public: { use: 'public', maxRiser: .165, minTread: .28, maxTread: .34, minWidth: 1.2, maxFlight: 18, headroom: 2.1, guard: 1.1 },
};
const PUBLIC_USE = /trường|school|campus|đại học|university|bệnh viện|hospital|văn phòng|office|chung cư|apartment|khách sạn|hotel|thương mại|mall|siêu thị|nhà ga|station|xưởng|factory|công sở|nhà máy|nhà kho|warehouse|ủy ban|thư viện|library|bảo tàng|museum/i;
export function stairRules(doc: ModelDoc): StairRules {
  const pub = doc.lotClass === 'commercial' || doc.lotClass === 'industrial' || doc.lotClass === 'military' || PUBLIC_USE.test(`${doc.name} ${doc.brief ?? ''}`);
  return STAIR_RULES[pub ? 'public' : 'residential'];
}

/** Blondel's rule: one riser twice plus one tread is a comfortable stride (0.60–0.65 m). */
const blondel = (riser: number, rules: StairRules) => Math.max(rules.minTread, Math.min(rules.maxTread, .63 - 2 * riser));

/**
 * Designs each flight of a newly drawn storey for this building: the highest riser its rules
 * allow (fewer when drawn lower), the tread from Blondel's rule, a landing at least as deep as the
 * flight is wide, a 10 cm gap between the flights of a U. What the drawing gave is kept (and
 * checked). Returns what was filled in.
 */
export function designStairs(doc: ModelDoc, plan: FloorPlan): string[] {
  const rules = stairRules(doc), rise = stairRise(doc, plan), out: string[] = [];
  for (const s of plan.stairs) {
    const was = { riser: s.riser, tread: s.tread, landing: s.landing, gap: s.gap };
    s.riser ??= rules.maxRiser;
    const { steps } = stairCounts(rise, s);
    s.tread ??= r3(Math.round(blondel(rise / steps, rules) / .005) * .005);
    if (s.shape === 'l' || s.shape === 'u') s.landing ??= r3(Math.max(s.width, 1));
    if (s.shape === 'u') s.gap ??= .1;
    if (was.riser === undefined || was.tread === undefined || ((s.shape === 'l' || s.shape === 'u') && was.landing === undefined))
      out.push(`Cầu thang ${s.id} (${rules.use === 'public' ? 'công trình công cộng' : 'nhà ở'}): ${steps} bậc cao ${(rise / steps * 100).toFixed(1)} cm, sâu ${(s.tread * 100).toFixed(1)} cm${s.landing ? `, chiếu nghỉ ${s.landing} m` : ''}${s.gap ? `, khe giữa hai vế ${s.gap} m` : ''}.`);
  }
  return out;
}
/**
 * The model's one measuring module: every plan coordinate and size lands on a 5 cm grid, so
 * walls, rooms, stairs and wells line up exactly instead of nearly.
 */
export const PLAN_GRID = .05;
const snap = (v: number) => Math.round(v / PLAN_GRID) * PLAN_GRID;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** A plan with every coordinate on the grid (stairs keep their computed footprint). */
export function snapPlan(plan: FloorPlan): FloorPlan {
  const sn = (v: number) => r3(snap(v));
  return {
    ...plan,
    rooms: plan.rooms.map((r) => ({ ...r, x0: sn(r.x0), z0: sn(r.z0), x1: sn(r.x1), z1: sn(r.z1) })),
    walls: plan.walls.map((w) => ({ ...w, a: [sn(w.a[0]), sn(w.a[1])] as [number, number], b: [sn(w.b[0]), sn(w.b[1])] as [number, number], thickness: Math.max(PLAN_GRID, sn(w.thickness)), openings: w.openings.map((o) => ({ ...o, at: sn(o.at), width: sn(o.width), height: sn(o.height), sill: sn(o.sill) })) })),
    stairs: plan.stairs.map((st) => ({ ...st, x: sn(st.x), z: sn(st.z), width: sn(st.width) })),
    voids: plan.voids.map((v) => ({ x0: r3(v.x0), z0: r3(v.z0), x1: r3(v.x1), z1: r3(v.z1) })),
  };
}

/**
 * Closes small slots between flights and the walls beside them (wall faces are rarely on the
 * grid: a 25 cm wall's face sits at 12.5 cm): a flight within 6 cm of a parallel wall face is
 * moved against it. Returns what moved.
 */
/** Why a flight is placed wrong: off the rooms, through a wall, or its foot or its top in a wall / off the floor. */
/** What makes a flight unusable in game (as opposed to design choices the designer makes). */
const HARD = new Set(['off-rooms', 'wall', 'foot', 'top', 'door']);
const hard = (probs: string[]) => probs.filter((x) => HARD.has(x));

function stairProblems(doc: ModelDoc, plan: FloorPlan, s: Stair): string[] {
  const out: string[] = [], f = stairFootprint(s, stairRise(doc, plan));
  const rooms = plan.rooms.map(norm), up = above(doc, plan), upRooms = (up ?? plan).rooms.map(norm);
  const inset = { x0: f.x0 + .05, z0: f.z0 + .05, x1: f.x1 - .05, z1: f.z1 - .05 };
  const clearOfWalls = (p: [number, number], walls: FloorPlan['walls']) => walls.every((w) => distToSegment(p[0], p[1], w.a, w.b) > w.thickness / 2 + .2);
  if ([[f.x0, f.z0], [f.x1, f.z0], [f.x1, f.z1], [f.x0, f.z1]].some(([x, z]) => !rooms.some((r) => inside(r, x!, z!, .05)))) out.push('off-rooms');
  if (plan.walls.some((w) => segmentHitsRect(w.a, w.b, inset))) out.push('wall');

  // Slots between the flight and a wall beside it (or the flight in the wall).
  const cx = (f.x0 + f.x1) / 2, cz = (f.z0 + f.z1) / 2;
  for (const w of plan.walls) {
    const vertical = Math.abs(w.b[0] - w.a[0]) < 1e-3, horizontal = Math.abs(w.b[1] - w.a[1]) < 1e-3, half = w.thickness / 2;
    if (!vertical && !horizontal) continue;
    const c = vertical ? w.a[0] : w.a[1], lo = Math.min(vertical ? w.a[1] : w.a[0], vertical ? w.b[1] : w.b[0]), hi = Math.max(vertical ? w.a[1] : w.a[0], vertical ? w.b[1] : w.b[0]);
    if (Math.min(hi, vertical ? f.z1 : f.x1) - Math.max(lo, vertical ? f.z0 : f.x0) < .3) continue;
    const m = vertical ? cx : cz, a0 = vertical ? f.x0 : f.z0, a1 = vertical ? f.x1 : f.z1;
    const gap = c < m ? a0 - (c + half) : (c - half) - a1;
    if ((gap < -.02 && (c < m ? c - half < a0 : c + half > a1)) || (gap > .02 && gap < .6)) out.push('gap');
  }
  // From the last tread to where you step off, no wall in the way.
  const cross = (p: [number, number], q: [number, number], a: [number, number], b: [number, number]) => {
    const d = (u: [number, number], v: [number, number], w: [number, number]) => (v[0] - u[0]) * (w[1] - u[1]) - (v[1] - u[1]) * (w[0] - u[0]);
    return d(p, q, a) * d(p, q, b) < 0 && d(a, b, p) * d(a, b, q) < 0;
  };
  const through = (up ?? plan).walls.some((w) => cross([cx, cz], f.top, w.a, w.b));
  if (plan.walls.some((w) => cross([cx, cz], f.foot, w.a, w.b)) || !rooms.some((r) => inside(r, f.foot[0], f.foot[1], -.15)) || !clearOfWalls(f.foot, plan.walls) || inside(f, f.foot[0], f.foot[1], -.05)) out.push('foot');
  if (through || !upRooms.some((r) => inside(r, f.top[0], f.top[1], -.15)) || !clearOfWalls(f.top, (up ?? plan).walls) || (s.shape !== 'u' && inside(f, f.top[0], f.top[1], -.05))) out.push('top');
  if (s.shape !== 'spiral' && !flushWalls(plan, s, f).length) out.push('flush');
  const access = accessPoints(doc, plan, f.foot);
  if (access.length && !access.some((p) => faces(s, f, p))) out.push('approach');
  if (doorsOnFlight(plan, f).length) out.push('door');
  return out;
}

/**
 * Which sides of each flight are open (no solid wall alongside): [left, right] per flight, in the
 * flight's own frame. Those sides get a handrail; a side against a wall does not need one.
 */
export function railSides(doc: ModelDoc, plan: FloorPlan, s: Stair): Array<[boolean, boolean]> {
  const rise = stairRise(doc, plan), { steps, run } = stairCounts(rise, s), W = s.width / 2;
  const th = DIRS[s.direction], c = Math.cos(th), sn = Math.sin(th);
  const world = (x: number, z: number): [number, number] => [s.x + c * x + sn * z, s.z - sn * x + c * z];
  const solid = plan.walls.filter((w) => w.kind !== 'railing');
  return stairFlightLines({ width: s.width, rise, run, steps, shape: s.shape, ...(s.turn ? { turn: s.turn } : {}), ...(s.landing ? { landing: s.landing } : {}), ...(s.gap ? { gap: s.gap } : {}) }).map((f) => {
    const len = f.count * run / steps;
    return ([-1, 1] as const).map((side) => ![.2, .5, .8].every((t) => {
      const p = world(f.x + f.dx * len * t - f.dz * side * (W + .12), f.z + f.dz * len * t + f.dx * side * (W + .12));
      return solid.some((w) => distToSegment(p[0], p[1], w.a, w.b) <= w.thickness / 2 + .1);
    })) as [boolean, boolean];
  });
}

/** Doors whose clear zone (where the leaf swings and people step through, 0.5 m each side) lies on a flight. */
function doorsOnFlight(plan: FloorPlan, f: { x0: number; z0: number; x1: number; z1: number }): string[] {
  return plan.walls.flatMap((w) => w.openings.filter((o) => o.kind === 'door').flatMap((o) => {
    const z = doorZone(w, o, .5);
    return Math.min(z.x1, f.x1) - Math.max(z.x0, f.x0) > .05 && Math.min(z.z1, f.z1) - Math.max(z.z0, f.z0) > .05 ? [`${w.id} (${o.at.toFixed(2)} m)`] : [];
  }));
}

/**
 * Walls a flight stands against (face within 3 cm along a good part of its side): a straight
 * flight along one of its long sides, a turning one on any side.
 */
function flushWalls(plan: FloorPlan, s: Stair, f: ReturnType<typeof stairFootprint>): string[] {
  const out: string[] = [], cx = (f.x0 + f.x1) / 2, cz = (f.z0 + f.z1) / 2, alongZ = s.direction === 'n' || s.direction === 's';
  for (const w of plan.walls) {
    const vertical = Math.abs(w.b[0] - w.a[0]) < 1e-3, horizontal = Math.abs(w.b[1] - w.a[1]) < 1e-3, half = w.thickness / 2;
    if ((!vertical && !horizontal) || (s.shape === 'straight' && (vertical ? !alongZ : alongZ))) continue;
    const c = vertical ? w.a[0] : w.a[1], lo = Math.min(vertical ? w.a[1] : w.a[0], vertical ? w.b[1] : w.b[0]), hi = Math.max(vertical ? w.a[1] : w.a[0], vertical ? w.b[1] : w.b[0]);
    const s0 = vertical ? f.z0 : f.x0, s1 = vertical ? f.z1 : f.x1;
    if (Math.min(hi, s1) - Math.max(lo, s0) < Math.min(.6, (s1 - s0) * .4)) continue;
    const m = vertical ? cx : cz, a0 = vertical ? f.x0 : f.z0, a1 = vertical ? f.x1 : f.z1;
    const gap = c < m ? a0 - (c + half) : (c - half) - a1;
    if (Math.abs(gap) <= .03) out.push(w.id);
  }
  return out;
}

/** Where people come to the foot of a flight from: the doors of its room, and where the flight from below arrives in it. */
function accessPoints(doc: ModelDoc, plan: FloorPlan, foot: [number, number]): Array<[number, number]> {
  const room = plan.rooms.map(norm).find((r) => inside(r, foot[0], foot[1], .05));
  if (!room) return [];
  const out: Array<[number, number]> = [];
  for (const w of plan.walls) {
    const dx = w.b[0] - w.a[0], dz = w.b[1] - w.a[1], len = Math.hypot(dx, dz) || 1;
    for (const o of w.openings) if (o.kind !== 'window' && o.sill <= .3) {
      const p: [number, number] = [w.a[0] + dx / len * o.at, w.a[1] + dz / len * o.at];
      if (inside(room, p[0], p[1], w.thickness / 2 + .1)) out.push(p);
    }
  }
  const low = below(doc, plan);
  if (low) for (const st of low.stairs) { const t = stairFootprint(st, stairRise(doc, low)).top; if (inside(room, t[0], t[1])) out.push(t); }
  return out;
}

/** The first tread faces the way in: the access point is not beyond the foot along the flight, and the way to the foot does not cross the flight. */
function faces(s: Stair, f: ReturnType<typeof stairFootprint>, p: [number, number]): boolean {
  const ux = s.x - f.foot[0], uz = s.z - f.foot[1], l = Math.hypot(ux, uz) || 1;
  const along = ((p[0] - f.foot[0]) * ux + (p[1] - f.foot[1]) * uz) / l;
  return along <= .3 && !segmentHitsRect(p, f.foot, { x0: f.x0 + .05, z0: f.z0 + .05, x1: f.x1 - .05, z1: f.z1 - .05 });
}

export interface StairReview { id: string; ok: boolean; checks: Array<{ item: string; ok: boolean; note: string }> }


/**
 * A flight measured against the building's stair rules: width, riser, tread and stride, risers
 * per flight, landing depth and clear headroom under the storey above.
 */
export function stairDesignProblems(doc: ModelDoc, plan: FloorPlan, s: Stair): string[] {
  const rules = stairRules(doc), rise = stairRise(doc, plan), { steps, riser, tread } = stairCounts(rise, s), out: string[] = [];
  const kind = rules.use === 'public' ? 'công trình công cộng' : 'nhà ở';
  if (s.width < rules.minWidth - 1e-3) out.push(`vế thang rộng ${s.width} m < ${rules.minWidth} m tối thiểu cho ${kind}`);
  if (riser > rules.maxRiser + 1e-3) out.push(`bậc cao ${(riser * 100).toFixed(1)} cm > ${(rules.maxRiser * 100).toFixed(1)} cm (${kind})`);
  if (tread < rules.minTread - 1e-3) out.push(`mặt bậc ${(tread * 100).toFixed(1)} cm < ${(rules.minTread * 100).toFixed(0)} cm`);
  const stride = 2 * riser + tread;
  if (s.shape !== 'spiral' && (stride < .58 || stride > .67)) out.push(`bước chân 2h + b = ${(stride * 100).toFixed(1)} cm ngoài 58–67 cm (bậc ${(riser * 100).toFixed(1)} cm thì mặt bậc ≈ ${(blondel(riser, rules) * 100).toFixed(0)} cm)`);
  const flights = flightSteps(s, steps);
  if (flights.some((n) => n > rules.maxFlight)) out.push(`một vế ${Math.max(...flights)} bậc > ${rules.maxFlight}: cần chiếu nghỉ (dạng l hoặc u)`);
  if ((s.shape === 'l' || s.shape === 'u') && (s.landing ?? s.width) < s.width - 1e-3) out.push(`chiếu nghỉ sâu ${s.landing} m < bề rộng vế ${s.width} m`);
  if (s.shape === 'spiral' && rules.use === 'public') out.push('thang xoắn không dùng làm thang chính của công trình công cộng');
  // Clear height above every tread: under the storey above unless a well is cut there.
  const up = above(doc, plan);
  if (up) {
    const low = stairTreads(s, rise).filter((t) => !up.voids.some((v) => inside(norm(v), t.x, t.z, -.02))).map((t) => ({ ...t, clear: up.elevation - up.slab - (plan.elevation + t.y) })).filter((t) => t.clear < rules.headroom);
    if (low.length) out.push(`khoảng trống đầu chỉ ${Math.min(...low.map((t) => t.clear)).toFixed(2)} m < ${rules.headroom} m trên ${low.length} bậc (giếng thang tầng trên phải phủ hết các bậc đó)`);
  }
  return out;
}

/**
 * Where a stairwell needs a balustrade on this storey: every edge of a void that no wall runs
 * along, except where people step off the flight below.
 */
export function wellGuards(doc: ModelDoc, plan: FloorPlan): Array<{ a: [number, number]; b: [number, number] }> {
  const low = below(doc, plan), out: Array<{ a: [number, number]; b: [number, number] }> = [];
  for (const v of plan.voids.map(norm)) {
    const arrivals = (low?.stairs ?? []).map((s) => ({ s, f: stairFootprint(s, stairRise(doc, low!)) })).filter(({ f }) => overlap(f, v) > 0);
    const edges: Array<[[number, number], [number, number]]> = [[[v.x0, v.z0], [v.x1, v.z0]], [[v.x1, v.z0], [v.x1, v.z1]], [[v.x1, v.z1], [v.x0, v.z1]], [[v.x0, v.z1], [v.x0, v.z0]]];
    for (const [a, b] of edges) {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.round(len / .05));
      let run: [number, number] | null = null;
      const flush = () => { if (run && run[1] - run[0] >= .2) out.push({ a: [r3(a[0] + (b[0] - a[0]) * run[0] / len), r3(a[1] + (b[1] - a[1]) * run[0] / len)], b: [r3(a[0] + (b[0] - a[0]) * run[1] / len), r3(a[1] + (b[1] - a[1]) * run[1] / len)] }); run = null; };
      for (let i = 0; i <= n; i++) {
        const t = len * i / n, x = a[0] + (b[0] - a[0]) * t / len, z = a[1] + (b[1] - a[1]) * t / len;
        const walled = plan.walls.some((w) => distToSegment(x, z, w.a, w.b) <= w.thickness / 2 + .06);
        // The way off the flight: the edge nearest its arrival, the flight's width there.
        const arrival = arrivals.some(({ s, f }) => distToSegment(f.top[0], f.top[1], a, b) < .9 && Math.hypot(x - f.top[0], z - f.top[1]) <= Math.hypot(s.width / 2 + .05, distToSegment(f.top[0], f.top[1], a, b)) + 1e-3);
        if (walled || arrival) flush(); else if (run) run[1] = t; else run = [t, t];
      }
      flush();
    }
  }
  return out;
}

/** A drawing's fingerprint: the approval is for this drawing (and the storey heights around it) only. */
export function planHash(doc: ModelDoc, plan: FloorPlan): string {
  const { built: _b, approved: _a, ...rest } = plan;
  const low = below(doc, plan), up = above(doc, plan);
  const text = JSON.stringify([rest, low ? [low.elevation, low.stairs] : null, up ? [up.elevation, up.slab, up.voids] : null, stairRules(doc).use]);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16);
}

/**
 * Compares a built storey with its drawing: one slab per room with the wells cut out, every wall,
 * each flight where it was drawn with the steps, riser and tread designed for it, a balustrade
 * round each well. Returns the deviations (none: the model is the drawing).
 */
export function verifyBuilt(doc: ModelDoc, plan: FloorPlan): string[] {
  if (!plan.built) return [];
  const parts = subtree(doc, plan.built), out: string[] = [];
  if (!parts.length) return [`Tầng ${plan.name}: nhóm đã dựng không còn trong model — dựng lại.`];
  const long = plan.walls.filter((w) => Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) >= .05);
  const walls = parts.filter((n) => n.kind === 'wall').length, drawn = long.filter((w) => w.kind !== 'railing').length;
  if (walls !== drawn) out.push(`${walls} tường trong model, bản vẽ có ${drawn}.`);
  const rails = parts.filter((n) => n.kind === 'group' && n.tags?.includes('railing') && n.name === 'Lan can').length, railsDrawn = long.length - drawn;
  if (rails !== railsDrawn) out.push(`${rails} đoạn lan can trong model, bản vẽ có ${railsDrawn}.`);
  const slabs = parts.filter((n) => n.kind === 'slab');
  if (slabs.length !== plan.rooms.length) out.push(`${slabs.length} sàn trong model, bản vẽ có ${plan.rooms.length} phòng.`);
  const holes = slabs.reduce((sum, n) => sum + (n.kind === 'slab' ? n.holes.reduce((a, h) => a + h.width * h.depth, 0) : 0), 0);
  const voids = plan.voids.map(norm).reduce((sum, v) => sum + plan.rooms.reduce((a, r) => a + overlap(norm(r), v), 0), 0);
  if (Math.abs(holes - voids) > .05 + voids * .02) out.push(`lỗ sàn trong model ${holes.toFixed(2)} m², giếng thang trên bản vẽ ${voids.toFixed(2)} m².`);
  const rise = stairRise(doc, plan);
  for (const s of plan.stairs) {
    const n = parts.find((x) => x.kind === 'stairs' && x.name === `Cầu thang ${s.id}`);
    if (!n || n.kind !== 'stairs') { out.push(`thiếu cầu thang ${s.id}.`); continue; }
    const c = stairCounts(rise, s), p = n.transform.position;
    if (Math.hypot(p[0] - s.x, p[2] - s.z) > .01 || Math.abs(p[1] - plan.elevation) > .01) out.push(`cầu thang ${s.id} ở (${p[0].toFixed(2)}, ${p[2].toFixed(2)}), bản vẽ (${s.x}, ${s.z}).`);
    if (Math.abs(Math.atan2(Math.sin(n.transform.rotation[1] - DIRS[s.direction]), Math.cos(n.transform.rotation[1] - DIRS[s.direction]))) > .01) out.push(`cầu thang ${s.id} quay sai hướng ${s.direction}.`);
    if (n.steps !== c.steps || Math.abs(n.rise - rise) > .01) out.push(`cầu thang ${s.id}: ${n.steps} bậc lên ${n.rise.toFixed(2)} m, bản vẽ cần ${c.steps} bậc lên ${rise.toFixed(2)} m (tầng trên đã đổi cao độ: dựng lại tầng này).`);
    if (Math.abs(n.run - c.run) > .01 || n.width !== s.width || (n.shape ?? 'straight') !== s.shape || (s.landing && n.landing !== s.landing) || (s.gap && n.gap !== s.gap)) out.push(`cầu thang ${s.id}: kích thước trong model khác bản vẽ.`);
  }
  const guards = wellGuards(doc, plan);
  if (guards.length && !parts.some((n) => n.tags?.includes('well-guard'))) out.push('thiếu lan can quanh giếng thang.');
  return out.map((x) => (x.startsWith('Tầng') ? x : `Tầng ${plan.name}: ${x}`));
}

/**
 * The approval of a storey's stairs before anything is built: for each flight its position
 * (inside the stair hall, against a wall, no wall through it), the way up, where it starts (the
 * foot, facing the way in), the landing and the turn of the next flight (L and U), and the link
 * to the storey above (well, arrival); for flights from the storey below, where they arrive here.
 * Not approved: the storey is not built.
 */
export function reviewStairs(doc: ModelDoc, plan: FloorPlan): { approved: boolean; stairs: StairReview[] } {
  const up = above(doc, plan), low = below(doc, plan), out: StairReview[] = [];
  const pt = (p: [number, number]) => `(${p[0].toFixed(2)}, ${p[1].toFixed(2)})`;
  for (const s of plan.stairs) {
    const rise = stairRise(doc, plan), f = stairFootprint(s, rise), probs = stairProblems(doc, plan, s), flush = flushWalls(plan, s, f);
    const checks: StairReview['checks'] = [
      { item: 'vị trí', ok: !['off-rooms', 'wall', 'door'].some((x) => probs.includes(x)), note: `chiếm [${f.x0.toFixed(2)}, ${f.z0.toFixed(2)}] → [${f.x1.toFixed(2)}, ${f.z1.toFixed(2)}]${flush.length ? `, sát tường ${flush.join(', ')}` : ', đứng tự do'}, lan can ở ${railSides(doc, plan, s).map((r, i) => `vế ${i + 1}: ${r[0] && r[1] ? 'hai bên' : r[0] || r[1] ? 'một bên' : 'không (sát tường)'}`).join(', ')}${probs.includes('wall') ? ', có tường cắt qua' : ''}${probs.includes('off-rooms') ? ', lấn ra ngoài phòng' : ''}${probs.includes('gap') ? ', khe hở với tường' : ''}${probs.includes('door') ? `, cửa ${doorsOnFlight(plan, f).join(', ')} mở ra trên bậc` : ''}` },
      { item: 'hướng lên', ok: !probs.includes('top'), note: `đi lên về hướng ${s.direction}, ${stairCounts(rise, s).steps} bậc, lên tới ${pt(f.top)}${probs.includes('top') ? ' — đầu trên đâm vào tường hoặc ra ngoài: ngược chiều' : ''}` },
      { item: 'điểm bắt đầu', ok: !probs.includes('foot'), note: `chân thang ${pt(f.foot)}${probs.includes('foot') ? ' — sát tường hoặc ngoài phòng' : ''}${probs.includes('approach') ? ' — lưu ý: bậc đầu quay lưng với lối vào gần nhất' : ''}` },
    ];
    const design = stairDesignProblems(doc, plan, s), c = stairCounts(rise, s);
    checks.push({ item: 'kích thước', ok: !design.some((m) => !m.startsWith('khoảng trống đầu') && !m.startsWith('đặt trong')), note: `rộng ${s.width} m, ${c.steps} bậc cao ${(c.riser * 100).toFixed(1)} cm × sâu ${(c.tread * 100).toFixed(1)} cm${design.filter((m) => !m.startsWith('khoảng trống đầu') && !m.startsWith('đặt trong')).map((m) => ` — ${m}`).join('')}` });
    checks.push({ item: 'không gian', ok: !design.some((m) => m.startsWith('khoảng trống đầu') || m.startsWith('đặt trong')), note: design.filter((m) => m.startsWith('khoảng trống đầu') || m.startsWith('đặt trong')).join('; ') || `trong không gian giao thông, khoảng trống đầu ≥ ${stairRules(doc).headroom} m` });
    if (s.shape === 'l' || s.shape === 'u') {
      checks.push({ item: 'chiếu nghỉ', ok: !probs.includes('wall') && !probs.includes('off-rooms') && (s.landing ?? s.width) >= s.width - 1e-3, note: `chiếu nghỉ ${s.landing ?? s.width} m tại ${pt(f.landing!)}, vế 1 ${flightSteps(s, c.steps)[0]} bậc tới chiếu nghỉ${probs.includes('wall') || probs.includes('off-rooms') ? ' — vướng tường hoặc ra ngoài phòng' : ''}` });
      checks.push({ item: 'vế tiếp theo', ok: !probs.includes('top') && !probs.includes('wall'), note: `quay ${s.turn === 'left' ? 'trái' : 'phải'} (${s.shape === 'u' ? '180°' : '90°'}), ra tới ${pt(f.top)}` });
    }
    if (up) {
      const well = up.voids.reduce((sum, v) => sum + overlap(norm(v), f), 0), need = (f.x1 - f.x0) * (f.z1 - f.z0);
      const arrive = up.rooms.some((r) => inside(norm(r), f.top[0], f.top[1], -.15));
      checks.push({ item: 'kết nối tầng trên', ok: well >= need * .6 && arrive && !probs.includes('top'), note: `${up.name}: giếng thang ${well >= need * .6 ? 'đủ' : 'thiếu'}, đầu trên ${arrive ? 'ra phòng' : 'không rơi vào phòng nào'}` });
    } else checks.push({ item: 'kết nối tầng trên', ok: true, note: `tầng ${plan.level + 1} chưa vẽ: sẽ kiểm tra lại khi vẽ` });
    out.push({ id: s.id, ok: checks.every((c) => c.ok), checks });
  }
  if (low) for (const s of low.stairs) {
    const f = stairFootprint(s, stairRise(doc, low)), need = (f.x1 - f.x0) * (f.z1 - f.z0);
    const well = plan.voids.reduce((sum, v) => sum + overlap(norm(v), f), 0) >= need * .6;
    const arrive = plan.rooms.some((r) => inside(norm(r), f.top[0], f.top[1], -.15)) && plan.walls.every((w) => distToSegment(f.top[0], f.top[1], w.a, w.b) > w.thickness / 2 + .2);
    out.push({ id: `${s.id} (từ ${low.name})`, ok: well && arrive, checks: [{ item: 'kết nối từ tầng dưới', ok: well && arrive, note: `giếng thang ${well ? 'đủ' : 'thiếu'}, lên tới ${pt(f.top)} ${arrive ? 'trong phòng' : '— vướng tường hoặc ngoài phòng: vẽ lại tầng này hoặc tầng dưới'}` }] });
  }
  return { approved: out.every((x) => x.ok), stairs: out };
}

/**
 * A flight drawn the wrong way round (its foot or its top against a wall, through a wall, off the
 * floor) is turned: every direction and turn is tried in the same stair hall (the footprint
 * kept on the same corner) and the first that works is taken.
 */
export function orientStairs(doc: ModelDoc, plan: FloorPlan): string[] {
  const out: string[] = [];
  for (const s of plan.stairs) {
    const was = hard(stairProblems(doc, plan, s));
    if (!was.length) continue;
    const rise = stairRise(doc, plan), f0 = stairFootprint(s, rise), orig = { x: s.x, z: s.z, direction: s.direction, turn: s.turn };
    const turns: Array<Stair['turn']> = s.shape === 'l' || s.shape === 'u' ? [s.turn ?? 'right', s.turn === 'left' ? 'right' : 'left'] : [s.turn];
    let best: { x: number; z: number; direction: Stair['direction']; turn: Stair['turn']; n: number; d: number } | null = null;
    // The hall it was drawn in: the room holding the centre of the drawn footprint.
    const cx0 = (f0.x0 + f0.x1) / 2, cz0 = (f0.z0 + f0.z1) / 2;
    const roomsN = plan.rooms.map(norm);
    const hall = roomsN.find((r) => inside(r, cx0, cz0)) ?? [...roomsN].sort((a, b) => overlap(b, f0) - overlap(a, f0))[0] ?? norm(f0);
    for (const direction of [s.direction, ...(['n', 'e', 's', 'w'] as const).filter((d) => d !== s.direction)]) for (const turn of turns) {
      Object.assign(s, { x: orig.x, z: orig.z, direction, turn });
      const f = stairFootprint(s, rise);
      // Every placement of the turned flight inside the hall, on the 5 cm grid near the walls (25 cm elsewhere), nearest first.
      const xs: number[] = [], zs: number[] = [];
      for (let x = hall.x0; x <= hall.x1 - (f.x1 - f.x0) + 1e-6; x += .25) xs.push(x);
      for (let z = hall.z0; z <= hall.z1 - (f.z1 - f.z0) + 1e-6; z += .25) zs.push(z);
      xs.push(hall.x1 - (f.x1 - f.x0)); zs.push(hall.z1 - (f.z1 - f.z0));
      // Flush against each wall face of the hall.
      for (const w of plan.walls) {
        const half = w.thickness / 2;
        if (Math.abs(w.b[0] - w.a[0]) < 1e-3) xs.push(w.a[0] + half, w.a[0] - half - (f.x1 - f.x0));
        if (Math.abs(w.b[1] - w.a[1]) < 1e-3) zs.push(w.a[1] + half, w.a[1] - half - (f.z1 - f.z0));
      }
      const within = (v: number, lo: number, hi: number) => v >= lo - .3 && v <= hi + .3;
      for (let i = xs.length - 1; i >= 0; i--) if (!within(xs[i]!, hall.x0, hall.x1 - (f.x1 - f.x0))) xs.splice(i, 1);
      for (let i = zs.length - 1; i >= 0; i--) if (!within(zs[i]!, hall.z0, hall.z1 - (f.z1 - f.z0))) zs.splice(i, 1);
      for (const x of xs) for (const z of zs) {
        s.x = r3(orig.x + x - f.x0); s.z = r3(orig.z + z - f.z0);
        const n = hard(stairProblems(doc, plan, s)).length, d = Math.hypot(x + (f.x1 - f.x0) / 2 - cx0, z + (f.z1 - f.z0) / 2 - cz0) + (direction === orig.direction ? 0 : .5);
        if (!best || n < best.n || (n === best.n && d < best.d)) best = { x: s.x, z: s.z, direction, turn, n, d };
      }
    }
    if (best && best.n < was.length) {
      Object.assign(s, { x: best.x, z: best.z, direction: best.direction, ...(best.turn ? { turn: best.turn } : {}) });
      if (!best.turn) delete s.turn;
      const turned = s.direction !== orig.direction || s.turn !== orig.turn;
      out.push(`Cầu thang ${s.id} ${turned ? `được xoay cho đúng chiều (hướng ${orig.direction}${orig.turn ? `/${orig.turn}` : ''} → ${s.direction}${s.turn ? `/${s.turn}` : ''})` : 'được dời'} tới (${s.x}, ${s.z}): chân thang có chỗ bước lên, đầu trên ra phòng, sát tường, không vướng tường.`);
    } else Object.assign(s, orig);
  }
  return out;
}

export function fitStairs(doc: ModelDoc, plan: FloorPlan): string[] {
  const moved: string[] = orientStairs(doc, plan);
  for (const s of plan.stairs) {
    for (let pass = 0; pass < 2; pass++) {
      const f = stairFootprint(s, stairRise(doc, plan)), cx = (f.x0 + f.x1) / 2, cz = (f.z0 + f.z1) / 2;
      let dx = 0, dz = 0;
      for (const w of plan.walls) {
        const vertical = Math.abs(w.b[0] - w.a[0]) < 1e-3, horizontal = Math.abs(w.b[1] - w.a[1]) < 1e-3, half = w.thickness / 2;
        if (vertical && !dx) {
          const c = w.a[0], lo = Math.min(w.a[1], w.b[1]), hi = Math.max(w.a[1], w.b[1]);
          if (Math.min(hi, f.z1) - Math.max(lo, f.z0) < .3) continue;
          const gap = c < cx ? f.x0 - (c + half) : (c - half) - f.x1;
          if (Math.abs(gap) > .001 && Math.abs(gap) <= .15) dx = c < cx ? -gap : gap;
        }
        if (horizontal && !dz) {
          const c = w.a[1], lo = Math.min(w.a[0], w.b[0]), hi = Math.max(w.a[0], w.b[0]);
          if (Math.min(hi, f.x1) - Math.max(lo, f.x0) < .3) continue;
          const gap = c < cz ? f.z0 - (c + half) : (c - half) - f.z1;
          if (Math.abs(gap) > .001 && Math.abs(gap) <= .15) dz = c < cz ? -gap : gap;
        }
      }
      if (!dx && !dz) break;
      s.x = r3(s.x + dx); s.z = r3(s.z + dz);
      moved.push(`Cầu thang ${s.id} dời ${dx ? `x ${(dx * 100).toFixed(1)} cm` : ''}${dx && dz ? ', ' : ''}${dz ? `z ${(dz * 100).toFixed(1)} cm` : ''} cho sát tường, hoặc để vậy (cạnh hở có lan can).`);
    }
  }
  return moved;
}

/** Wells the storey needs: exactly over each flight of the storey below (where none is drawn yet). */
export function wellsFor(doc: ModelDoc, plan: FloorPlan): FloorPlan['voids'] {
  const low = below(doc, plan);
  if (!low) return [];
  const out: FloorPlan['voids'] = [];
  for (const st of low.stairs) {
    const f = stairFootprint(st, stairRise(doc, low));
    const covered = plan.voids.some((v) => overlap(norm(v), f) > .5 * (f.x1 - f.x0) * (f.z1 - f.z0));
    if (!covered) out.push({ x0: r3(f.x0), z0: r3(f.z0), x1: r3(f.x1), z1: r3(f.z1) });
  }
  return out;
}
const DIRS: Record<FloorPlan['stairs'][number]['direction'], number> = { s: 0, e: Math.PI / 2, n: Math.PI, w: -Math.PI / 2 };

type Stair = FloorPlan['stairs'][number];

export function plansOf(doc: ModelDoc): FloorPlan[] { return [...(doc.plans ?? [])].sort((a, b) => a.level - b.level); }

/** The storey above (null for the top one). */
function above(doc: ModelDoc, plan: FloorPlan): FloorPlan | null { return plansOf(doc).find((p) => p.level === plan.level + 1) ?? null; }
function below(doc: ModelDoc, plan: FloorPlan): FloorPlan | null { return plansOf(doc).find((p) => p.level === plan.level - 1) ?? null; }

/** How high a flight on this storey climbs: to the next storey's floor, else one storey up. */
export function stairRise(doc: ModelDoc, plan: FloorPlan): number {
  const up = above(doc, plan);
  return up ? up.elevation - plan.elevation : plan.height + plan.slab;
}

/** Steps, run, riser and tread of a flight climbing `rise` (its own design, else the old defaults). */
export function stairCounts(rise: number, s?: Pick<Stair, 'riser' | 'tread'>): { steps: number; run: number; riser: number; tread: number } {
  const steps = Math.max(2, Math.ceil(rise / (s?.riser ?? RISER) - 1e-6)), tread = s?.tread ?? TREAD;
  return { steps, run: steps * tread, riser: rise / steps, tread };
}

/** Steps in each flight: one for a straight stair, two (the landing between) for L and U. */
function flightSteps(s: Stair, steps: number): number[] {
  if (s.shape === 'l' || s.shape === 'u') { const n1 = Math.ceil((steps - 1) / 2); return [n1, steps - 1 - n1]; }
  return s.shape === 'spiral' ? [] : [steps];
}

/**
 * Where each tread (and the landing) of a flight lies on the plan and how high it is above the
 * storey's floor — the same geometry the stairs are built with.
 */
export function stairTreads(s: Stair, rise: number): Array<{ x: number; z: number; y: number; landing?: boolean }> {
  const { steps, tread: g, riser: r } = stairCounts(rise, s), W = s.width / 2, turn = s.turn === 'left' ? -1 : 1;
  const yaw = DIRS[s.direction], c = Math.cos(yaw), sn = Math.sin(yaw);
  const tf = (x: number, z: number, y: number, landing?: boolean) => ({ x: s.x + x * c + z * sn, z: s.z - x * sn + z * c, y, ...(landing ? { landing } : {}) });
  const out: Array<{ x: number; z: number; y: number; landing?: boolean }> = [];
  if (s.shape === 'spiral') return out;
  if (s.shape === 'straight') { for (let i = 0; i < steps; i++) out.push(tf(0, (i + .5) * g, (i + 1) * r)); return out; }
  const [n1 = 0, n2 = 0] = flightSteps(s, steps), L = s.landing ?? s.width, lz = n1 * g;
  for (let i = 0; i < n1; i++) out.push(tf(0, (i + .5) * g, (i + 1) * r));
  if (s.shape === 'l') {
    out.push(tf(0, lz + L / 2, (n1 + 1) * r, true));
    for (let i = 0; i < n2; i++) out.push(tf(turn * (W + (i + .5) * g), lz + L / 2, (n1 + 2 + i) * r));
  } else {
    const off = turn * (s.width + (s.gap ?? .1));
    out.push(tf(off / 2, lz + L / 2, (n1 + 1) * r, true));
    for (let i = 0; i < n2; i++) out.push(tf(off, lz - (i + .5) * g, (n1 + 2 + i) * r));
  }
  return out;
}

/** The flight's footprint on the plan (axis-aligned box) and where you arrive at the top. */
export function stairFootprint(s: Stair, rise: number): { x0: number; z0: number; x1: number; z1: number; top: [number, number]; foot: [number, number]; landing?: [number, number] } {
  const { steps, tread: T } = stairCounts(rise, s), w = s.width, W = w / 2, turn = s.turn === 'left' ? -1 : 1;
  let lx0 = -W, lx1 = W, lz1 = steps * T, top: [number, number] = [0, steps * T + .6], landing: [number, number] | null = null;
  if (s.shape === 'l' || s.shape === 'u') {
    const n1 = Math.ceil((steps - 1) / 2), n2 = steps - 1 - n1, L = s.landing ?? w, gap = s.gap ?? .1;
    lz1 = n1 * T + L;
    landing = [s.shape === 'u' ? turn * (w + gap) / 2 : 0, n1 * T + L / 2];
    if (s.shape === 'l') {
      if (turn > 0) lx1 = W + n2 * T; else lx0 = -W - n2 * T;
      top = [turn * (W + n2 * T + .6), n1 * T + L / 2];
    } else {
      if (turn > 0) lx1 = W + w + gap; else lx0 = -W - w - gap;
      top = [turn * (w + gap), -.6];
    }
  } else if (s.shape === 'spiral') {
    const R = spiralRadius(w);
    lx0 = -R; lx1 = R; lz1 = 2 * R;
    top = [0, R];
  }
  const yaw = DIRS[s.direction], c = Math.cos(yaw), sn = Math.sin(yaw);
  const tf = (x: number, z: number): [number, number] => [s.x + x * c + z * sn, s.z - x * sn + z * c];
  const pts = [tf(lx0, 0), tf(lx1, 0), tf(lx1, lz1), tf(lx0, lz1)];
  return { x0: Math.min(...pts.map((p) => p[0])), x1: Math.max(...pts.map((p) => p[0])), z0: Math.min(...pts.map((p) => p[1])), z1: Math.max(...pts.map((p) => p[1])), top: tf(top[0], top[1]), foot: tf(0, -.6), ...(landing ? { landing: tf(landing[0], landing[1]) } : {}) };
}

const inside = (r: { x0: number; z0: number; x1: number; z1: number }, x: number, z: number, m = 0) => x >= Math.min(r.x0, r.x1) - m && x <= Math.max(r.x0, r.x1) + m && z >= Math.min(r.z0, r.z1) - m && z <= Math.max(r.z0, r.z1) + m;
const norm = (r: { x0: number; z0: number; x1: number; z1: number }) => ({ x0: Math.min(r.x0, r.x1), x1: Math.max(r.x0, r.x1), z0: Math.min(r.z0, r.z1), z1: Math.max(r.z0, r.z1) });
const overlap = (a: { x0: number; z0: number; x1: number; z1: number }, b: { x0: number; z0: number; x1: number; z1: number }) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0));

function distToSegment(px: number, pz: number, [ax, az]: [number, number], [bx, bz]: [number, number]): number {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
  const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2)) : 0;
  return Math.hypot(px - ax - dx * t, pz - az - dz * t);
}

/** Whether a segment crosses an axis-aligned rectangle (Liang–Barsky clipping). */
function segmentHitsRect(a: [number, number], b: [number, number], r: { x0: number; z0: number; x1: number; z1: number }): boolean {
  if (r.x1 <= r.x0 || r.z1 <= r.z0) return false;
  let t0 = 0, t1 = 1;
  const dx = b[0] - a[0], dz = b[1] - a[1];
  for (const [p, q] of [[-dx, a[0] - r.x0], [dx, r.x1 - a[0]], [-dz, a[1] - r.z0], [dz, r.z1 - a[1]]] as const) {
    if (Math.abs(p) < 1e-9) { if (q < 0) return false; continue; }
    const t = q / p;
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
  }
  return t0 < t1;
}

/** An architect's review of one storey's plan. */
export function checkPlan(doc: ModelDoc, plan: FloorPlan): PlanIssue[] {
  const issues: PlanIssue[] = [];
  const err = (message: string) => issues.push({ level: 'error', message }), warn = (message: string) => issues.push({ level: 'warning', message }), info = (message: string) => issues.push({ level: 'info', message });
  const rooms = plan.rooms.map((r) => ({ ...r, ...norm(r) }));
  if (!rooms.length) err('Bản vẽ chưa có phòng nào.');
  for (const r of rooms) {
    const w = r.x1 - r.x0, d = r.z1 - r.z0;
    if (w < 1.2 || d < 1.2) err(`Phòng "${r.name}" ${w.toFixed(1)}×${d.toFixed(1)} m — quá hẹp (cạnh ≥ 1.2 m).`);
  }
  // Pieces of one room (same name, an L-shaped room) may touch; different rooms must not overlap.
  for (let i = 0; i < rooms.length; i++) for (let j = i + 1; j < rooms.length; j++) {
    const a = rooms[i]!, b = rooms[j]!, o = overlap(a, b);
    if (o > .1 && a.name !== b.name) err(`Phòng "${a.name}" và "${b.name}" chồng lên nhau ${o.toFixed(1)} m².`);
  }
  // Walls and openings.
  for (const w of plan.walls) {
    const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]), h = w.height ?? plan.height;
    if (len < .2) { err(`Tường ${w.id} dài ${len.toFixed(2)} m — quá ngắn.`); continue; }
    if (w.kind === 'railing' && w.openings.length) err(`Lan can ${w.id} có lỗ mở: lan can không có cửa — chừa khoảng trống bằng cách tách lan can thành hai đoạn.`);
    for (const o of w.openings) {
      if (o.at - o.width / 2 < -.01 || o.at + o.width / 2 > len + .01) err(`Tường ${w.id}: ${o.kind} ở ${o.at.toFixed(2)} m (rộng ${o.width}) vượt ra ngoài tường dài ${len.toFixed(2)} m.`);
      if (o.sill + o.height > h + .01) err(`Tường ${w.id}: ${o.kind} cao tới ${(o.sill + o.height).toFixed(2)} m, quá trần ${h.toFixed(2)} m.`);
      if ((o.kind === 'door' || o.kind === 'arch') && (o.width < .82 || o.height < 1.95 || o.sill > .05)) err(`Tường ${w.id}: cửa ${o.width}×${o.height} m (bậu ${o.sill}) — người không đi qua được (≥ 0.82×1.95 m, bậu 0).`);
    }
    for (let i = 0; i < w.openings.length; i++) for (let j = i + 1; j < w.openings.length; j++) {
      const a = w.openings[i]!, b = w.openings[j]!;
      if (Math.abs(a.at - b.at) < (a.width + b.width) / 2 + .1 && a.sill < b.sill + b.height && b.sill < a.sill + a.height) err(`Tường ${w.id}: hai lỗ mở chồng nhau (ở ${a.at} và ${b.at} m).`);
    }
    // No opening cuts into a corner or the end of a wall meeting this one.
    const bands = junctionBands(plan.walls, w, 0);
    for (const o of w.openings) {
      const hit = bands.find((b) => o.at + o.width / 2 > b.lo + .01 && o.at - o.width / 2 < b.hi - .01);
      if (hit) err(`Tường ${w.id}: ${o.kind} ở ${o.at.toFixed(2)} m (rộng ${o.width}) cắt vào chỗ nối với tường ${hit.wall} (${hit.lo.toFixed(2)}–${hit.hi.toFixed(2)} m): dời ra khỏi góc.`);
    }
  }

  // Exterior walls form a closed outline.
  const ext = plan.walls.filter((w) => w.exterior);
  if (ext.length) {
    const ends = ext.flatMap((w) => [w.a, w.b]);
    const open = ends.filter((p) => ends.filter((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < Math.max(.3, ...ext.map((w) => w.thickness))).length < 2);
    if (open.length) warn(`Tường ngoài hở ở ${open.slice(0, 4).map((p) => `(${p[0]}, ${p[1]})`).join(', ')} — đầu tường không nối với tường nào.`);
  } else if (plan.walls.length) warn('Chưa có tường ngoài (exterior: true).');
  // Every room edge lies along a wall, or opens onto another room (an open plan).
  const covered = (x: number, z: number) => plan.walls.some((w) => distToSegment(x, z, w.a, w.b) <= w.thickness / 2 + .2);
  const shared = (x: number, z: number, self: number) => rooms.some((o, k) => k !== self && inside(o, x, z, .05));
  rooms.forEach((r, k) => {
    const edges: Array<[string, Array<[number, number]>]> = [
      ['phía -z', Array.from({ length: 9 }, (_, i) => [r.x0 + (r.x1 - r.x0) * (i + .5) / 9, r.z0] as [number, number])],
      ['phía +z', Array.from({ length: 9 }, (_, i) => [r.x0 + (r.x1 - r.x0) * (i + .5) / 9, r.z1] as [number, number])],
      ['phía -x', Array.from({ length: 9 }, (_, i) => [r.x0, r.z0 + (r.z1 - r.z0) * (i + .5) / 9] as [number, number])],
      ['phía +x', Array.from({ length: 9 }, (_, i) => [r.x1, r.z0 + (r.z1 - r.z0) * (i + .5) / 9] as [number, number])],
    ];
    for (const [side, pts] of edges) {
      const bare = pts.filter(([x, z]) => !covered(x, z) && !shared(x, z, k)).length;
      // Above the ground an open edge is a drop: it needs a wall or a railing (kind: railing). On the ground it may stay open.
      if (bare > 3) (plan.elevation > 1 ? err : warn)(`Phòng "${r.name}" ${plan.elevation > 1 ? 'hở cạnh' : 'thiếu tường'} ${side} (${Math.round(bare / 9 * 100)}% cạnh không có tường, lan can hay phòng bên cạnh)${plan.elevation > 1 ? ' ở trên cao: người chơi rơi xuống — thêm tường hoặc lan can (walls kind railing / rooms open)' : ''}.`);
    }
  });
  // Reachability through doors (and open edges between rooms).
  const OUT = -1, links = new Map<number, Set<number>>();
  const link = (a: number, b: number) => { if (a === b) return; (links.get(a) ?? links.set(a, new Set()).get(a)!).add(b); (links.get(b) ?? links.set(b, new Set()).get(b)!).add(a); };
  const roomAt = (x: number, z: number) => rooms.findIndex((r) => inside(r, x, z));
  for (const w of plan.walls) {
    const dx = w.b[0] - w.a[0], dz = w.b[1] - w.a[1], len = Math.hypot(dx, dz) || 1, nx = -dz / len, nz = dx / len, off = w.thickness / 2 + .3;
    for (const o of w.openings) {
      if (o.kind === 'window' || o.sill > .3) continue;
      const px = w.a[0] + dx / len * o.at, pz = w.a[1] + dz / len * o.at;
      const r1 = roomAt(px + nx * off, pz + nz * off), r2 = roomAt(px - nx * off, pz - nz * off);
      link(r1 < 0 && w.exterior ? OUT : r1, r2 < 0 && w.exterior ? OUT : r2);
    }
  }
  rooms.forEach((a, i) => rooms.forEach((b, j) => {
    if (j <= i) return;
    // Pieces of one room, or rooms meeting along an edge with no wall on it.
    const touch = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > -.01 && Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0) > -.01;
    if (!touch) return;
    if (a.name === b.name) { link(i, j); return; }
    const cx = (Math.max(a.x0, b.x0) + Math.min(a.x1, b.x1)) / 2, cz = (Math.max(a.z0, b.z0) + Math.min(a.z1, b.z1)) / 2;
    if (!covered(cx, cz)) link(i, j);
  }));
  const starts = new Set<number>();
  const low = below(doc, plan);
  if (plan.level === 0 || !low) starts.add(OUT);
  if (low) for (const s of low.stairs) { const k = roomAt(...stairFootprint(s, stairRise(doc, low)).top); if (k >= 0) starts.add(k); }
  if (plan.level !== 0 && low && !low.stairs.length) warn(`Tầng dưới (${low.name}) không có cầu thang lên tầng này.`);
  if (plan.level === 0 && !plan.walls.some((w) => w.exterior && w.openings.some((o) => o.kind !== 'window' && o.sill <= .3))) err('Tầng trệt chưa có cửa ra vào ở tường ngoài.');
  if (starts.size) {
    const seen = new Set(starts), queue = [...starts];
    while (queue.length) for (const n of links.get(queue.shift()!) ?? []) if (!seen.has(n)) { seen.add(n); queue.push(n); }
    const lost = [...new Set(rooms.filter((_, i) => !seen.has(i)).map((r) => r.name))];
    if (lost.length) err(`Không đi tới được: ${lost.join(', ')} (thêm cửa ở tường chung với phòng đã tới được${plan.level ? ' hoặc nơi cầu thang lên' : ''}).`);
  }
  // Stairs: inside the rooms, a well above them.
  const up = above(doc, plan);
  for (const s of plan.stairs) {
    const rise = stairRise(doc, plan), { steps } = stairCounts(rise, s), f = stairFootprint(s, rise);
    const corners: Array<[number, number]> = [[f.x0, f.z0], [f.x1, f.z0], [f.x1, f.z1], [f.x0, f.z1]];
    if (corners.some(([x, z]) => !rooms.some((r) => inside(r, x, z, .05)))) warn(`Cầu thang ${s.id} (${s.shape}, ${steps} bậc, chiếm ${(f.x1 - f.x0).toFixed(1)}×${(f.z1 - f.z0).toFixed(1)} m từ (${f.x0.toFixed(1)}, ${f.z0.toFixed(1)})) lấn ra ngoài các phòng.`);
    const probs = stairProblems(doc, plan, s);
    if (probs.includes('foot')) err(`Chân cầu thang ${s.id} (${f.foot.map((v) => v.toFixed(1)).join(', ')}) sát tường hoặc ngoài phòng: không bước lên được — xoay hướng (direction) cho chân thang quay ra phòng.`);
    if (!up && probs.includes('top')) err(`Đầu trên cầu thang ${s.id} (${f.top.map((v) => v.toFixed(1)).join(', ')}) đâm vào tường hoặc ra ngoài mặt bằng: cầu thang bị ngược — xoay hướng (direction) hoặc chiều quay (turn).`);
    if (probs.includes('door')) err(`Cửa ở tường ${doorsOnFlight(plan, f).join(', ')} mở ra trùng cầu thang ${s.id}: cánh cửa và lối bước qua cửa cần ≥ 0.5 m sàn trống — dời cửa hoặc cầu thang.`);
    if (probs.includes('approach')) info(`Bậc đầu cầu thang ${s.id} quay lưng với lối vào buồng thang (chân thang ${f.foot.map((v) => v.toFixed(1)).join(', ')}): xoay hướng (direction) để bậc đầu nhìn ra cửa/lối tiếp cận.`);
    for (const m of stairDesignProblems(doc, plan, s)) err(`Cầu thang ${s.id}: ${m}.`);
    if (!up) info(`Cầu thang ${s.id} lên tầng ${plan.level + 1} chưa có bản vẽ.`);
    else {
      const well = up.voids.reduce((sum, v) => sum + overlap(norm(v), f), 0), need = (f.x1 - f.x0) * (f.z1 - f.z0);
      if (well < need * .6) err(`Tầng trên (${up.name}) chưa chừa giếng thang trên cầu thang ${s.id}: thêm voids ~[${f.x0.toFixed(1)}, ${f.z0.toFixed(1)}] → [${f.x1.toFixed(1)}, ${f.z1.toFixed(1)}].`);
      const arrive = up.rooms.some((r) => inside(norm(r), f.top[0], f.top[1], -.15));
      if (!arrive) err(`Đầu trên cầu thang ${s.id} (${f.top.map((v) => v.toFixed(1)).join(', ')}) không rơi vào phòng nào của tầng trên (hoặc sát tường): người lên tới nơi bị kẹt — dời/xoay cầu thang.`);
    }
  }
  if (low) for (const s of low.stairs) {
    const f = stairFootprint(s, stairRise(doc, low)), need = (f.x1 - f.x0) * (f.z1 - f.z0);
    if (plan.voids.reduce((sum, v) => sum + overlap(norm(v), f), 0) < need * .6) err(`Thiếu giếng thang trên cầu thang ${s.id} của tầng dưới: thêm voids [${f.x0.toFixed(2)}, ${f.z0.toFixed(2)}] → [${f.x1.toFixed(2)}, ${f.z1.toFixed(2)}].`);
    // A well bigger than the flight leaves a hole beside the last steps.
    for (const v of plan.voids.map(norm)) {
      if (overlap(v, f) < need * .3) continue;
      const over = [f.x0 - v.x0, v.x1 - f.x1, f.z0 - v.z0, v.z1 - f.z1];
      if (Math.max(...over) > .06) err(`Giếng thang [${v.x0.toFixed(2)}, ${v.z0.toFixed(2)}] → [${v.x1.toFixed(2)}, ${v.z1.toFixed(2)}] rộng hơn cầu thang ${s.id} (khe hở tới ${(Math.max(...over) * 100).toFixed(0)} cm): sửa đúng bằng [${f.x0.toFixed(2)}, ${f.z0.toFixed(2)}] → [${f.x1.toFixed(2)}, ${f.z1.toFixed(2)}].`);
    }
  }
  // Two flights never share the floor.
  for (let i = 0; i < plan.stairs.length; i++) for (let j = i + 1; j < plan.stairs.length; j++) {
    const a = plan.stairs[i]!, b = plan.stairs[j]!, o = overlap(stairFootprint(a, stairRise(doc, plan)), stairFootprint(b, stairRise(doc, plan)));
    if (o > .01) err(`Cầu thang ${a.id} và ${b.id} chồng lên nhau ${o.toFixed(2)} m².`);
  }
  // No wall runs through a flight.
  for (const s of plan.stairs) {
    const f = stairFootprint(s, stairRise(doc, plan)), inset = { x0: f.x0 + .05, z0: f.z0 + .05, x1: f.x1 - .05, z1: f.z1 - .05 };
    for (const w of plan.walls) if (segmentHitsRect(w.a, w.b, inset)) err(`Cầu thang ${s.id} (chiếm [${f.x0.toFixed(2)}, ${f.z0.toFixed(2)}] → [${f.x1.toFixed(2)}, ${f.z1.toFixed(2)}]) cắt qua tường ${w.id}: đổi hướng (direction), chiều quay (turn) hoặc vị trí cho nằm gọn trong buồng thang.`);
  }
  // Flights stand against the walls beside them: no slot between stair and wall, no stair in a wall.
  for (const s of plan.stairs) {
    const f = stairFootprint(s, stairRise(doc, plan)), cx = (f.x0 + f.x1) / 2, cz = (f.z0 + f.z1) / 2;
    for (const w of plan.walls) {
      const vertical = Math.abs(w.b[0] - w.a[0]) < 1e-3, horizontal = Math.abs(w.b[1] - w.a[1]) < 1e-3;
      if (!vertical && !horizontal) continue;
      const half = w.thickness / 2;
      if (vertical) {
        const c = w.a[0], lo = Math.min(w.a[1], w.b[1]), hi = Math.max(w.a[1], w.b[1]);
        if (Math.min(hi, f.z1) - Math.max(lo, f.z0) < .3) continue;
        const gap = c < cx ? f.x0 - (c + half) : (c - half) - f.x1;
        if (gap < -.02 && (c < cx ? c - half < f.x0 : c + half > f.x1)) err(`Cầu thang ${s.id} lấn ${(-gap * 100).toFixed(0)} cm vào tường ${w.id}: dời x của cầu thang ${c < cx ? '+' : '−'}${(-gap).toFixed(2)} m.`);
        else if (gap > .02 && gap < .6) info(`Khe hở ${(gap * 100).toFixed(0)} cm giữa cầu thang ${s.id} và tường ${w.id}: dời x của cầu thang ${c < cx ? '−' : '+'}${gap.toFixed(2)} m (tới ${(s.x + (c < cx ? -gap : gap)).toFixed(2)}) cho sát tường, hoặc để vậy (cạnh hở có lan can).`);
      } else {
        const c = w.a[1], lo = Math.min(w.a[0], w.b[0]), hi = Math.max(w.a[0], w.b[0]);
        if (Math.min(hi, f.x1) - Math.max(lo, f.x0) < .3) continue;
        const gap = c < cz ? f.z0 - (c + half) : (c - half) - f.z1;
        if (gap < -.02 && (c < cz ? c - half < f.z0 : c + half > f.z1)) err(`Cầu thang ${s.id} lấn ${(-gap * 100).toFixed(0)} cm vào tường ${w.id}: dời z của cầu thang ${c < cz ? '+' : '−'}${(-gap).toFixed(2)} m.`);
        else if (gap > .02 && gap < .6) info(`Khe hở ${(gap * 100).toFixed(0)} cm giữa cầu thang ${s.id} và tường ${w.id}: dời z của cầu thang ${c < cz ? '−' : '+'}${gap.toFixed(2)} m (tới ${(s.z + (c < cz ? -gap : gap)).toFixed(2)}) cho sát tường, hoặc để vậy (cạnh hở có lan can).`);
      }
    }
  }
  // Every material of the plan comes from the schedule decided first.
  const scheduled = new Set((doc.schedule ?? []).map((x) => x.material));
  if (!scheduled.size) err('Chưa có bảng vật liệu: define_materials trước (liệt kê mọi vật liệu và nơi dùng).');
  else {
    const named = new Set<string>([
      ...plan.rooms.flatMap((r) => (r.floorMaterial ? [r.floorMaterial] : [])),
      ...plan.walls.flatMap((w) => [w.material, w.innerMaterial, w.plinthMaterial, ...w.openings.flatMap((o) => [o.frameMaterial, o.glassMaterial, o.leafMaterial, o.sillMaterial])]),
      ...plan.stairs.flatMap((st) => [st.material, st.treadMaterial, st.railMaterial, st.handrailMaterial]),
      ...Object.entries(plan.finishes ?? {}).filter(([k]) => k !== 'plinthHeight').map(([, v]) => v as string),
      plan.ceilingMaterial,
    ].filter((x): x is string => !!x));
    const missing = [...named].filter((m) => !scheduled.has(m));
    if (missing.length) err(`Vật liệu chưa có trong bảng vật liệu: ${missing.join(', ')} (thêm bằng define_materials).`);
  }
  if (low && Math.abs(plan.elevation - (low.elevation + low.height + plan.slab)) > .05) warn(`Cao độ ${plan.elevation} m không khớp tầng dưới (${(low.elevation + low.height + plan.slab).toFixed(2)} m = sàn dưới + chiều cao + sàn này).`);
  return issues;
}

/** Plan figures for the agent (areas, what it will build). */
export function planSummary(doc: ModelDoc, plan: FloorPlan) {
  const area = plan.rooms.reduce((s, r) => s + Math.abs((r.x1 - r.x0) * (r.z1 - r.z0)), 0);
  return {
    level: plan.level, name: plan.name, elevation: plan.elevation, height: plan.height,
    rooms: plan.rooms.map((r) => `${r.name} ${Math.abs((r.x1 - r.x0) * (r.z1 - r.z0)).toFixed(1)} m²`), totalArea: +area.toFixed(1),
    walls: plan.walls.length, doors: plan.walls.reduce((s, w) => s + w.openings.filter((o) => o.kind !== 'window').length, 0), windows: plan.walls.reduce((s, w) => s + w.openings.filter((o) => o.kind === 'window').length, 0),
    stairs: plan.stairs.map((s) => { const f = stairFootprint(s, stairRise(doc, plan)), c = stairCounts(stairRise(doc, plan), s); return { id: s.id, shape: s.shape, style: s.style, steps: c.steps, riser: +c.riser.toFixed(3), tread: c.tread, ...(s.landing ? { landing: s.landing } : {}), footprint: [f.x0, f.z0, f.x1, f.z1].map((v) => +v.toFixed(2)), arrivesAt: f.top.map((v) => +v.toFixed(2)) }; }),
    built: !!plan.built,
  };
}

/** A material id the plan names: an existing material, else one made from the preset of that name. */
function ensureMaterial(doc: ModelDoc, id: string): string {
  if (doc.materials.some((m) => m.id === id)) return id;
  doc.materials.push(materialFromPreset(id, matchPreset(id).id));
  return id;
}

/**
 * Builds a storey exactly as drawn: a slab per room (stairwell voids cut out), every wall with
 * its openings (exterior walls run down through the slab), every flight of stairs. A storey
 * built before is replaced. Returns the group made.
 */
export function buildPlan(doc: ModelDoc, plan: FloorPlan): { group: string; parts: number } {
  if (plan.built) {
    const gone = new Set(subtree(doc, plan.built).map((n) => n.id));
    doc.nodes = doc.nodes.filter((n) => !gone.has(n.id));
  }
  const b = new DocBuilder(doc), before = doc.nodes.length;
  const g = b.group(`Tầng ${plan.level + 1}: ${plan.name}`, null, {}, { tags: ['storey', `level:${plan.level}`] });
  const e = plan.elevation, t = plan.slab;
  const floorG = b.group('Sàn', g), wallsG = b.group('Tường', g);
  for (const r of plan.rooms) {
    const q = norm(r), w = q.x1 - q.x0, d = q.z1 - q.z0, cx = (q.x0 + q.x1) / 2, cz = (q.z0 + q.z1) / 2;
    const holes = plan.voids.map(norm).filter((v) => overlap(v, q) > 0).map((v) => {
      const x0 = Math.max(v.x0, q.x0), x1 = Math.min(v.x1, q.x1), z0 = Math.max(v.z0, q.z0), z1 = Math.min(v.z1, q.z1);
      return { x: (x0 + x1) / 2 - cx, z: (z0 + z1) / 2 - cz, width: x1 - x0, depth: z1 - z0 };
    });
    const slabId = b.slab(`Sàn ${r.name}`, floorG, w, d, t, holes, ensureMaterial(doc, r.floorMaterial ?? 'concrete'), { position: [cx, e - t, cz] });
    if (plan.ceilingMaterial) { const n = doc.nodes.find((x) => x.id === slabId); if (n && n.kind === 'slab') n.bottomMaterial = ensureMaterial(doc, plan.ceilingMaterial); }
  }
  // Exterior walls show their outer material outside, whichever way they were drawn.
  const cx0 = plan.rooms.reduce((s, r) => s + (r.x0 + r.x1) / 2, 0) / Math.max(1, plan.rooms.length);
  const cz0 = plan.rooms.reduce((s, r) => s + (r.z0 + r.z1) / 2, 0) / Math.max(1, plan.rooms.length);
  for (const drawn of plan.walls) {
    let w = drawn;
    {
      const dx = w.b[0] - w.a[0], dz = w.b[1] - w.a[1], th = Math.atan2(-dz, dx);
      const mx = (w.a[0] + w.b[0]) / 2 - cx0, mz = (w.a[1] + w.b[1]) / 2 - cz0;
      if (w.exterior && Math.sin(th) * mx + Math.cos(th) * mz < 0) {
        const len = Math.hypot(dx, dz);
        w = { ...w, a: w.b, b: w.a, openings: w.openings.map((o) => ({ ...o, at: len - o.at })) };
      }
    }
    const dx = w.b[0] - w.a[0], dz = w.b[1] - w.a[1], len = Math.hypot(dx, dz);
    if (len < .05) continue;
    if (w.kind === 'railing') { guardRun(b, wallsG, w.a, w.b, e, stairRules(doc).guard, ensureMaterial(doc, w.material), ensureMaterial(doc, w.innerMaterial ?? w.material), 'Lan can'); continue; }
    const h = w.height ?? plan.height, base = w.exterior ? e - t : e, extra = w.exterior ? t : 0;
    const openings: Opening[] = w.openings.map((o) => ({ kind: o.kind, offset: o.at - len / 2, width: o.width, height: o.height, sill: o.sill + extra }));
    const wallId = b.wall(w.exterior ? 'Tường ngoài' : 'Vách', wallsG, len, h + extra, w.thickness, openings, ensureMaterial(doc, w.material),
      { position: [(w.a[0] + w.b[0]) / 2, base, (w.a[1] + w.b[1]) / 2], rotation: [0, Math.atan2(-dz, dx), 0] }, w.innerMaterial ? ensureMaterial(doc, w.innerMaterial) : undefined);
    wallParts(b, doc, plan, w, wallId, len, extra);
  }
  for (const s of plan.stairs) {
    const rise = stairRise(doc, plan), { steps, run } = stairCounts(rise, s);
    const id = b.stairs(`Cầu thang ${s.id}`, g, s.width, rise, run, steps, ensureMaterial(doc, s.material), { position: [s.x, e, s.z], rotation: [0, DIRS[s.direction], 0] });
    const n = doc.nodes.find((x) => x.id === id);
    if (n && n.kind === 'stairs') Object.assign(n, {
      shape: s.shape, style: s.style, ...(s.turn ? { turn: s.turn } : {}), railing: s.railing ?? true, ...(s.railing !== false && s.shape !== 'spiral' ? { rails: railSides(doc, plan, s) } : {}),
      ...(s.landing && (s.shape === 'l' || s.shape === 'u') ? { landing: s.landing } : {}), ...(s.gap && s.shape === 'u' ? { gap: s.gap } : {}),
      ...(s.treadMaterial ? { treadMaterial: ensureMaterial(doc, s.treadMaterial) } : {}),
      ...(s.railMaterial ? { railMaterial: ensureMaterial(doc, s.railMaterial) } : {}),
      ...(s.handrailMaterial ? { handrailMaterial: ensureMaterial(doc, s.handrailMaterial) } : {}),
    });
  }
  // A balustrade round each stairwell, where no wall closes it and nobody steps off the flight.
  const guards = wellGuards(doc, plan);
  if (guards.length) {
    const low = below(doc, plan), from = low?.stairs[0], rules = stairRules(doc);
    const m = ensureMaterial(doc, from?.railMaterial ?? from?.material ?? 'metal_steel'), hm = ensureMaterial(doc, from?.handrailMaterial ?? from?.railMaterial ?? from?.material ?? 'metal_steel');
    const gg = b.group('Lan can giếng thang', g, {}, { tags: ['well-guard'] });
    for (const { a, b: c } of guards) guardRun(b, gg, a, c, e, rules.guard, m, hm, 'Đoạn lan can');
  }
  plan.built = g;
  return { group: g, parts: doc.nodes.length - before };
}

/** A balustrade from a to c at floor level y: handrail, mid rail, kick plate, posts about every metre, balusters 11 cm apart. */
function guardRun(b: DocBuilder, parent: string, a: [number, number], c: [number, number], y: number, height: number, m: string, hm: string, name: string): void {
  const len = Math.hypot(c[0] - a[0], c[1] - a[1]), rot: [number, number, number] = [0, Math.atan2(-(c[1] - a[1]), c[0] - a[0]), 0];
  const seg = b.group(name, parent, { position: [(a[0] + c[0]) / 2, y, (a[1] + c[1]) / 2], rotation: rot }, { tags: ['railing'] });
  b.box('Tay vịn', seg, [-len / 2, height - .05, -.03], [len / 2, height, .03], hm);
  b.box('Thanh giữa', seg, [-len / 2, height / 2, -.015], [len / 2, height / 2 + .03, .015], m);
  b.box('Gờ chân', seg, [-len / 2, 0, -.01], [len / 2, .1, .01], m);
  const posts = Math.max(1, Math.ceil(len / 1));
  for (let k = 0; k <= posts; k++) { const x = -len / 2 + len * k / posts; b.box('Trụ', seg, [x - .025, 0, -.025], [x + .025, height - .05, .025], m); }
  // Balusters 11 cm apart: nobody slips through.
  for (let x = -len / 2 + .11; x < len / 2 - .05; x += .11) b.box('Song', seg, [x - .008, .1, -.008], [x + .008, height / 2, .008], m, { collision: 'none' });
  for (let x = -len / 2 + .11; x < len / 2 - .05; x += .11) b.box('Song', seg, [x - .008, height / 2 + .03, -.008], [x + .008, height - .05, .008], m, { collision: 'none' });
}

/** Runs along a wall (local x, centred) minus the openings that reach the floor. */
function runs(len: number, openings: Array<{ at: number; width: number; sill: number; kind: string }>, from = 0): Array<[number, number]> {
  const cuts = openings.filter((o) => o.kind !== 'window' && o.sill <= from + .05).map((o) => [o.at - len / 2 - o.width / 2, o.at - len / 2 + o.width / 2] as [number, number]).sort((a, c) => a[0] - c[0]);
  const out: Array<[number, number]> = [];
  let x = -len / 2;
  for (const [a, c] of cuts) { if (a - x > .05) out.push([x, a]); x = Math.max(x, c); }
  if (len / 2 - x > .05) out.push([x, len / 2]);
  return out;
}

/**
 * The parts a wall carries, each in its own material: window frames, glazing and sills, door
 * frames and leaves (ajar, they do not block the way), the exterior plinth and the skirting
 * along the floor on the room sides. In the wall's own space (x along, +z its outer face).
 */
function wallParts(b: DocBuilder, doc: ModelDoc, plan: FloorPlan, w: FloorPlan['walls'][number], wallId: string, len: number, extra: number): void {
  const f = plan.finishes ?? {}, t = w.thickness, half = t / 2;
  const m = (id: string | undefined, fallback: string) => ensureMaterial(doc, id ?? fallback);
  const seed = [...w.id].reduce((h, c) => h * 31 + c.charCodeAt(0), 7);
  // Openings were flipped with the wall when it was turned outside: positions in wall space.
  for (const [k, o] of w.openings.entries()) {
    const x = o.at - len / 2, W = o.width, y0 = o.sill + extra, y1 = y0 + o.height, fw = .06;
    if (o.kind === 'window') {
      const g = b.group('Cửa sổ', wallId, {}, { tags: ['window'] }), frame = m(o.frameMaterial ?? f.windowFrame, 'wood_oak'), fd = Math.min(t, .08);
      b.box('Khung trái', g, [x - W / 2, y0, -fd / 2], [x - W / 2 + fw, y1, fd / 2], frame);
      b.box('Khung phải', g, [x + W / 2 - fw, y0, -fd / 2], [x + W / 2, y1, fd / 2], frame);
      b.box('Khung trên', g, [x - W / 2 + fw, y1 - fw, -fd / 2], [x + W / 2 - fw, y1, fd / 2], frame);
      b.box('Khung dưới', g, [x - W / 2 + fw, y0, -fd / 2], [x + W / 2 - fw, y0 + fw, fd / 2], frame);
      if (W > 1.1) b.box('Đố giữa', g, [x - .025, y0 + fw, -fd / 2 + .01], [x + .025, y1 - fw, fd / 2 - .01], frame);
      b.box('Kính', g, [x - W / 2 + fw, y0 + fw, -.006], [x + W / 2 - fw, y1 - fw, .006], m(o.glassMaterial ?? f.glass, 'glass'));
      if (w.exterior && (o.sillMaterial ?? f.sill)) b.box('Bậu cửa sổ', g, [x - W / 2 - .05, y0 - .04, 0], [x + W / 2 + .05, y0, half + .05], m(o.sillMaterial ?? f.sill, 'concrete'));
    } else if (o.kind === 'door' || o.kind === 'arch') {
      const g = b.group(o.kind === 'door' ? 'Cửa đi' : 'Cửa vòm', wallId, {}, { tags: ['door'] }), frame = m(o.frameMaterial ?? f.doorFrame, 'wood_oak'), fd = t + .02;
      b.box('Khuôn trái', g, [x - W / 2, y0, -fd / 2], [x - W / 2 + fw, y1, fd / 2], frame, { collision: 'none' });
      b.box('Khuôn phải', g, [x + W / 2 - fw, y0, -fd / 2], [x + W / 2, y1, fd / 2], frame, { collision: 'none' });
      b.box('Khuôn trên', g, [x - W / 2, y1 - fw, -fd / 2], [x + W / 2, y1, fd / 2], frame);
      if (o.kind === 'door' && o.leaf !== false) {
        // Hinged on one jamb, ajar into the room side (−z): a varied angle per door unless set.
        const open = (o.open ?? 25 + ((seed + k * 53) % 60)) * Math.PI / 180, lw = W - 2 * fw - .01, lh = o.height - fw - .02;
        const hinge = b.group('Cánh cửa', g, { position: [x - W / 2 + fw, y0 + .01, -half + .02], rotation: [0, open, 0] });
        b.box('Cánh', hinge, [0, 0, -.02], [lw, lh, .02], m(o.leafMaterial ?? f.doorLeaf, 'wood_oak'), { collision: 'none' });
        b.box('Tay nắm', hinge, [lw - .12, lh * .47, -.05], [lw - .06, lh * .47 + .03, .05], ensureMaterial(doc, 'metal_steel'), { collision: 'none' });
      }
    }
  }
  // Plinth on the outer face (exterior walls), skirting on the room faces.
  const plinth = w.plinthMaterial ?? f.plinth;
  if (w.exterior && plinth) {
    const ph = f.plinthHeight ?? .45;
    for (const [x0, x1] of runs(len, w.openings, extra)) b.box('Chân tường', wallId, [x0, 0, half], [x1, extra + ph, half + .02], m(plinth, 'concrete'));
  }
  if (f.skirting) {
    for (const side of w.exterior ? [-1] : [-1, 1]) for (const [x0, x1] of runs(len, w.openings, extra))
      b.box('Len chân tường', wallId, [x0, extra, side < 0 ? -half - .012 : half], [x1, extra + .09, side < 0 ? -half : half + .012], m(f.skirting, 'wood_oak'), { collision: 'none' });
  }
}
