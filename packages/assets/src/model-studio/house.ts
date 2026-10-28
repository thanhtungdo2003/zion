import { DocBuilder } from './build';
import type { ModelDoc, Opening } from './doc';
import { FURNITURE_SIZE, furniture, type FurnitureKind, type FurnitureMaterials } from './furniture';
import { Random, seedOf } from './noise';

/**
 * A whole house as one editable model: a floor plan split into rooms that connect through doors
 * (every room reachable from the entrance), exterior walls with doors and windows cut through,
 * interior partitions, floor slabs per room, a straight stair to the upper storey with its
 * stairwell and railing, ceilings, a roof, furniture placed against walls clear of doors and
 * windows, and the yard, path, fence and garden around it. Dimensions follow building practice
 * — 2.7 m rooms, 0.9 × 2.1 m doors, sills at 0.9 m, risers ≈ 18 cm on 27 cm treads — and are
 * checked against the game's walker (0.35 m radius, 1.8 m tall, 0.45 m step).
 *
 * The house stands on y = 0, centred on its footprint, front (entrance) toward +z.
 */
export type RoomType = 'living' | 'kitchen' | 'dining' | 'bedroom' | 'bathroom' | 'hall' | 'storage';
export const ROOM_TYPES: readonly RoomType[] = ['living', 'kitchen', 'dining', 'bedroom', 'bathroom', 'hall', 'storage'];

export interface HouseSpec {
  seed?: number | string;
  style?: 'rural' | 'modern' | 'postapoc' | 'cottage';
  floors?: 1 | 2;
  rooms?: RoomType[];
  /** Years since anyone lived there (0 = kept up; 200 = a ruin). */
  abandonedYears?: number;
  furniture?: boolean;
  yard?: boolean;
  fence?: boolean;
  garden?: boolean;
  name?: string;
}

export interface RoomInfo { id: string; type: RoomType; name: string; floor: number; x0: number; x1: number; z0: number; z1: number; area: number }
export interface HouseReport {
  root: string;
  footprint: { width: number; depth: number };
  height: number;
  floors: number;
  rooms: RoomInfo[];
  doors: number;
  windows: number;
  furniture: number;
  damage: number;
  notes: string[];
}

/** Clear floor before the first step (a walker turns onto the flight there). */
const STAIR_FOOT = .9;
const T_EXT = .25, T_INT = .12, SLAB0 = .15, SLAB1 = .2, CEIL = .12, ROOM_H = 2.7;
const DOOR_W = .9, DOOR_H = 2.1, FRONT_DOOR_W = 1, FRONT_DOOR_H = 2.15;
const AREA: Record<RoomType, number> = { living: 22, kitchen: 11, dining: 12, bedroom: 13, bathroom: 5.5, hall: 0, storage: 6 };
const NAME: Record<RoomType, string> = { living: 'Phòng khách', kitchen: 'Nhà bếp', dining: 'Phòng ăn', bedroom: 'Phòng ngủ', bathroom: 'Phòng tắm', hall: 'Sảnh & cầu thang', storage: 'Kho' };

interface Room { id: string; type: RoomType; name: string; floor: number; x0: number; x1: number; z0: number; z1: number; strip: 'front' | 'back' }
interface Door { a: string; b: string | null; axis: 'x' | 'z'; at: number; pos: number; width: number; height: number; kind: Opening['kind'] }

