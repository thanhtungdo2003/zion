import { DocBuilder } from './build';
import { subtree, type FloorPlan, type ModelDoc } from './doc';
import { materialFromPreset, matchPreset } from './materials';
const PLAN_GRID = .05;

/**
 * Deterministic layout steps that turn a room program into exact geometry, so the model does not
 * have to write wall and opening coordinates by hand (the part it gets wrong most):
 *
 * - bays → rooms: rooms named by column/row bays between guide lines tile without gaps or
 *   overlaps (after wadi's span layout, floor-planner/src/spans.js);
 * - seam snapping: room edges that nearly line up are moved onto one seam (after Text2Floorplan's
 *   `_cluster_1d` / `snap_global_seams`);
 * - walls from rooms: every room edge becomes a wall, shared edges once, single-owner edges
 *   exterior (after Text2Floorplan's revit_geometry and wadi's wallsFromGraph);
 * - doors from links: one opening per linked pair on their shared wall, clear of corners and
 *   other openings, and the plan repaired until every room is reachable (after wadi's placeDoor,
 *   Text2Floorplan's door rules and _repair_connectivity, and Procedural-Building-Generator's
 *   island merging);
 * - windows by façade bays: each exterior run is cut at corners and partition junctions and
 *   filled with evenly repeated bays, skipping doors and lining up with the storey below (CGA
 *   shape grammar comp / repeat / occlusion / snap lines, Müller et al. 2006; sills and sizes per
 *   room type after Text2Floorplan);
 * - a roof from the footprint: the top storey's outline cut into rectangles, each roofed at one
 *   pitch so wings meet in valleys, gable ends closed where they are open.
 *
 * All of it is plain geometry on axis-aligned rectangles; the plan checks still run on the result.
 */

type Room = FloorPlan['rooms'][number];
type Wall = FloorPlan['walls'][number];
type Rect = { x0: number; z0: number; x1: number; z1: number };
const EPS = .01;
const snap = (v: number) => Math.round(Math.round(v / PLAN_GRID) * PLAN_GRID * 1000) / 1000;
const norm = <T extends Rect>(r: T): T => ({ ...r, x0: Math.min(r.x0, r.x1), x1: Math.max(r.x0, r.x1), z0: Math.min(r.z0, r.z1), z1: Math.max(r.z0, r.z1) });

// ---------------------------------------------------------------------------------------------
// Bays → rooms

export type Bay = { size?: number; flex?: number };
/** Guide-line positions along one axis: fixed bays keep their size, flexible bays share the rest by weight. */
export function bayLines(bays: Bay[], total?: number): number[] {
  const fixed = bays.reduce((s, b) => s + (b.size ?? 0), 0), weight = bays.reduce((s, b) => s + (b.size != null ? 0 : b.flex ?? 1), 0);
  const rest = Math.max(0, (total ?? fixed) - fixed), pos = [0];
  for (const b of bays) pos.push(pos[pos.length - 1]! + (b.size ?? (weight ? rest * (b.flex ?? 1) / weight : 0)));
  return pos.map(snap);
}

/**
 * Rooms given by bay ranges ({cols: [i, j], rows: [k, l]}: from guide line i to j across, k to l
 * down) get their coordinates; rooms with coordinates pass through.
 */
export function roomsFromBays(rooms: Array<Record<string, unknown>>, grid: { cols: Bay[]; rows: Bay[]; width?: number; depth?: number; x?: number; z?: number }): Array<Record<string, unknown>> {
  const X = bayLines(grid.cols, grid.width).map((v) => snap(v + (grid.x ?? 0))), Z = bayLines(grid.rows, grid.depth).map((v) => snap(v + (grid.z ?? 0)));
  return rooms.map((r) => {
    const c = r.cols, w = r.rows;
    if (!Array.isArray(c) || !Array.isArray(w)) return r;
    const [c0, c1] = c.map(Number), [w0, w1] = w.map(Number);
    if (!(c0! >= 0 && c1! > c0! && c1! < X.length && w0! >= 0 && w1! > w0! && w1! < Z.length)) throw new Error(`Phòng ${String(r.id ?? r.name)}: cols/rows ngoài lưới (cột 0–${X.length - 1}, hàng 0–${Z.length - 1}).`);
    const { cols: _c, rows: _r, ...rest } = r;
    return { ...rest, x0: X[c0!], x1: X[c1!], z0: Z[w0!], z1: Z[w1!] };
  });
}

// ---------------------------------------------------------------------------------------------
// Seam snapping

function clusters(values: number[], tol: number): number[] {
  const s = [...values].sort((a, b) => a - b), groups: number[][] = [];
  for (const v of s) {
    const g = groups[groups.length - 1];
    if (g && v - g[g.length - 1]! <= tol) g.push(v); else groups.push([v]);
  }
  return groups.map((g) => snap(g.reduce((a, b) => a + b, 0) / g.length));
}

function overlapArea(rooms: Rect[]): number {
  let s = 0;
  for (let i = 0; i < rooms.length; i++) for (let j = i + 1; j < rooms.length; j++) {
    const a = norm(rooms[i]!), b = norm(rooms[j]!);
    s += Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0));
  }
  return s;
}

/**
 * Room edges within `tol` of each other are moved onto one seam (their mean, on the grid), so
 * 2.95 / 3.0 / 3.05 become one wall line. Undone when it would make rooms overlap more.
 */
