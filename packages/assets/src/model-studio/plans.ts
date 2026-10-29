import { DocBuilder } from './build';
import { subtree, type FloorPlan, type ModelDoc, type Opening } from './doc';
import { materialFromPreset, matchPreset } from './materials';
import { spiralRadius } from './mesh';

/**
 * Floor plans: the AI (or the admin) draws each storey first — rooms, walls with their doors and
 * windows, stairs, stairwell voids — gets it checked like an architect would (are the rooms
 * closed and big enough, can every room be reached through a door, do doors fit a person, do
 * the stairs fit and climb, is there a well above them), fixes it, and only then builds it:
 * the parts are exactly what the plan says, nothing designed in advance.
 */
export interface PlanIssue { level: 'error' | 'warning' | 'info'; message: string }

const RISER = .18, TREAD = .27;
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
export function fitStairs(doc: ModelDoc, plan: FloorPlan): string[] {
  const moved: string[] = [];
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
          if (Math.abs(gap) > .001 && Math.abs(gap) <= .06) dx = c < cx ? -gap : gap;
        }
        if (horizontal && !dz) {
          const c = w.a[1], lo = Math.min(w.a[0], w.b[0]), hi = Math.max(w.a[0], w.b[0]);
          if (Math.min(hi, f.x1) - Math.max(lo, f.x0) < .3) continue;
          const gap = c < cz ? f.z0 - (c + half) : (c - half) - f.z1;
          if (Math.abs(gap) > .001 && Math.abs(gap) <= .06) dz = c < cz ? -gap : gap;
        }
      }
      if (!dx && !dz) break;
      s.x = r3(s.x + dx); s.z = r3(s.z + dz);
      moved.push(`Cầu thang ${s.id} dời ${dx ? `x ${(dx * 100).toFixed(1)} cm` : ''}${dx && dz ? ', ' : ''}${dz ? `z ${(dz * 100).toFixed(1)} cm` : ''} cho sát tường.`);
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

/** Steps and run of a flight climbing `rise`. */
export function stairCounts(rise: number): { steps: number; run: number } {
  const steps = Math.max(2, Math.ceil(rise / RISER));
  return { steps, run: steps * TREAD };
}