export function generateHouse(doc: ModelDoc, spec: HouseSpec = {}, parent: string | null = null): HouseReport {
  const b = new DocBuilder(doc);
  const seed = typeof spec.seed === 'string' ? seedOf(spec.seed) : (spec.seed ?? 1) >>> 0;
  const rnd = new Random(seed);
  const style = spec.style ?? 'rural';
  const years = Math.max(0, spec.abandonedYears ?? 0);
  const damage = Math.min(1, years / 200);
  const notes: string[] = [];
  let rooms0: RoomType[] = (spec.rooms?.length ? spec.rooms : ['living', 'kitchen', 'dining', 'bedroom', 'bedroom', 'bathroom'] as RoomType[]).filter((r) => r !== 'hall');
  if (!rooms0.includes('living')) rooms0 = ['living', ...rooms0];
  const totalArea = rooms0.reduce((s, r) => s + AREA[r], 0);
  const floors = spec.floors ?? (totalArea > 78 ? 2 : 1);

  // Which rooms go where: bedrooms and the main bathroom upstairs in a two-storey house.
  const ground: RoomType[] = [], upper: RoomType[] = [];
  for (const r of rooms0) (floors === 2 && (r === 'bedroom' || (r === 'bathroom' && !upper.includes('bathroom'))) ? upper : ground).push(r);
  if (floors === 2 && !upper.length) upper.push('bedroom');

  // Stairs: from the ground floor top to the upper floor top.
  const ceil0 = SLAB0 + ROOM_H, f1 = ceil0 + SLAB1, rise = f1 - SLAB0;
  const steps = Math.round(rise / .18), run = steps * .27, stairW = 1;
  const hallLen = floors === 2 ? run + 2.1 : 0;
  // The flight starts `STAIR_FOOT` in from the hall's outer end (the house's left side).
  const stairEndX = (w: number) => -w / 2 + STAIR_FOOT + run;

  // Footprint (inside the exterior walls) from the larger floor's area.
  const area = Math.max(ground.reduce((s, r) => s + AREA[r], 0) + (floors === 2 ? hallLen * 3.4 : 0), upper.reduce((s, r) => s + AREA[r], 0) + (floors === 2 ? hallLen * 3.4 : 0));
  let Di = Math.max(6, Math.min(11, Math.sqrt(area / 1.3)));
  let Wi = Math.max(floors === 2 ? hallLen + 3.6 : 7, area / Di);
  Di = round(Di * (.95 + rnd.next() * .1)); Wi = round(Wi * (.95 + rnd.next() * .1));
  const hw = Wi / 2, hd = Di / 2;
  const stairEndXv = stairEndX(Wi);

  // Materials by style, weathered by age.
  const wear = { wear: damage * .7, dirt: Math.min(1, damage * .9 + (style === 'postapoc' ? .3 : 0)), moss: damage * .75, cracks: damage * .8 };
  const extPreset = style === 'modern' ? 'concrete' : style === 'cottage' ? 'stone_wall' : style === 'postapoc' ? 'brick_red' : rnd.next() < .5 ? 'plaster_ochre' : 'brick_red';
  const roofPreset = style === 'modern' ? 'concrete' : style === 'postapoc' ? 'metal_corrugated' : style === 'cottage' ? 'roof_shingles' : 'roof_tiles';
  const mat = {
    ext: b.material('tuong-ngoai', extPreset, { ...wear, seed: seed ^ 1 }).id,
    int: b.material('tuong-trong', 'plaster_white', { wear: damage * .5, dirt: damage * .8, moss: damage * .3, cracks: damage * .9, seed: seed ^ 2 }).id,
    floor: b.material('san-go', damage > .5 ? 'wood_weathered' : 'wood_planks', { wear: damage * .6, dirt: damage, seed: seed ^ 3 }).id,
    tiles: b.material('gach-men', 'ceramic_tiles', { dirt: damage * .9, cracks: damage * .6, seed: seed ^ 4 }).id,
    concrete: b.material('be-tong', 'concrete', { dirt: damage * .6, moss: damage * .4, seed: seed ^ 5 }).id,
    roof: b.material('mai', roofPreset, { wear: damage * .6, dirt: damage * .6 + (style === 'postapoc' ? .25 : 0), moss: damage * .5, seed: seed ^ 6 }).id,
    trim: b.material('go-vien', damage > .4 ? 'wood_weathered' : 'wood_oak', { wear: damage * .6, seed: seed ^ 7 }).id,
    glass: b.material('kinh', damage > .3 ? 'glass_dirty' : 'glass', { seed: seed ^ 8 }).id,
    ceiling: b.material('tran', 'plaster_white', { dirt: damage * .7, cracks: damage * .7, moss: damage * .2, seed: seed ^ 9 }).id,
  };
  const furn: FurnitureMaterials = {
    wood: b.material('noi-that-go', damage > .5 ? 'wood_weathered' : 'wood_oak', { wear: damage * .5, dirt: damage * .7, seed: seed ^ 10 }).id,
    fabric: b.material('vai', 'fabric', { dirt: damage * .9, moss: damage * .2, seed: seed ^ 11, color: rnd.pick(['#5b6470', '#6f5a48', '#56634f', '#7a4e45']) }).id,
    metal: b.material('kim-loai', damage > .4 ? 'metal_rust' : 'metal_steel', { seed: seed ^ 12 }).id,
    ceramic: b.material('su-trang', 'paint_metal', { dirt: damage * .8, seed: seed ^ 13 }).id,
    top: mat.tiles,
  };

  // Small surfaces (trim, glass, furniture) need less texture than walls, floors and the roof.
  for (const id of [mat.trim, mat.glass, mat.concrete, furn.wood, furn.fabric, furn.metal, furn.ceramic]) { const m = doc.materials.find((x) => x.id === id); if (m && !m.resolution) m.resolution = 256; }
  const root = b.group(spec.name ?? 'Ngôi nhà', parent, {}, { tags: ['house'] });

  // --- Plan: per floor a front strip (entrance side) and a back strip, each split into rooms.
  let sharedSplit: number | undefined;
  const plan = (types: RoomType[], floor: number): Room[] => {
    const front: RoomType[] = [], back: RoomType[] = [];
    if (floors === 2) front.push('hall');
    const order = (t: RoomType) => ['living', 'bedroom', 'dining', 'kitchen', 'storage', 'bathroom'].indexOf(t);
    const sorted = [...types].sort((a, c) => order(a) - order(c));
    // The living room fronts the house; one bedroom does upstairs; the rest go back.
    for (const t of sorted) {
      const frontArea = front.reduce((s, r) => s + (r === 'hall' ? hallLen * 3 : AREA[r]), 0), backArea = back.reduce((s, r) => s + AREA[r], 0);
      if ((t === 'living' || (floor > 0 && t === 'bedroom' && frontArea <= backArea)) && front.length < 3) front.push(t); else back.push(t);
    }
    if (!back.length && front.length > 1) back.push(front.pop()!);
    if (!front.length && back.length > 1) front.push(back.shift()!);
    const fa = front.reduce((s, r) => s + (r === 'hall' ? hallLen * 3 : AREA[r]), 0), ba = back.reduce((s, r) => s + AREA[r], 0);
    // Storeys share the line between front and back rooms (walls stand on walls, and the stair
    // well upstairs opens exactly over the flight).
    const split = back.length ? (sharedSplit ??= round(-hd + Math.max(3, Math.min(Di - 3.2, Di * ba / (fa + ba))))) : -hd;
    const out: Room[] = [];
    const lay = (list: RoomType[], z0: number, z1: number, strip: 'front' | 'back') => {
      if (!list.length) return;
      const fixed = list.includes('hall') ? hallLen : 0;
      const weights = list.map((r) => (r === 'hall' ? 0 : AREA[r]));
      const sum = weights.reduce((s, w) => s + w, 0) || 1, free = Wi - fixed;
      let x = -hw;
      list.forEach((t, i) => {
        const width = t === 'hall' ? hallLen : free * weights[i]! / sum;
        const x1 = i === list.length - 1 ? hw : round(x + width);
        const n = out.filter((r) => r.type === t).length + 1;
        out.push({ id: `f${floor}-${t}-${n}`, type: t, name: `${NAME[t]}${types.filter((r) => r === t).length > 1 ? ` ${n}` : ''}`, floor, x0: x, x1, z0, z1, strip });
        x = x1;
      });
    };
    lay(front, split, hd, 'front');
    lay(back, -hd, split, 'back');
    return out;
  };
  const floorPlans = [plan(ground, 0)];
  if (floors === 2) floorPlans.push(plan(upper, 1));

  // --- Doors: connect every room to the entrance room through shared walls (a spanning tree).
  const shared = (a: Room, c: Room): { axis: 'x' | 'z'; at: number; lo: number; hi: number } | null => {
    if (Math.abs(a.x1 - c.x0) < 1e-6 || Math.abs(c.x1 - a.x0) < 1e-6) {
      const at = Math.abs(a.x1 - c.x0) < 1e-6 ? a.x1 : a.x0, lo = Math.max(a.z0, c.z0), hi = Math.min(a.z1, c.z1);
      return hi - lo > 1.3 ? { axis: 'x', at, lo, hi } : null;
    }
    if (Math.abs(a.z1 - c.z0) < 1e-6 || Math.abs(c.z1 - a.z0) < 1e-6) {
      const at = Math.abs(a.z1 - c.z0) < 1e-6 ? a.z1 : a.z0, lo = Math.max(a.x0, c.x0), hi = Math.min(a.x1, c.x1);
      return hi - lo > 1.3 ? { axis: 'z', at, lo, hi } : null;
    }
    return null;
  };
  const doors: Door[][] = floorPlans.map(() => []);
  floorPlans.forEach((rooms, f) => {
    const start = rooms.find((r) => r.type === 'hall') ?? rooms.find((r) => r.type === 'living') ?? rooms[0]!;
    const reached = new Set([start.id]);
    const prefer = (a: Room, c: Room) => (a.type === 'hall' || c.type === 'hall' ? 0 : (a.type === 'kitchen' && c.type === 'dining') || (a.type === 'dining' && c.type === 'kitchen') ? 1 : a.type === 'living' || c.type === 'living' ? 2 : 3);
    for (let guard = 0; guard < 32 && reached.size < rooms.length; guard++) {
      const options: Array<{ a: Room; c: Room; s: NonNullable<ReturnType<typeof shared>> }> = [];
      for (const a of rooms) if (reached.has(a.id)) for (const c of rooms) if (!reached.has(c.id)) {
        const s = shared(a, c);
        if (!s) continue;
        // The stair flight runs along the hall's back wall: no door opens onto it (or its well upstairs).
        if (floors === 2 && s.axis === 'z' && (a.type === 'hall' || c.type === 'hall')) { s.lo = Math.max(s.lo, stairEndXv + .15); if (s.hi - s.lo < 1.3) continue; }
        options.push({ a, c, s });
      }
      if (!options.length) { notes.push(`Tầng ${f + 1}: không nối được ${rooms.filter((r) => !reached.has(r.id)).map((r) => r.name).join(', ')} (không có tường chung đủ rộng).`); break; }
      options.sort((p, q) => prefer(p.a, p.c) - prefer(q.a, q.c));
      const { a, c, s } = options[0]!;
      const open = (a.type === 'kitchen' && c.type === 'dining') || (a.type === 'dining' && c.type === 'kitchen');
      const width = open ? Math.min(1.6, s.hi - s.lo - .5) : DOOR_W;
      // Doors sit near one end of the shared wall (furniture keeps the long run), never in a corner.
      const pos = s.hi - s.lo > 3 ? s.lo + .45 + width / 2 + (rnd.next() < .5 ? 0 : s.hi - s.lo - .9 - width) : (s.lo + s.hi) / 2;
      doors[f]!.push({ a: a.id, b: c.id, axis: s.axis, at: s.at, pos, width, height: open ? DOOR_H + .1 : DOOR_H, kind: open ? 'arch' : 'door' });
      reached.add(c.id);
    }
  });
  // Entrance on the front of the hall or living room; a back door from the kitchen.
  const groundRooms = floorPlans[0]!;
  const entry = groundRooms.find((r) => r.type === 'hall') ?? groundRooms.find((r) => r.type === 'living')!;
  const entryX = entry.type === 'hall' ? entry.x0 + .7 + FRONT_DOOR_W / 2 : (entry.x0 + entry.x1) / 2 + (rnd.next() - .5) * Math.max(0, entry.x1 - entry.x0 - 2.4);
  doors[0]!.push({ a: entry.id, b: null, axis: 'z', at: hd, pos: entryX, width: FRONT_DOOR_W, height: FRONT_DOOR_H, kind: 'door' });
  const kitchen = groundRooms.find((r) => r.type === 'kitchen' && Math.abs(r.z0 + hd) < 1e-6);
  if (kitchen && kitchen.x1 - kitchen.x0 > 2) doors[0]!.push({ a: kitchen.id, b: null, axis: 'z', at: -hd, pos: kitchen.x1 - .5 - DOOR_W / 2, width: DOOR_W, height: DOOR_H, kind: 'door' });

  // --- Storeys.
  const storeyBase = [0, ceil0], floorTop = [SLAB0, f1], ceilAt = [ceil0, f1 + ROOM_H];
  const topCeil = ceilAt[floors - 1]!, eaves = topCeil + CEIL;
  const stairsStart = { x: entry.type === 'hall' ? entry.x0 + STAIR_FOOT : 0, z: 0 };
  let windows = 0, furnCount = 0;
  const allRooms: RoomInfo[] = [];
  const hallG = groundRooms.find((r) => r.type === 'hall');
  if (hallG) stairsStart.z = hallG.z0 + T_INT / 2 + stairW / 2 + .02;
  const stairHole = hallG ? { x: stairsStart.x + run / 2, z: stairsStart.z, width: run, depth: stairW + .06 } : null;

  for (let f = 0; f < floors; f++) {
    const rooms = floorPlans[f]!, fd = doors[f]!;
    const base = storeyBase[f]!, top = floorTop[f]!, ceil = ceilAt[f]!;
    const storey = b.group(`Tầng ${f + 1}`, root, {}, { tags: ['storey'] });
    const wallsG = b.group('Tường', storey);
    const extH = (f === floors - 1 ? eaves : ceilAt[f]! + (f + 1 < floors ? 0 : CEIL)) - base;
    // Exterior walls: windows per room side, the doors on them.
    const ext = (side: 'front' | 'back' | 'left' | 'right') => {
      const openings: Opening[] = [];
      const along = side === 'front' || side === 'back';
      // Wall-local offset of a world coordinate along it (see the yaw each wall gets below).
      const off = (v: number) => (side === 'front' ? v : side === 'back' ? -v : side === 'right' ? -v : v);
      for (const d of fd) if (d.b === null && ((side === 'front' && d.at > 0) || (side === 'back' && d.at < 0)))
        openings.push({ kind: 'door', offset: off(d.pos), width: d.width, height: d.height, sill: top - base });
      for (const r of rooms) {
        const touches = side === 'front' ? r.z1 >= hd - 1e-6 : side === 'back' ? r.z0 <= -hd + 1e-6 : side === 'left' ? r.x0 <= -hw + 1e-6 : r.x1 >= hw - 1e-6;
        if (!touches) continue;
        const [lo, hi] = along ? [r.x0, r.x1] : [r.z0, r.z1];
        const len = hi - lo;
        if (len < 1.6) continue;
        const [ww, wh, sill] = r.type === 'bathroom' ? [.6, .6, 1.5] : r.type === 'kitchen' ? [1.2, 1, 1.1] : r.type === 'hall' ? [.9, 1.2, 1] : [1.2, 1.3, .9];
        const n = Math.max(1, Math.floor((len - .6) / 2.8));
        for (let i = 0; i < n; i++) {
          const c = lo + len * (i + .5) / n;
          const clash = fd.some((d) => d.b === null && ((side === 'front' && d.at > 0) || (side === 'back' && d.at < 0)) && Math.abs(d.pos - c) < (d.width + ww) / 2 + .4);
          // No window behind the stair flight.
          const stairClash = r.type === 'hall' && !along;
          if (clash || stairClash || Math.min(c - lo, hi - c) < ww / 2 + .3) continue;
          openings.push({ kind: 'window', offset: off(c), width: ww, height: wh, sill: top - base + sill });
        }
      }
      // A ruin has a few holes punched through its outer walls.
      if (damage > .55 && rnd.next() < damage - .4) openings.push({ kind: 'hole', offset: (rnd.next() - .5) * ((along ? Wi : Di) - 3), width: .6 + rnd.next() * .8, height: .5 + rnd.next() * .7, sill: top - base + 1 + rnd.next() * .6 });
      const at = side === 'front' ? { position: [0, base, hd + T_EXT / 2] as [number, number, number] }
        : side === 'back' ? { position: [0, base, -hd - T_EXT / 2] as [number, number, number], rotation: [0, Math.PI, 0] as [number, number, number] }
          : side === 'right' ? { position: [hw + T_EXT / 2, base, 0] as [number, number, number], rotation: [0, Math.PI / 2, 0] as [number, number, number] }
            : { position: [-hw - T_EXT / 2, base, 0] as [number, number, number], rotation: [0, -Math.PI / 2, 0] as [number, number, number] };
      const len = along ? Wi + T_EXT * 2 : Di;
      const id = b.wall(`Tường ${side === 'front' ? 'trước' : side === 'back' ? 'sau' : side === 'left' ? 'trái' : 'phải'}`, wallsG, len, extH, T_EXT, openings, mat.ext, at, mat.int);
      // Glass, sills and frames in the windows.
      for (const o of openings) {
        if (o.kind !== 'window') continue;
        windows++;
        const w = b.group('Cửa sổ', id, { position: [o.offset, 0, 0] });
        b.box('Bậu cửa', w, [-o.width / 2 - .05, o.sill - .05, -.02], [o.width / 2 + .05, o.sill, T_EXT / 2 + .06], mat.trim);
        if (!(damage > .25 && rnd.next() < damage)) b.box('Kính', w, [-o.width / 2, o.sill, -.01], [o.width / 2, o.sill + o.height, .01], mat.glass);
        b.box('Đố dọc', w, [-.025, o.sill, -.03], [.025, o.sill + o.height, .03], mat.trim, { collision: 'none' });
        b.box('Đố ngang', w, [-o.width / 2, o.sill + o.height * .55 - .025, -.03], [o.width / 2, o.sill + o.height * .55 + .025, .03], mat.trim, { collision: 'none' });
      }
    };
    ext('front'); ext('back'); ext('left'); ext('right');

    // Interior partitions: along every room boundary, with the doors on it.
    const segs = new Map<string, { axis: 'x' | 'z'; at: number; lo: number; hi: number }>();
    for (const a of rooms) for (const c of rooms) {
      if (a.id >= c.id) continue;
      const s = shared(a, c) ?? (() => {
        // Boundaries too short for a door still get a wall.
        if (Math.abs(a.x1 - c.x0) < 1e-6 || Math.abs(c.x1 - a.x0) < 1e-6) { const lo = Math.max(a.z0, c.z0), hi = Math.min(a.z1, c.z1); return hi - lo > .05 ? { axis: 'x' as const, at: Math.abs(a.x1 - c.x0) < 1e-6 ? a.x1 : a.x0, lo, hi } : null; }
        if (Math.abs(a.z1 - c.z0) < 1e-6 || Math.abs(c.z1 - a.z0) < 1e-6) { const lo = Math.max(a.x0, c.x0), hi = Math.min(a.x1, c.x1); return hi - lo > .05 ? { axis: 'z' as const, at: Math.abs(a.z1 - c.z0) < 1e-6 ? a.z1 : a.z0, lo, hi } : null; }
        return null;
      })();
      if (s) segs.set(`${s.axis}:${s.at.toFixed(3)}:${s.lo.toFixed(3)}`, s);
    }
    // Join collinear touching segments into one wall each.
    const lines = [...segs.values()].sort((p, q) => (p.axis === q.axis ? (p.at - q.at) || (p.lo - q.lo) : p.axis < q.axis ? -1 : 1));
    const merged: typeof lines = [];
    for (const s of lines) {
      const last = merged[merged.length - 1];
      if (last && last.axis === s.axis && Math.abs(last.at - s.at) < 1e-6 && s.lo <= last.hi + 1e-6) last.hi = Math.max(last.hi, s.hi); else merged.push({ ...s });
    }
    for (const s of merged) {
      // Partitions stop at the exterior walls' inner faces and run under the ceiling.
      const lo = s.lo, hi = s.hi, len = hi - lo, mid = (lo + hi) / 2;
      const openings: Opening[] = [];
      for (const d of fd) if (d.b !== null && d.axis === s.axis && Math.abs(d.at - s.at) < 1e-6 && d.pos > lo && d.pos < hi)
        openings.push({ kind: d.kind, offset: s.axis === 'z' ? d.pos - mid : mid - d.pos, width: d.width, height: d.height, sill: 0 });
      const at = s.axis === 'z' ? { position: [mid, top, s.at] as [number, number, number] } : { position: [s.at, top, mid] as [number, number, number], rotation: [0, Math.PI / 2, 0] as [number, number, number] };
      b.wall('Vách ngăn', wallsG, len, ceil - top, T_INT, openings, mat.int, at, mat.int);
    }

    // Rooms: a slab each (tiles in kitchens and bathrooms), the stairwell cut upstairs.
    for (const r of rooms) {
      const g = b.group(r.name, storey, {}, { tags: ['room', r.type] });
      const w = r.x1 - r.x0, d = r.z1 - r.z0, cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
      const holes = f === 1 && r.type === 'hall' && stairHole ? [{ x: stairHole.x - cx, z: stairHole.z - cz, width: stairHole.width, depth: stairHole.depth }] : [];
      const floorMat = r.type === 'kitchen' || r.type === 'bathroom' ? mat.tiles : r.type === 'hall' && style === 'modern' ? mat.tiles : mat.floor;
      const t = f === 0 ? SLAB0 : SLAB1;
      b.slab('Sàn', g, w, d, t, holes, floorMat, { position: [cx, top - t, cz] });
      allRooms.push({ id: r.id, type: r.type, name: r.name, floor: f, x0: r.x0, x1: r.x1, z0: r.z0, z1: r.z1, area: Math.round(w * d * 10) / 10 });
      if (spec.furniture !== false) furnCount += furnish(b, r, g, top, fd, rooms, furn, rnd, damage, f === 0 && hallG && r.id === hallG.id ? { x0: hallG.x0, x1: stairsStart.x + run + .1, z0: hallG.z0, z1: stairsStart.z + stairW / 2 + 1 } : null, (f === 1 && r.type === 'hall' && stairHole) ? { x0: stairHole.x - stairHole.width / 2 - .1, x1: stairHole.x + stairHole.width / 2 + .9, z0: r.z0, z1: stairHole.z + stairHole.depth / 2 + .3 } : null);
    }
    // Top storey ceiling (a ruin's has fallen in places).
    if (f === floors - 1) {
      const holes = damage > .4 ? Array.from({ length: 1 + Math.floor(damage * 3) }, () => ({ x: (rnd.next() - .5) * (Wi - 3), z: (rnd.next() - .5) * (Di - 3), width: 1 + rnd.next() * 1.5, depth: 1 + rnd.next() * 1.5 })) : [];
      b.slab('Trần', storey, Wi, Di, CEIL, holes, mat.ceiling, { position: [0, ceil, 0] });
    }
  }

  // Stairs and the railing round the stairwell upstairs.
  if (hallG && floors === 2) {
    b.stairs('Cầu thang', root, stairW, rise, run, steps, mat.trim, { position: [stairsStart.x, SLAB0, stairsStart.z], rotation: [0, Math.PI / 2, 0] });
    const rail = b.group('Lan can', root, { position: [0, f1, 0] });
    const zr = stairsStart.z + stairW / 2 + .05;
    b.box('Tay vịn', rail, [stairsStart.x, .95, zr - .03], [stairsStart.x + run, 1, zr + .03], mat.trim);
    b.box('Thanh chắn', rail, [stairsStart.x, 0, zr - .02], [stairsStart.x + run, .95, zr + .02], mat.trim);
    b.box('Thanh chắn đầu', rail, [stairsStart.x - .04, 0, stairsStart.z - stairW / 2], [stairsStart.x, 1, zr], mat.trim);
  }

  // Roof over the walls with its overhang (gable across the short side, ridge along x).
  const roofRise = style === 'modern' ? 0 : Math.min(3.2, (Di + T_EXT * 2) / 2 * Math.tan((style === 'cottage' ? 40 : 30) * Math.PI / 180));
  const roofG = b.group('Mái', root, { position: [0, eaves, 0] });
  b.roof('Mái nhà', roofG, { style: style === 'modern' ? 'flat' : style === 'cottage' ? 'hip' : 'gable', width: Wi + T_EXT * 2, depth: Di + T_EXT * 2, rise: roofRise, overhang: style === 'modern' ? .15 : .45, thickness: style === 'postapoc' ? .08 : .14, damage: style === 'cottage' ? 0 : Math.min(.6, damage * .55), seed: seed ^ 0x51 }, mat.roof, {});
  // Gable ends close the triangle between the walls and the roof.
  if (style !== 'modern' && style !== 'cottage') for (const side of [-1, 1]) b.primitive('Đầu hồi', roofG, 'wedge', { width: T_EXT, height: roofRise, depth: Di + T_EXT * 2, ridge: .5 }, mat.ext, { position: [side * (hw + T_EXT / 2), 0, 0] });
  if (style === 'modern') for (const [x, z, w, d] of [[0, hd + T_EXT / 2, Wi + T_EXT * 2, T_EXT], [0, -hd - T_EXT / 2, Wi + T_EXT * 2, T_EXT], [hw + T_EXT / 2, 0, T_EXT, Di], [-hw - T_EXT / 2, 0, T_EXT, Di]] as const)
    b.box('Tường chắn mái', roofG, [x - w / 2, 0, z - d / 2], [x + w / 2, .6, z + d / 2], mat.ext);

  // Entrance steps (the floor stands 15 cm above the ground).
  const outside = b.group('Ngoại thất', root, {}, { tags: ['exterior'] });
  for (const d of doors[0]!.filter((x) => x.b === null)) {
    const zf = d.at > 0 ? hd + T_EXT : -hd - T_EXT, dir = d.at > 0 ? 1 : -1;
    b.box('Bậc thềm', outside, [d.pos - d.width / 2 - .3, 0, Math.min(zf, zf + dir * .8)], [d.pos + d.width / 2 + .3, SLAB0, Math.max(zf, zf + dir * .8)], mat.concrete);
  }

  // Yard, path, fence and garden.
  const yardFront = 6, yardBack = spec.garden === false ? 4 : 9, yardSide = 3;
  const Xo = hw + T_EXT + yardSide, Zf = hd + T_EXT + yardFront, Zb = hd + T_EXT + yardBack;
  if (spec.yard !== false) {
    const grass = b.material('co-san', 'grass', { dirt: damage * .5, seed: seed ^ 20 }).id;
    const gravel = b.material('soi', 'gravel', { moss: damage * .5, seed: seed ^ 21 }).id;
    b.box('Sân cỏ', outside, [-Xo, -.02, -Zb], [Xo, .015, Zf], grass, { collision: 'none' });
    b.box('Lối đi', outside, [entryX - .7, -.01, hd + T_EXT + .8], [entryX + .7, .03, Zf], gravel, { collision: 'none' });
    if (spec.fence !== false) {
      const fenceMat = b.material('hang-rao', 'wood_weathered', { wear: .3 + damage * .5, moss: damage * .6, seed: seed ^ 22 }).id;
      const fence = b.group('Hàng rào', outside, {}, { tags: ['fence'] });
      const run2 = (ax: number, az: number, bx: number, bz: number, gate?: number) => {
        const len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(len / 2.4));
        for (let i = 0; i < n; i++) {
          const t0 = i / n, t1 = (i + 1) / n;
          const x0 = ax + (bx - ax) * t0, z0 = az + (bz - az) * t0, x1 = ax + (bx - ax) * t1, z1 = az + (bz - az) * t1;
          const mx = (x0 + x1) / 2;
          if (gate !== undefined && Math.abs(mx - gate) < 1.3 && Math.abs(az - bz) < 1e-6) continue;
          // Old fences lean and lose sections.
          if (damage > .3 && rnd.next() < damage * .25) continue;
          const lean = damage * (rnd.next() - .5) * .25;
          const sec = b.group('Đoạn rào', fence, { position: [(x0 + x1) / 2, 0, (z0 + z1) / 2], rotation: [lean, Math.atan2(-(z1 - z0), x1 - x0), 0] });
          const half = Math.hypot(x1 - x0, z1 - z0) / 2;
          b.box('Cột', sec, [-half - .05, 0, -.05], [-half + .05, 1.1, .05], fenceMat);
          b.box('Thanh ngang', sec, [-half, .35, -.03], [half, .45, .03], fenceMat);
          b.box('Thanh ngang', sec, [-half, .8, -.03], [half, .9, .03], fenceMat);
        }
      };
      run2(-Xo, Zf, Xo, Zf, entryX); run2(Xo, -Zb, -Xo, -Zb); run2(-Xo, -Zb, -Xo, Zf); run2(Xo, Zf, Xo, -Zb);
    }
    if (spec.garden !== false) {
      const garden = b.group('Vườn', outside, {}, { tags: ['garden'] });
      const soil = b.material('dat-vuon', 'ground_dirt', { seed: seed ^ 23 }).id;
      const frame = b.material('khung-luong', 'wood_weathered', { seed: seed ^ 24 }).id;
      const zb = -hd - T_EXT - yardBack / 2;
      for (let i = 0; i < 2; i++) {
        const x = -hw + 1.2 + i * 2.2;
        b.box('Luống rau', garden, [x - .7, 0, zb - 1.6], [x + .7, .3, zb + 1.6], soil);
        b.box('Khung luống', garden, [x - .75, 0, zb - 1.65], [x - .7, .35, zb + 1.65], frame);
        b.box('Khung luống', garden, [x + .7, 0, zb - 1.65], [x + .75, .35, zb + 1.65], frame);
      }
      // Trees and bushes of the game (shared models), rocks made here.
      const trees = [2440, 2441, 2442, 2443, 2444], bushes = [2460, 2461, 2462];
      b.asset('Cây', garden, rnd.pick(trees), { position: [hw - .5, 0, -Zb + 2.2], rotation: [0, rnd.next() * 6.28, 0], scale: [.8, .8, .8] });
      if (Wi > 9) b.asset('Cây', garden, rnd.pick(trees), { position: [-hw + .2, 0, -Zb + 2], rotation: [0, rnd.next() * 6.28, 0], scale: [.7, .7, .7] });
      for (let i = 0; i < 3 + Math.round(damage * 4); i++) {
        const side = rnd.next() < .5 ? -1 : 1;
        b.asset('Bụi cây', garden, rnd.pick(bushes), { position: [side * (Xo - .9), 0, -Zb + 1 + rnd.next() * (Zb + Zf - 3)], rotation: [0, rnd.next() * 6.28, 0], scale: [.55, .55, .55] });
      }
      const rockMat = b.material('da-vuon', 'rock_granite', { moss: .3 + damage * .5, seed: seed ^ 25 }).id;
      for (let i = 0; i < 3; i++) b.rock('Đá', garden, { width: .5 + rnd.next() * .6, height: .3 + rnd.next() * .3, depth: .5 + rnd.next() * .5, seed: seed + i, roughness: .6, layers: .3, detail: 2 }, rockMat, { position: [Xo - 1.2 - rnd.next() * 1.5, 0, Zf - 1 - rnd.next() * 2], rotation: [0, rnd.next() * 6.28, 0] });
    }
  }
  for (const id of ['hang-rao', 'dat-vuon', 'khung-luong', 'da-vuon', 'soi']) { const m = doc.materials.find((x) => x.id === id); if (m && !m.resolution) m.resolution = 256; }
  if (damage > .5) notes.push('Nhà bỏ hoang: mái thủng, tường nứt, rêu và bụi bẩn theo số năm; cửa ra vào để trống.');
  notes.push('Cửa ra vào là khoảng mở (không có cánh cửa động); cửa có cánh của chế độ BR được map đặt riêng.');
  const report: HouseReport = {
    root, footprint: { width: round(Wi + T_EXT * 2), depth: round(Di + T_EXT * 2) }, height: round(eaves + roofRise), floors,
    rooms: allRooms, doors: doors.reduce((s, d) => s + d.length, 0), windows, furniture: furnCount, damage: Math.round(damage * 100) / 100, notes,
  };
  return report;
}