export function snapSeams<T extends Rect>(rooms: T[], tol = .15): { rooms: T[]; moved: number } {
  const xs = clusters(rooms.flatMap((r) => [r.x0, r.x1]), tol), zs = clusters(rooms.flatMap((r) => [r.z0, r.z1]), tol);
  const near = (c: number[], v: number) => { const t = c.reduce((b, x) => (Math.abs(x - v) < Math.abs(b - v) ? x : b), c[0]!); return Math.abs(t - v) <= tol ? t : v; };
  let moved = 0;
  const next = rooms.map((r) => {
    const q = { ...r, x0: near(xs, r.x0), x1: near(xs, r.x1), z0: near(zs, r.z0), z1: near(zs, r.z1) };
    if (q.x0 !== r.x0 || q.x1 !== r.x1 || q.z0 !== r.z0 || q.z1 !== r.z1) moved++;
    return q;
  });
  if (next.some((r) => Math.abs(r.x1 - r.x0) < .3 || Math.abs(r.z1 - r.z0) < .3) || overlapArea(next) > overlapArea(rooms) + 1e-6) return { rooms, moved: 0 };
  return { rooms: next, moved };
}

// ---------------------------------------------------------------------------------------------
// Walls from rooms

export type WallSpec = { exterior?: { thickness?: number; material?: string; innerMaterial?: string }; interior?: { thickness?: number; material?: string }; railing?: { material?: string; handrail?: string } };

/** Rooms open to the air on their outer edges (a railing, not a wall, where they drop away). */
export const OPEN_AIR = /balcony|terrace|veranda|loggia|deck|porch|roof ?garden|ban công|sân thượng|hiên|lô gia/i;

/**
 * Every room edge as a wall centre line: an edge one room owns is exterior, an edge two rooms
 * share is one partition, pieces of the same room (an L) get none. Runs with the same owners on
 * one line are merged. Three rooms on one stretch of line means overlapping rooms: refused.
 * Edges the designer left open (a room's `open` sides, the outer edges of a balcony or terrace)
 * get no wall: between two rooms nothing, on the outside a railing — or nothing on the ground.
 */
