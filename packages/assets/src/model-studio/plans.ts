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
    if (plan.voids.reduce((sum, v) => sum + overlap(norm(v), f), 0) < need * .6) err(`Thiếu giếng thang trên cầu thang ${s.id} của tầng dưới: thêm voids [${f.x0.toFixed(1)}, ${f.z0.toFixed(1)}] → [${f.x1.toFixed(1)}, ${f.z1.toFixed(1)}].`);
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
    b.slab(`Sàn ${r.name}`, floorG, w, d, t, holes, ensureMaterial(doc, r.floorMaterial ?? 'concrete'), { position: [cx, e - t, cz] });
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
    b.wall(w.exterior ? 'Tường ngoài' : 'Vách', wallsG, len, h + extra, w.thickness, openings, ensureMaterial(doc, w.material),
      { position: [(w.a[0] + w.b[0]) / 2, base, (w.a[1] + w.b[1]) / 2], rotation: [0, Math.atan2(-dz, dx), 0] }, w.innerMaterial ? ensureMaterial(doc, w.innerMaterial) : undefined);
  }
  for (const s of plan.stairs) {
    const rise = stairRise(doc, plan), { steps, run } = stairCounts(rise);
    const id = b.stairs(`Cầu thang ${s.id}`, g, s.width, rise, run, steps, ensureMaterial(doc, s.material), { position: [s.x, e, s.z], rotation: [0, DIRS[s.direction], 0] });
    const n = doc.nodes.find((x) => x.id === id);
    if (n && n.kind === 'stairs') Object.assign(n, { shape: s.shape, style: s.style, ...(s.turn ? { turn: s.turn } : {}), railing: s.railing ?? true });
  }
  plan.built = g;
  return { group: g, parts: doc.nodes.length - before };
}