function round(v: number): number { return Math.round(v * 20) / 20; }

/** What furnishes a room, in the order it is placed. */
const ROOM_FURNITURE: Record<RoomType, FurnitureKind[]> = {
  living: ['sofa', 'tv_cabinet', 'armchair', 'bookshelf', 'coffee_table', 'rug'],
  kitchen: ['counter', 'stove', 'fridge', 'sink_unit', 'table'],
  dining: ['dining_table', 'sideboard'],
  bedroom: ['bed', 'wardrobe', 'nightstand', 'desk'],
  bathroom: ['bathtub', 'toilet', 'basin'],
  hall: ['cabinet'],
  storage: ['shelves', 'crate', 'crate', 'shelves'],
};

type Rect = { x0: number; x1: number; z0: number; z1: number };

/**
 * Stands furniture against the room's walls, never in front of a door (1 m kept clear on both
 * sides) or across a window (tall pieces), never overlapping; centre pieces (rugs, coffee and
 * dining tables) go in the middle of what is left. A ruin's furniture is tipped over and strewn
 * with rubble.
 */
function furnish(b: DocBuilder, r: Room, parent: string, floorY: number, doors: Door[], rooms: Room[], m: FurnitureMaterials, rnd: Random, damage: number, keepClear: Rect | null, keepClear2: Rect | null): number {
  const inset = T_INT / 2 + .03;
  const area: Rect = { x0: r.x0 + inset, x1: r.x1 - inset, z0: r.z0 + inset, z1: r.z1 - inset };
  const taken: Rect[] = [];
  if (keepClear) taken.push(keepClear);
  if (keepClear2) taken.push(keepClear2);
  // Door swing / passage zones.
  for (const d of doors) {
    const touches = d.a === r.id || d.b === r.id;
    if (!touches) continue;
    if (d.axis === 'z') taken.push({ x0: d.pos - d.width / 2 - .25, x1: d.pos + d.width / 2 + .25, z0: d.at - 1.2, z1: d.at + 1.2 });
    else taken.push({ x0: d.at - 1.2, x1: d.at + 1.2, z0: d.pos - d.width / 2 - .25, z1: d.pos + d.width / 2 + .25 });
  }
  void rooms;
  const overlaps = (a: Rect) => taken.some((t) => a.x0 < t.x1 && a.x1 > t.x0 && a.z0 < t.z1 && a.z1 > t.z0);
  const inside = (a: Rect) => a.x0 >= area.x0 - 1e-6 && a.x1 <= area.x1 + 1e-6 && a.z0 >= area.z0 - 1e-6 && a.z1 <= area.z1 + 1e-6;
  let placed = 0;
  // Walls in order of preference: back wall first (away from the entrance side), then the sides.
  const sides = (['back', 'left', 'right', 'front'] as const);
  const place = (kind: FurnitureKind): boolean => {
    const [w, d, h] = FURNITURE_SIZE[kind];
    if (kind === 'rug' || kind === 'coffee_table' || kind === 'dining_table' || kind === 'table') {
      const cx = (area.x0 + area.x1) / 2, cz = (area.z0 + area.z1) / 2;
      const along = area.x1 - area.x0 >= area.z1 - area.z0;
      const [fw, fd] = along ? [w, d] : [d, w];
      for (const [dx, dz] of [[0, 0], [.4, 0], [-.4, 0], [0, .4], [0, -.4]] as const) {
        const rect = { x0: cx + dx - fw / 2, x1: cx + dx + fw / 2, z0: cz + dz - fd / 2, z1: cz + dz + fd / 2 };
        if (!inside(rect) || (kind !== 'rug' && overlaps(rect))) continue;
        const yaw = along ? 0 : Math.PI / 2;
        // Origin at the back edge middle, facing +z (turned for a long room along z).
        const ox = along ? cx + dx : cx + dx - d / 2, oz = along ? cz + dz - d / 2 : cz + dz;
        furniture(b, kind, parent, m, { position: [ox, floorY, oz], yaw: along ? 0 : yaw });
        if (kind !== 'rug') taken.push(rect);
        // Chairs round a dining table.
        if (kind === 'dining_table') {
          const n = 2;
          for (let i = 0; i < n; i++) for (const s of [-1, 1]) {
            const off = (i - (n - 1) / 2) * .7;
            const px = along ? cx + dx + off : cx + dx + s * (fd / 2 + .32), pz = along ? cz + dz + s * (fd / 2 + .32) : cz + dz + off;
            const yawC = along ? (s > 0 ? Math.PI : 0) : (s > 0 ? -Math.PI / 2 : Math.PI / 2);
            // A chair faces +z with its back at its origin: push the origin out by its depth.
            const bx = px + Math.sin(yawC) * -.25, bz = pz + Math.cos(yawC) * -.25;
            const tipped = damage > .4 && rnd.next() < damage * .5;
            furniture(b, 'chair', parent, m, { position: [bx, floorY, bz], yaw: yawC, tilt: tipped ? Math.PI / 2 * .98 : 0 });
            placed++;
          }
        }
        return true;
      }
      return false;
    }
    for (const side of sides) {
      const horizontal = side === 'back' || side === 'front';
      const lo = horizontal ? area.x0 : area.z0, hi = horizontal ? area.x1 : area.z1;
      for (let c = lo + w / 2 + .05; c <= hi - w / 2 - .05; c += .25) {
        const rect = side === 'back' ? { x0: c - w / 2, x1: c + w / 2, z0: area.z0, z1: area.z0 + d }
          : side === 'front' ? { x0: c - w / 2, x1: c + w / 2, z0: area.z1 - d, z1: area.z1 }
            : side === 'left' ? { x0: area.x0, x1: area.x0 + d, z0: c - w / 2, z1: c + w / 2 }
              : { x0: area.x1 - d, x1: area.x1, z0: c - w / 2, z1: c + w / 2 };
        if (!inside(rect) || overlaps(rect)) continue;
        // Tall pieces keep off exterior walls with windows: only against interior walls or blank runs.
        if (h > 1.1 && ((side === 'front' && r.z1 >= 0 && r.strip === 'front') || (side === 'back' && r.strip === 'back'))) continue;
        const yaw = side === 'back' ? 0 : side === 'front' ? Math.PI : side === 'left' ? Math.PI / 2 : -Math.PI / 2;
        const ox = side === 'left' ? area.x0 : side === 'right' ? area.x1 : c, oz = side === 'back' ? area.z0 : side === 'front' ? area.z1 : c;
        const tipped = damage > .5 && h < 1.2 && rnd.next() < damage * .3;
        furniture(b, kind, parent, m, { position: [ox, floorY, oz], yaw, tilt: tipped ? .25 : 0 });
        taken.push(rect);
        if (kind === 'bed') for (const s of [-1, 1]) {
          const nx = side === 'back' || side === 'front' ? c + s * (w / 2 + .3) : ox, nz = side === 'left' || side === 'right' ? c + s * (w / 2 + .3) : oz;
          const nrect = side === 'back' || side === 'front' ? { x0: nx - .23, x1: nx + .23, z0: rect.z0, z1: rect.z0 + .4 } : { x0: rect.x0, x1: rect.x0 + .4, z0: nz - .23, z1: nz + .23 };
          if (inside(nrect) && !overlaps(nrect)) { furniture(b, 'nightstand', parent, m, { position: [nx, floorY, nz], yaw }); taken.push(nrect); placed++; }
        }
        if (kind === 'desk') {
          const inward = { x: Math.sin(yaw), z: Math.cos(yaw) };
          furniture(b, 'chair', parent, m, { position: [ox + inward.x * (d + .45), floorY, oz + inward.z * (d + .45)], yaw: yaw + Math.PI });
          placed++;
        }
        return true;
      }
    }
    return false;
  };
  for (const kind of ROOM_FURNITURE[r.type]) if (kind !== 'nightstand' && place(kind)) placed++;
  // Rubble in a ruin.
  if (damage > .3) {
    const n = Math.round(damage * 5);
    for (let i = 0; i < n; i++) {
      const x = area.x0 + .3 + rnd.next() * (area.x1 - area.x0 - .6), z = area.z0 + .3 + rnd.next() * (area.z1 - area.z0 - .6);
      const s = .15 + rnd.next() * .25;
      b.rock('Gạch vụn', parent, { width: s * 1.5, height: s, depth: s * 1.2, seed: Math.floor(rnd.next() * 1e6), roughness: .8, layers: 0, detail: 1 }, 'be-tong', { position: [x, floorY, z], rotation: [0, rnd.next() * 6.28, 0] });
    }
  }
  return placed;
}