export function wallsFromRooms(rooms: Room[], spec: WallSpec = {}, o: { ground?: boolean } = {}): Wall[] {
  const ext = { thickness: spec.exterior?.thickness ?? .25, material: spec.exterior?.material ?? 'brick_red', innerMaterial: spec.exterior?.innerMaterial };
  const int = { thickness: spec.interior?.thickness ?? .12, material: spec.interior?.material ?? 'plaster_white' };
  const rail = { material: spec.railing?.material ?? 'metal_steel', handrail: spec.railing?.handrail };
  const lines = new Map<string, { horizontal: boolean; at: number; spans: Array<[number, number, string, boolean]> }>();
  const add = (horizontal: boolean, at: number, lo: number, hi: number, owner: string, open: boolean) => {
    const k = `${horizontal ? 'h' : 'v'}:${at.toFixed(3)}`;
    const line = lines.get(k) ?? { horizontal, at, spans: [] };
    line.spans.push([lo, hi, owner, open]);
    lines.set(k, line);
  };
  for (const raw of rooms) {
    const r = norm(raw), owner = r.name, sides = new Set(raw.open ?? []), air = OPEN_AIR.test(`${raw.type} ${raw.name}`);
    add(true, r.z0, r.x0, r.x1, owner, sides.has('n')); add(true, r.z1, r.x0, r.x1, owner, sides.has('s'));
    add(false, r.x0, r.z0, r.z1, owner, sides.has('w')); add(false, r.x1, r.z0, r.z1, owner, sides.has('e'));
    // The outer edges of a balcony or terrace are open unless walls are asked for on them.
    if (air && !raw.open) for (const line of lines.values()) for (const sp of line.spans) if (sp[2] === owner) sp[3] = true;
  }
  const openAt = (spans: Array<[number, number, string, boolean]>, m: number) => spans.some(([a, b, , open]) => a < m && m < b && open);
  const exteriorOpen = (spans: Array<[number, number, string, boolean]>, m: number, owners: string[]) => owners.length === 1 && openAt(spans, m);
  const out: Wall[] = [];
  const keys = [...lines.keys()].sort();
  for (const k of keys) {
    const { horizontal, at, spans } = lines.get(k)!;
    const cuts = [...new Set(spans.flatMap(([a, b]) => [a, b]))].sort((a, b) => a - b);
    let run: { lo: number; hi: number; owners: string; open: boolean } | null = null;
    const flush = () => {
      if (!run) return;
      const owners = run.owners.split('|');
      const lo = run.lo, hi = run.hi, open = run.open;
      run = null;
      if (owners.length > 2) throw new Error(`Phòng chồng nhau trên đường ${horizontal ? 'z' : 'x'} = ${at}: ${owners.join(', ')}.`);
      if (owners.length === 2 && owners[0] === owners[1]) return;
      const exterior = owners.length === 1;
      if (open) {
        // Open between two rooms: nothing. Open to the outside: a railing above the ground, nothing on it.
        if (exterior && !o.ground) out.push({ id: `r${out.length + 1}`, a: horizontal ? [lo, at] : [at, lo], b: horizontal ? [hi, at] : [at, hi], thickness: .1, exterior: true, kind: 'railing', material: rail.material, ...(rail.handrail ? { innerMaterial: rail.handrail } : {}), openings: [] });
        return;
      }
      out.push({
        id: `w${out.length + 1}`, a: horizontal ? [lo, at] : [at, lo], b: horizontal ? [hi, at] : [at, hi],
        thickness: exterior ? ext.thickness : int.thickness, exterior,
        material: exterior ? ext.material : int.material, ...(exterior && ext.innerMaterial ? { innerMaterial: ext.innerMaterial } : {}), openings: [],
      });
    };
    for (let i = 0; i + 1 < cuts.length; i++) {
      const m = (cuts[i]! + cuts[i + 1]!) / 2;
      const list = spans.filter(([a, b]) => a < m && m < b).map((s) => s[2]).sort(), owners = list.join('|');
      // Shared edges are open when either side leaves them open; outer edges when the room does.
      const open = list.length === 2 ? openAt(spans, m) : exteriorOpen(spans, m, list);
      if (run && run.owners === owners && run.open === open) run.hi = cuts[i + 1]!;
      else { flush(); if (owners) run = { lo: cuts[i]!, hi: cuts[i + 1]!, owners, open }; }
    }
    flush();
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Openings against junctions and clear zones (after Aedifex's wall-mitering junctions and door-clearance)

/**
 * Where other walls meet a wall (a corner, or a partition's end against its side): bands along it
 * (from `a`, metres) that an opening must not cut into — the other wall's thickness plus a jamb.
 */
export function junctionBands(walls: Wall[], w: Wall, jamb = .05): Array<{ lo: number; hi: number; wall: string }> {
  const len = wallLen(w);
  if (len < EPS) return [];
  const u: [number, number] = [(w.b[0] - w.a[0]) / len, (w.b[1] - w.a[1]) / len], out: Array<{ lo: number; hi: number; wall: string }> = [];
  for (const o of walls) {
    if (o === w) continue;
    const ol = wallLen(o);
    if (ol < EPS) continue;
    const ou: [number, number] = [(o.b[0] - o.a[0]) / ol, (o.b[1] - o.a[1]) / ol], sin = Math.abs(u[0] * ou[1] - u[1] * ou[0]);
    if (sin < .05) continue;
    for (const p of [o.a, o.b]) {
      const at = along(w, p);
      if (offLine(w, p) > w.thickness / 2 + .05 || at < -o.thickness || at > len + o.thickness) continue;
      const half = o.thickness / 2 / sin;
      out.push({ lo: at - half - jamb, hi: at + half + jamb, wall: o.id });
    }
  }
  return out;
}

/** A door's clear zone in plan: its width (plus a little) by 0.65 m on each side of the wall, where the leaf swings and people step. */
export function doorZone(w: Wall, o: { at: number; width: number }, depth = .65): Rect {
  const len = wallLen(w) || 1, u = [(w.b[0] - w.a[0]) / len, (w.b[1] - w.a[1]) / len] as const, n = [-u[1], u[0]] as const, h = w.thickness / 2 + depth;
  const pts = [o.at - o.width / 2 - .05, o.at + o.width / 2 + .05].flatMap((s) => [-h, h].map((d) => [w.a[0] + u[0] * s + n[0] * d, w.a[1] + u[1] * s + n[1] * d] as const));
  return { x0: Math.min(...pts.map((p) => p[0])), x1: Math.max(...pts.map((p) => p[0])), z0: Math.min(...pts.map((p) => p[1])), z1: Math.max(...pts.map((p) => p[1])) };
}

// ---------------------------------------------------------------------------------------------
// Doors from links

const wallLen = (w: Wall) => Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
/** Where a point on (or near) a wall's line lies along it from `a`. */
const along = (w: Wall, p: [number, number]) => { const l = wallLen(w) || 1; return ((p[0] - w.a[0]) * (w.b[0] - w.a[0]) + (p[1] - w.a[1]) * (w.b[1] - w.a[1])) / l; };
const offLine = (w: Wall, p: [number, number]) => { const l = wallLen(w) || 1; return Math.abs((p[0] - w.a[0]) * (w.b[1] - w.a[1]) - (p[1] - w.a[1]) * (w.b[0] - w.a[0])) / l; };

/** The edge two rooms share: on which line, from where to where. */
export function sharedEdge(a0: Rect, b0: Rect): { a: [number, number]; b: [number, number] } | null {
  const a = norm(a0), b = norm(b0);
  for (const [x, other] of [[a.x1, b.x0], [a.x0, b.x1]] as const) if (Math.abs(x - other) < EPS) {
    const lo = Math.max(a.z0, b.z0), hi = Math.min(a.z1, b.z1);
    if (hi - lo > EPS) return { a: [x, lo], b: [x, hi] };
  }
  for (const [z, other] of [[a.z1, b.z0], [a.z0, b.z1]] as const) if (Math.abs(z - other) < EPS) {
    const lo = Math.max(a.x0, b.x0), hi = Math.min(a.x1, b.x1);
    if (hi - lo > EPS) return { a: [lo, z], b: [hi, z] };
  }
  return null;
}

export type Link = { a: string; b: string; kind?: 'door' | 'open' | 'arch'; width?: number };
const CIRCULATION = /stair|hall|corridor|lobby|foyer|entry|living|landing|gallery|sảnh|hành lang|buồng thang|phòng khách/i;
const PRIVATE = /bed|ngủ/i;

/** The walls that lie along an edge, with where the edge covers each (from `a`). */
function wallsAlong(plan: FloorPlan, e: { a: [number, number]; b: [number, number] }): Array<{ wall: Wall; lo: number; hi: number }> {
  return plan.walls.flatMap((w) => {
    if (w.kind === 'railing') return [];
    if (offLine(w, e.a) > w.thickness / 2 + EPS || offLine(w, e.b) > w.thickness / 2 + EPS) return [];
    const p = along(w, e.a), q = along(w, e.b), lo = Math.max(0, Math.min(p, q)), hi = Math.min(wallLen(w), Math.max(p, q));
    return hi - lo > .3 ? [{ wall: w, lo, hi }] : [];
  });
}

/**
 * Puts an opening of `width` on a wall between `lo` and `hi` (from `a`): as close to `prefer` as
 * it can, `margin` clear of the ends (corners, the walls that meet it) and 0.2 m clear of any
 * other opening. Returns where, or null when it does not fit.
 */
export function placeOpening(w: Wall, lo: number, hi: number, width: number, prefer = (lo + hi) / 2, margin = .3, junctions?: Array<{ lo: number; hi: number }>, avoid: Rect[] = []): number | null {
  const min = lo + margin + width / 2, max = hi - margin - width / 2;
  if (max < min - 1e-9) return null;
  const bands = junctions ?? [];
  // Clear of other openings, of junctions, and of what the door would swing onto (stairs).
  const clear = (at: number) => { const z = doorZone(w, { at, width }, .5); return avoid.every((r) => Math.min(z.x1, r.x1) - Math.max(z.x0, r.x0) <= .05 || Math.min(z.z1, r.z1) - Math.max(z.z0, r.z0) <= .05); };
  const free = (at: number) => w.openings.every((o) => Math.abs(o.at - at) >= (o.width + width) / 2 + .2) && bands.every((b) => at + width / 2 <= b.lo || at - width / 2 >= b.hi) && clear(at);
  const start = Math.min(max, Math.max(min, prefer));
  for (let d = 0; d <= max - min + PLAN_GRID; d += PLAN_GRID) {
    for (const at of [start + d, start - d]) if (at >= min - 1e-9 && at <= max + 1e-9 && free(at)) return snap(at);
  }
  return null;
}

/** Room ids or names → rooms (an L room is all its rectangles). */
function roomsNamed(plan: FloorPlan, key: string): Room[] {
  const byId = plan.rooms.filter((r) => r.id === key);
  const name = byId[0]?.name ?? key;
  return plan.rooms.filter((r) => r.name === name);
}

function linkOpening(plan: FloorPlan, link: Link, doorWidth: number, avoid: Rect[] = []): string | null {
  const as = roomsNamed(plan, link.a), bs = roomsNamed(plan, link.b);
  if (!as.length || !bs.length) return `Liên kết ${link.a}–${link.b}: không có phòng tên/id này.`;
  const edges = as.flatMap((a) => bs.map((b) => sharedEdge(a, b))).filter((e): e is NonNullable<typeof e> => !!e)
    .sort((p, q) => Math.hypot(q.b[0] - q.a[0], q.b[1] - q.a[1]) - Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1]));
  if (!edges.length) return `${as[0]!.name} và ${bs[0]!.name} không chung tường: không mở cửa được (đổi phòng cho kề nhau hoặc nối qua hành lang).`;
  const kind = link.kind ?? 'door';
  for (const e of edges) for (const { wall, lo, hi } of wallsAlong(plan, e)) {
    const width = kind === 'open' ? Math.max(doorWidth, Math.min(hi - lo - .4, 3)) : link.width ?? (kind === 'arch' ? Math.max(1.2, doorWidth) : doorWidth);
    const at = placeOpening(wall, lo, hi, width, (lo + hi) / 2, .3, junctionBands(plan.walls, wall), avoid);
    if (at == null) continue;
    wall.openings.push(kind === 'door'
      ? { kind: 'door', at, width, height: 2.1, sill: 0 }
      : { kind: kind === 'open' ? 'hole' : 'arch', at, width, height: Math.min(2.4, (wall.height ?? plan.height) - .2), sill: 0 });
    return null;
  }
  return `${as[0]!.name}–${bs[0]!.name}: tường chung quá ngắn hoặc đã kín lỗ mở cho cửa ${doorWidth} m.`;
}

/**
 * Takes out the wall between two rooms: only the stretch along their shared edge — what the wall
 * runs on beyond it stays as its own pieces, with their openings. Returns what was done.
 */
export function removeWallBetween(plan: FloorPlan, a: string, b: string): string {
  const as = roomsNamed(plan, a), bs = roomsNamed(plan, b);
  if (!as.length || !bs.length) throw new Error(`Không có phòng ${!as.length ? a : b} (id hoặc tên).`);
  const edges = as.flatMap((x) => bs.map((y) => sharedEdge(x, y))).filter((e): e is NonNullable<typeof e> => !!e);
  if (!edges.length) throw new Error(`${as[0]!.name} và ${bs[0]!.name} không chung cạnh: không có tường chung để bỏ.`);
  const out: string[] = [];
  for (const e of edges) for (const { wall, lo, hi } of wallsAlong(plan, e)) {
    const len = wallLen(wall), at = (t: number): [number, number] => [wall.a[0] + (wall.b[0] - wall.a[0]) * t / len, wall.a[1] + (wall.b[1] - wall.a[1]) * t / len];
    const keep: Wall[] = [];
    if (lo > .2) keep.push({ ...wall, id: `${wall.id}a`, b: at(lo), openings: wall.openings.filter((o) => o.at + o.width / 2 <= lo) });
    if (len - hi > .2) keep.push({ ...wall, id: `${wall.id}b`, a: at(hi), openings: wall.openings.filter((o) => o.at - o.width / 2 >= hi).map((o) => ({ ...o, at: o.at - hi })) });
    plan.walls.splice(plan.walls.indexOf(wall), 1, ...keep);
    out.push(`tường ${wall.id} (${lo.toFixed(2)}–${hi.toFixed(2)} m)${keep.length ? ` còn lại ${keep.map((k) => k.id).join(', ')}` : ''}`);
  }
  if (!out.length) throw new Error(`Giữa ${as[0]!.name} và ${bs[0]!.name} đã không có tường.`);
  return out.join('; ');
}

/** Whether a wall already has an opening between two rooms (a door the model drew itself). */
function linked(plan: FloorPlan, a: Room[], b: Room[]): boolean {
  return a.some((ra) => b.some((rb) => {
    const e = sharedEdge(ra, rb);
    return !!e && wallsAlong(plan, e).some(({ wall, lo, hi }) => wall.openings.some((o) => o.kind !== 'window' && o.at > lo && o.at < hi));
  }));
}

/**
 * Opens every link (a door on the pair's shared wall, or an open / arched passage), then repairs
 * the plan until each room is reachable from `start` (the entrance hall, or where the stairs
 * arrive): a room left out is joined to a reached neighbour — a circulation space first, never
 * one bedroom through another. Returns what could not be done.
 */
export function openLinks(plan: FloorPlan, links: Link[], o: { start?: string; doorWidth?: number; avoid?: Rect[] } = {}): { added: string[]; problems: string[] } {
  const avoid = o.avoid ?? [], doorWidth = o.doorWidth ?? .9, added: string[] = [], problems: string[] = [];
  for (const l of links) {
    const as = roomsNamed(plan, l.a), bs = roomsNamed(plan, l.b);
    if (as.length && bs.length && linked(plan, as, bs)) continue;
    const p = linkOpening(plan, l, doorWidth, avoid);
    if (p) problems.push(p); else added.push(`${l.a}–${l.b}`);
  }
  const names = [...new Set(plan.rooms.map((r) => r.name))];
  if (names.length < 2) return { added, problems };
  const first = o.start ? roomsNamed(plan, o.start)[0]?.name : undefined;
  const start = first ?? names.find((n) => CIRCULATION.test(n) || CIRCULATION.test(plan.rooms.find((r) => r.name === n)!.type)) ?? names[0]!;
  const typeOf = (n: string) => `${n} ${plan.rooms.find((r) => r.name === n)!.type}`;
  for (let guard = 0; guard < names.length; guard++) {
    // Reached: by a door or passage on a shared wall.
    const seen = new Set([start]), queue = [start];
    while (queue.length) {
      const n = queue.shift()!;
      for (const m of names) if (!seen.has(m) && linked(plan, roomsNamed(plan, n), roomsNamed(plan, m))) { seen.add(m); queue.push(m); }
    }
    const left = names.filter((n) => !seen.has(n));
    if (!left.length) break;
    let joined = false;
    for (const n of left) {
      const options = [...seen].filter((m) => !(PRIVATE.test(typeOf(m)) && PRIVATE.test(typeOf(n))))
        .filter((m) => roomsNamed(plan, n).some((a) => roomsNamed(plan, m).some((b) => sharedEdge(a, b))))
        .sort((p, q) => Number(CIRCULATION.test(typeOf(q))) - Number(CIRCULATION.test(typeOf(p))));
      for (const m of options) {
        if (!linkOpening(plan, { a: m, b: n }, doorWidth, avoid)) { added.push(`${m}–${n} (nối để tới được)`); joined = true; break; }
      }
      if (joined) break;
    }
    if (!joined) { problems.push(`Không tới được: ${left.join(', ')} — không kề phòng nào đã tới được (thêm hành lang).`); break; }
  }
  return { added, problems };
}

/**
 * The way in: a door on the longest exterior wall of the entrance room (a hall, lobby or living
 * room when not named), unless the storey already has one.
 */
export function placeEntrance(plan: FloorPlan, room?: string, width = 1, avoid: Rect[] = []): string | null {
  if (plan.walls.some((w) => w.exterior && w.openings.some((o) => o.kind === 'door' || o.kind === 'arch'))) return null;
  const candidates = room ? roomsNamed(plan, room) : plan.rooms.filter((r) => /hall|lobby|foyer|entry|living|corridor|sảnh|phòng khách|hành lang/i.test(`${r.name} ${r.type}`));
  const walls = (candidates.length ? candidates : plan.rooms).flatMap((r) => exteriorRuns(plan, r).map((x) => ({ ...x, r })))
    .sort((p, q) => (q.hi - q.lo) - (p.hi - p.lo));
  for (const { wall, lo, hi } of walls) {
    const at = placeOpening(wall, lo, hi, width, (lo + hi) / 2, .4, junctionBands(plan.walls, wall), avoid);
    if (at == null) continue;
    wall.openings.push({ kind: 'door', at, width, height: 2.2, sill: 0 });
    return null;
  }
  return 'Không có tường ngoài nào đủ dài cho cửa chính.';
}

// ---------------------------------------------------------------------------------------------
// Windows by façade bays (CGA comp / repeat / occlusion / snap lines)

/** The stretches of exterior walls along one room's edges. */
function exteriorRuns(plan: FloorPlan, r0: Room): Array<{ wall: Wall; lo: number; hi: number }> {
  const r = norm(r0);
  const edges: Array<{ a: [number, number]; b: [number, number] }> = [
    { a: [r.x0, r.z0], b: [r.x1, r.z0] }, { a: [r.x0, r.z1], b: [r.x1, r.z1] },
    { a: [r.x0, r.z0], b: [r.x0, r.z1] }, { a: [r.x1, r.z0], b: [r.x1, r.z1] },
  ];
  return edges.flatMap((e) => wallsAlong(plan, e).filter((x) => x.wall.exterior && x.wall.kind !== 'railing'));
}

/** Window size per room type: [width, height, sill]; null: none. */
export function windowFor(type: string): [number, number, number] | null {
  const t = type.toLowerCase();
  if (/bath|wc|toilet|vệ sinh|tắm/.test(t)) return [.6, .6, 1.5];
  if (/storage|kho|garage|utility/.test(t)) return [.8, .6, 1.6];
  if (/stair|thang/.test(t)) return [1, 1.2, 1.2];
  if (/kitchen|bếp/.test(t)) return [1.2, 1.1, 1.1];
  if (/class|học|office|văn phòng|shop|cửa hàng/.test(t)) return [1.6, 1.6, .9];
  if (/corridor|hall|hành lang|sảnh|lobby/.test(t)) return [1.2, 1.4, 1];
  return [1.2, 1.4, .9];
}

/**
 * Window centres along one exterior stretch (CGA): the stretch is kept `margin` clear of its ends
 * (a corner, or a partition meeting it), split into equal bays of about `bay` (repeat), one window
 * centred in each; a bay that would hit an existing opening is dropped (occlusion); a centre within
 * `snapTo` of a preferred one (the window below) moves onto it (snap lines).
 */
export function facadeBays(lo: number, hi: number, width: number, o: { bay?: number; margin?: number; taken?: Array<{ at: number; width: number }>; prefer?: number[]; snapTo?: number } = {}): number[] {
  const margin = o.margin ?? .5, bay = o.bay ?? 3;
  const m0 = lo + margin, m1 = hi - margin, span = m1 - m0;
  if (span < width + .1) return [];
  const n = Math.max(1, Math.round(span / bay)), cell = span / n;
  const w = Math.min(width, cell - .4);
  if (w < Math.min(.5, width)) return [];
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    let at = m0 + cell * (i + .5);
    const near = (o.prefer ?? []).filter((p) => Math.abs(p - at) <= (o.snapTo ?? .45) && p - w / 2 >= m0 - 1e-9 && p + w / 2 <= m1 + 1e-9).sort((a, b) => Math.abs(a - at) - Math.abs(b - at))[0];
    if (near != null) at = near;
    if ((o.taken ?? []).some((t) => Math.abs(t.at - at) < (t.width + w) / 2 + .3)) continue;
    if (out.some((p) => Math.abs(p - at) < w + .3)) continue;
    out.push(snap(at));
  }
  return out;
}