/** The flight's footprint on the plan (axis-aligned box) and where you arrive at the top. */
export function stairFootprint(s: Stair, rise: number): { x0: number; z0: number; x1: number; z1: number; top: [number, number] } {
  const { steps } = stairCounts(rise), w = s.width, W = w / 2, turn = s.turn === 'left' ? -1 : 1;
  let lx0 = -W, lx1 = W, lz1 = steps * TREAD, top: [number, number] = [0, steps * TREAD + .6];
  if (s.shape === 'l' || s.shape === 'u') {
    const n1 = Math.ceil((steps - 1) / 2), n2 = steps - 1 - n1, L = w;
    lz1 = n1 * TREAD + L;
    if (s.shape === 'l') {
      if (turn > 0) lx1 = W + n2 * TREAD; else lx0 = -W - n2 * TREAD;
      top = [turn * (W + n2 * TREAD + .6), n1 * TREAD + L / 2];
    } else {
      if (turn > 0) lx1 = W + w + .1; else lx0 = -W - w - .1;
      top = [turn * (w + .1), -.6];
    }
  } else if (s.shape === 'spiral') {
    const R = spiralRadius(w);
    lx0 = -R; lx1 = R; lz1 = 2 * R;
    top = [0, R];
  }
  const yaw = DIRS[s.direction], c = Math.cos(yaw), sn = Math.sin(yaw);
  const tf = (x: number, z: number): [number, number] => [s.x + x * c + z * sn, s.z - x * sn + z * c];
  const pts = [tf(lx0, 0), tf(lx1, 0), tf(lx1, lz1), tf(lx0, lz1)];
  return { x0: Math.min(...pts.map((p) => p[0])), x1: Math.max(...pts.map((p) => p[0])), z0: Math.min(...pts.map((p) => p[1])), z1: Math.max(...pts.map((p) => p[1])), top: tf(top[0], top[1]) };
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
    for (const o of w.openings) {
      if (o.at - o.width / 2 < -.01 || o.at + o.width / 2 > len + .01) err(`Tường ${w.id}: ${o.kind} ở ${o.at.toFixed(2)} m (rộng ${o.width}) vượt ra ngoài tường dài ${len.toFixed(2)} m.`);
      if (o.sill + o.height > h + .01) err(`Tường ${w.id}: ${o.kind} cao tới ${(o.sill + o.height).toFixed(2)} m, quá trần ${h.toFixed(2)} m.`);
      if ((o.kind === 'door' || o.kind === 'arch') && (o.width < .82 || o.height < 1.95 || o.sill > .05)) err(`Tường ${w.id}: cửa ${o.width}×${o.height} m (bậu ${o.sill}) — người không đi qua được (≥ 0.82×1.95 m, bậu 0).`);
    }
    for (let i = 0; i < w.openings.length; i++) for (let j = i + 1; j < w.openings.length; j++) {
      const a = w.openings[i]!, b = w.openings[j]!;
      if (Math.abs(a.at - b.at) < (a.width + b.width) / 2 + .1 && a.sill < b.sill + b.height && b.sill < a.sill + a.height) err(`Tường ${w.id}: hai lỗ mở chồng nhau (ở ${a.at} và ${b.at} m).`);
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
      if (bare > 3) warn(`Phòng "${r.name}" thiếu tường ${side} (${Math.round(bare / 9 * 100)}% cạnh không có tường hay phòng bên cạnh).`);
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
    const rise = stairRise(doc, plan), { steps } = stairCounts(rise), f = stairFootprint(s, rise);
    const corners: Array<[number, number]> = [[f.x0, f.z0], [f.x1, f.z0], [f.x1, f.z1], [f.x0, f.z1]];
    if (corners.some(([x, z]) => !rooms.some((r) => inside(r, x, z, .05)))) warn(`Cầu thang ${s.id} (${s.shape}, ${steps} bậc, chiếm ${(f.x1 - f.x0).toFixed(1)}×${(f.z1 - f.z0).toFixed(1)} m từ (${f.x0.toFixed(1)}, ${f.z0.toFixed(1)})) lấn ra ngoài các phòng.`);
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
        else if (gap > .02 && gap < .6) err(`Khe hở ${(gap * 100).toFixed(0)} cm giữa cầu thang ${s.id} và tường ${w.id}: dời x của cầu thang ${c < cx ? '−' : '+'}${gap.toFixed(2)} m (tới ${(s.x + (c < cx ? -gap : gap)).toFixed(2)}) cho sát tường.`);
      } else {
        const c = w.a[1], lo = Math.min(w.a[0], w.b[0]), hi = Math.max(w.a[0], w.b[0]);
        if (Math.min(hi, f.x1) - Math.max(lo, f.x0) < .3) continue;
        const gap = c < cz ? f.z0 - (c + half) : (c - half) - f.z1;
        if (gap < -.02 && (c < cz ? c - half < f.z0 : c + half > f.z1)) err(`Cầu thang ${s.id} lấn ${(-gap * 100).toFixed(0)} cm vào tường ${w.id}: dời z của cầu thang ${c < cz ? '+' : '−'}${(-gap).toFixed(2)} m.`);
        else if (gap > .02 && gap < .6) err(`Khe hở ${(gap * 100).toFixed(0)} cm giữa cầu thang ${s.id} và tường ${w.id}: dời z của cầu thang ${c < cz ? '−' : '+'}${gap.toFixed(2)} m (tới ${(s.z + (c < cz ? -gap : gap)).toFixed(2)}) cho sát tường.`);
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
    stairs: plan.stairs.map((s) => { const f = stairFootprint(s, stairRise(doc, plan)); return { id: s.id, shape: s.shape, style: s.style, steps: stairCounts(stairRise(doc, plan)).steps, footprint: [f.x0, f.z0, f.x1, f.z1].map((v) => +v.toFixed(2)), arrivesAt: f.top.map((v) => +v.toFixed(2)) }; }),
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
    const h = w.height ?? plan.height, base = w.exterior ? e - t : e, extra = w.exterior ? t : 0;
    const openings: Opening[] = w.openings.map((o) => ({ kind: o.kind, offset: o.at - len / 2, width: o.width, height: o.height, sill: o.sill + extra }));
    const wallId = b.wall(w.exterior ? 'Tường ngoài' : 'Vách', wallsG, len, h + extra, w.thickness, openings, ensureMaterial(doc, w.material),
      { position: [(w.a[0] + w.b[0]) / 2, base, (w.a[1] + w.b[1]) / 2], rotation: [0, Math.atan2(-dz, dx), 0] }, w.innerMaterial ? ensureMaterial(doc, w.innerMaterial) : undefined);
    wallParts(b, doc, plan, w, wallId, len, extra);
  }
  for (const s of plan.stairs) {
    const rise = stairRise(doc, plan), { steps, run } = stairCounts(rise);
    const id = b.stairs(`Cầu thang ${s.id}`, g, s.width, rise, run, steps, ensureMaterial(doc, s.material), { position: [s.x, e, s.z], rotation: [0, DIRS[s.direction], 0] });
    const n = doc.nodes.find((x) => x.id === id);
    if (n && n.kind === 'stairs') Object.assign(n, {
      shape: s.shape, style: s.style, ...(s.turn ? { turn: s.turn } : {}), railing: s.railing ?? true,
      ...(s.treadMaterial ? { treadMaterial: ensureMaterial(doc, s.treadMaterial) } : {}),
      ...(s.railMaterial ? { railMaterial: ensureMaterial(doc, s.railMaterial) } : {}),
      ...(s.handrailMaterial ? { handrailMaterial: ensureMaterial(doc, s.handrailMaterial) } : {}),
    });
  }
  plan.built = g;
  return { group: g, parts: doc.nodes.length - before };
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