/**
 * Windows on every exterior stretch of every room that has none yet: sized for the room type,
 * spaced by façade bays, lined up with the windows of the storey below on the same façade line.
 * Interior walls never get one.
 */
export function placeWindows(plan: FloorPlan, below?: FloorPlan | null, o: { bay?: number; width?: number; height?: number; sill?: number } = {}): number {
  let added = 0;
  // Window centres below, by façade line, as world positions along it.
  const lines = new Map<string, number[]>();
  const lineKey = (w: Wall) => (Math.abs(w.a[1] - w.b[1]) < EPS ? `h:${w.a[1].toFixed(2)}` : `v:${w.a[0].toFixed(2)}`);
  const pos = (w: Wall, at: number) => { const l = wallLen(w) || 1, x = w.a[0] + (w.b[0] - w.a[0]) * at / l, z = w.a[1] + (w.b[1] - w.a[1]) * at / l; return lineKey(w).startsWith('h') ? x : z; };
  for (const w of below?.walls ?? []) if (w.exterior) for (const op of w.openings) if (op.kind === 'window') lines.set(lineKey(w), [...(lines.get(lineKey(w)) ?? []), pos(w, op.at)]);
  for (const r of plan.rooms) {
    const size = windowFor(`${r.type} ${r.name}`);
    if (!size) continue;
    const [width, height, sill] = [o.width ?? size[0], o.height ?? size[1], o.sill ?? size[2]];
    for (const { wall, lo, hi } of exteriorRuns(plan, r)) {
      if (wall.openings.some((x) => x.kind === 'window' && x.at > lo && x.at < hi)) continue;
      const l = wallLen(wall);
      // Preferred centres: the storey below's, mapped onto this wall.
      const prefer = (lines.get(lineKey(wall)) ?? []).map((p) => {
        const start = lineKey(wall).startsWith('h') ? wall.a[0] : wall.a[1], end = lineKey(wall).startsWith('h') ? wall.b[0] : wall.b[1];
        return (p - start) / (end - start) * l;
      });
      const h = Math.min(height, (wall.height ?? plan.height) - sill - .2);
      if (h < .4) continue;
      const bay = o.bay ?? (/class|học|office|corridor|hành lang/i.test(`${r.type} ${r.name}`) ? 3.6 : 3);
      const taken = [...wall.openings, ...junctionBands(plan.walls, wall).map((b) => ({ at: (b.lo + b.hi) / 2, width: b.hi - b.lo }))];
      for (const at of facadeBays(lo, hi, width, { bay, margin: .45 + wall.thickness / 2, taken, prefer })) {
        const cellWidth = Math.min(width, (hi - lo - 2 * (.45 + wall.thickness / 2)) / Math.max(1, Math.round((hi - lo - 2 * (.45 + wall.thickness / 2)) / bay)) - .4);
        wall.openings.push({ kind: 'window', at, width: snap(Math.max(.5, cellWidth)), height: snap(h), sill });
        added++;
      }
    }
  }
  return added;
}

// ---------------------------------------------------------------------------------------------
// Roof from the footprint

/** The union of rectangles as a few rectangles (largest first), from the grid of their edges. */
export function rectangles(rects: Rect[], max = 6): Rect[] {
  const rs = rects.map(norm);
  const xs = [...new Set(rs.flatMap((r) => [r.x0, r.x1]))].sort((a, b) => a - b), zs = [...new Set(rs.flatMap((r) => [r.z0, r.z1]))].sort((a, b) => a - b);
  const filled = zs.slice(0, -1).map((_, j) => xs.slice(0, -1).map((_, i) => {
    const cx = (xs[i]! + xs[i + 1]!) / 2, cz = (zs[j]! + zs[j + 1]!) / 2;
    return rs.some((r) => cx > r.x0 && cx < r.x1 && cz > r.z0 && cz < r.z1);
  }));
  const out: Rect[] = [];
  const used = filled.map((row) => row.map(() => false));
  for (let k = 0; k < max; k++) {
    let best: { i0: number; i1: number; j0: number; j1: number; area: number } | null = null;
    for (let j0 = 0; j0 < zs.length - 1; j0++) for (let i0 = 0; i0 < xs.length - 1; i0++) {
      if (!filled[j0]![i0]) continue;
      for (let j1 = j0; j1 < zs.length - 1; j1++) {
        if (!filled[j1]![i0]) break;
        for (let i1 = i0; i1 < xs.length - 1; i1++) {
          let ok = true;
          for (let j = j0; j <= j1 && ok; j++) if (!filled[j]![i1]) ok = false;
          if (!ok) break;
          // Count only what is not yet roofed: the part may overlap the ones before (wings meet in valleys).
          let fresh = 0;
          for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (!used[j]![i]) fresh += (xs[i + 1]! - xs[i]!) * (zs[j + 1]! - zs[j]!);
          if (fresh > 1e-6 && (!best || fresh > best.area)) best = { i0, i1, j0, j1, area: fresh };
        }
      }
    }
    if (!best) break;
    for (let j = best.j0; j <= best.j1; j++) for (let i = best.i0; i <= best.i1; i++) used[j]![i] = true;
    out.push({ x0: xs[best.i0]!, x1: xs[best.i1 + 1]!, z0: zs[best.j0]!, z1: zs[best.j1 + 1]! });
  }
  return out;
}

export type RoofSpec = { style: 'gable' | 'hip' | 'shed' | 'flat'; pitch?: number; overhang?: number; material: string; gableMaterial?: string; parapet?: number; damage?: number };

const roofMaterial = (doc: ModelDoc, id: string) => {
  if (!doc.materials.some((m) => m.id === id)) doc.materials.push(materialFromPreset(id, matchPreset(id).id));
  return id;
};

/**
 * A roof over the top storey drawn: its rooms' outline (out to the face of the exterior walls) cut
 * into rectangles, each roofed with the same pitch, the ridge along its long side — so a wing
 * meets the main block in valleys. Gable ends are closed in the wall material where nothing
 * covers them; a flat roof gets a parapet round its outline. A roof built before is replaced.
 */
export function buildRoof(doc: ModelDoc, spec: RoofSpec, level?: number): { group: string; parts: number; eaves: number; rects: Rect[] } {
  const plans = [...(doc.plans ?? [])].sort((a, b) => a.level - b.level);
  const plan = level == null ? plans[plans.length - 1] : plans.find((p) => p.level === level);
  if (!plan) throw new Error('Chưa có bản vẽ tầng nào: vẽ và dựng các tầng trước khi lợp mái.');
  if (!plan.built) throw new Error(`Tầng ${plan.level} chưa dựng: build_floor trước khi lợp mái.`);
  for (const old of doc.nodes.filter((n) => n.tags?.includes('roof-from-plan'))) {
    const gone = new Set(subtree(doc, old.id).map((n) => n.id));
    doc.nodes = doc.nodes.filter((n) => !gone.has(n.id));
  }
  const t = Math.max(.1, ...plan.walls.filter((w) => w.exterior).map((w) => w.thickness)) / 2;
  const rects = rectangles(plan.rooms).map((r) => ({ x0: r.x0 - t, z0: r.z0 - t, x1: r.x1 + t, z1: r.z1 + t }));
  const eaves = plan.elevation + Math.max(plan.height, ...plan.walls.map((w) => w.height ?? plan.height));
  const b = new DocBuilder(doc), before = doc.nodes.length;
  const mat = roofMaterial(doc, spec.material), gableMat = roofMaterial(doc, spec.gableMaterial ?? plan.walls.find((w) => w.exterior)?.material ?? spec.material);
  const g = b.group('Mái (theo mặt bằng)', null, { position: [0, eaves, 0] }, { tags: ['roof', 'roof-from-plan'] });
  const pitch = (spec.pitch ?? (spec.style === 'flat' ? 0 : 30)) * Math.PI / 180, overhang = spec.overhang ?? (spec.style === 'flat' ? 0 : .45);
  const inside = (x: number, z: number, skip: Rect) => rects.some((r) => r !== skip && x > r.x0 + EPS && x < r.x1 - EPS && z > r.z0 + EPS && z < r.z1 - EPS);
  rects.forEach((r, k) => {
    const w = r.x1 - r.x0, d = r.z1 - r.z0, alongX = w >= d, long = alongX ? w : d, span = alongX ? d : w;
    const rise = spec.style === 'flat' ? 0 : spec.style === 'shed' ? span * Math.tan(pitch) : span / 2 * Math.tan(pitch);
    const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
    const part = b.group(`Mái ${k + 1}`, g, { position: [cx, 0, cz], rotation: [0, alongX ? 0 : Math.PI / 2, 0] });
    b.roof(`Mái ${k + 1}`, part, { style: spec.style, width: long, depth: span, rise, overhang, thickness: .14, damage: spec.damage ?? 0, seed: 7 + k }, mat, {});
    // Gable ends: the triangles under the roof at both ends of the ridge, unless another part covers them.
    if (spec.style === 'gable') for (const side of [-1, 1]) {
      const ex = alongX ? cx + side * w / 2 : cx, ez = alongX ? cz : cz + side * d / 2;
      if (inside(alongX ? ex + side * .3 : ex, alongX ? ez : ez + side * .3, r)) continue;
      b.primitive('Đầu hồi', part, 'wedge', { width: t * 2, height: rise, depth: span, ridge: .5 }, gableMat, { position: [side * (long / 2 - t), 0, 0] });
    }
  });
  if (spec.style === 'flat' && (spec.parapet ?? .6) > 0) {
    const h = spec.parapet ?? .6;
    for (const e of outline(rects)) {
      const horizontal = Math.abs(e.a[1] - e.b[1]) < EPS;
      const [x0, x1] = [Math.min(e.a[0], e.b[0]), Math.max(e.a[0], e.b[0])], [z0, z1] = [Math.min(e.a[1], e.b[1]), Math.max(e.a[1], e.b[1])];
      b.box('Tường chắn mái', g, horizontal ? [x0, 0, z0 - t] : [x0 - t, 0, z0], horizontal ? [x1, h, z1 + t] : [x0 + t, h, z1], gableMat);
    }
  }
  return { group: g, parts: doc.nodes.length - before, eaves, rects };
}

/** The outline of a union of rectangles: the cell edges with filled space on one side only. */
function outline(rects: Rect[]): Array<{ a: [number, number]; b: [number, number] }> {
  const xs = [...new Set(rects.flatMap((r) => [r.x0, r.x1]))].sort((a, b) => a - b), zs = [...new Set(rects.flatMap((r) => [r.z0, r.z1]))].sort((a, b) => a - b);
  const at = (x: number, z: number) => rects.some((r) => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1);
  const out: Array<{ a: [number, number]; b: [number, number] }> = [];
  for (let j = 0; j < zs.length; j++) for (let i = 0; i + 1 < xs.length; i++) {
    const cx = (xs[i]! + xs[i + 1]!) / 2, up = j > 0 && at(cx, (zs[j - 1]! + zs[j]!) / 2), down = j + 1 < zs.length && at(cx, (zs[j]! + zs[j + 1]!) / 2);
    if (up !== down) out.push({ a: [xs[i]!, zs[j]!], b: [xs[i + 1]!, zs[j]!] });
  }
  for (let i = 0; i < xs.length; i++) for (let j = 0; j + 1 < zs.length; j++) {
    const cz = (zs[j]! + zs[j + 1]!) / 2, left = i > 0 && at((xs[i - 1]! + xs[i]!) / 2, cz), right = i + 1 < xs.length && at((xs[i]! + xs[i + 1]!) / 2, cz);
    if (left !== right) out.push({ a: [xs[i]!, zs[j]!], b: [xs[i]!, zs[j + 1]!] });
  }
  return out;
}

/** Whether the roof covers the top storey: every room under some roof part. */
export function roofCovers(doc: ModelDoc): string[] {
  const plans = [...(doc.plans ?? [])].sort((a, b) => a.level - b.level), top = plans[plans.length - 1];
  const roof = doc.nodes.find((n) => n.tags?.includes('roof-from-plan'));
  if (!top || !roof) return [];
  const parts = rectangles(top.rooms);
  return top.rooms.filter((r0) => { const r = norm(r0); return !parts.some((p) => r.x0 >= p.x0 - EPS && r.x1 <= p.x1 + EPS && r.z0 >= p.z0 - EPS && r.z1 <= p.z1 + EPS); }).map((r) => `mái không phủ ${r.name}`);
}
