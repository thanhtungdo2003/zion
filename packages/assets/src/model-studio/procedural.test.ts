import { describe, expect, it } from 'vitest';
import { emptyDoc, type FloorPlan } from './doc';
import { facadeBays, junctionBands, rectangles, snapSeams, wallsFromRooms } from './procedural';
import { checkPlan, verifyBuilt } from './plans';
import { runTool, type ToolState } from './tools';
import { validateDoc } from './validate';

type Room = FloorPlan['rooms'][number];
const room = (name: string, type: string, x0: number, z0: number, x1: number, z1: number): Room => ({ id: name, name, type, x0, z0, x1, z1 });

describe('procedural layout: rooms → walls, doors, windows, roof', () => {
  it('derives each wall once from the room edges: exterior where one room owns the edge, none inside an L room', () => {
    const walls = wallsFromRooms([room('A', 'living', 0, 0, 4, 4), room('B', 'bedroom', 4, 0, 8, 4), room('L', 'hall', 0, 4, 4, 6), room('L', 'hall', 4, 4, 8, 6)]);
    const interior = walls.filter((w) => !w.exterior);
    // A|B partition and the A/B edges against the L; the seam between the L's two pieces gets none.
    expect(interior.map((w) => [w.a, w.b])).toEqual(expect.arrayContaining([[[0, 4], [4, 4]], [[4, 4], [8, 4]], [[4, 0], [4, 4]]]));
    expect(interior.some((w) => w.a[0] === 4 && w.a[1] === 4 && w.b[0] === 4 && w.b[1] === 6)).toBe(false);
    // The outline: 8 × 6 m, closed.
    const ext = walls.filter((w) => w.exterior), len = ext.reduce((s, w) => s + Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]), 0);
    expect(len).toBeCloseTo(28);
    expect(() => wallsFromRooms([room('A', 'x', 0, 0, 4, 4), room('B', 'x', 0, 0, 4, 4), room('C', 'x', 0, 0, 4, 4)])).toThrow(/chồng nhau/);
  });

  it('moves room edges that nearly line up onto one seam, never into an overlap', () => {
    const { rooms, moved } = snapSeams([room('A', 'x', 0, 0, 2.95, 4), room('B', 'x', 3.05, 0, 6, 4)]);
    expect(moved).toBe(2);
    expect(rooms[0]!.x1).toBe(rooms[1]!.x0);
  });

  it('splits a façade into bays (CGA repeat), clear of the ends and of a door', () => {
    const at = facadeBays(0, 12, 1.2, { bay: 3, margin: .5, taken: [{ at: 6.1, width: 1 }] });
    expect(at.length).toBe(3);
    for (const a of at) { expect(a - .6).toBeGreaterThanOrEqual(.5); expect(a + .6).toBeLessThanOrEqual(11.5); expect(Math.abs(a - 6.1)).toBeGreaterThan(1.1); }
    // Lined up with the storey below when one is near.
    expect(facadeBays(0, 6, 1.2, { bay: 3, prefer: [1.6, 4.4] })).toEqual([1.6, 4.4]);
  });

  it('cuts an L footprint into two roof blocks and finds the junctions an opening must keep clear of', () => {
    const blocks = rectangles([{ x0: 0, z0: 0, x1: 10, z1: 4 }, { x0: 0, z0: 4, x1: 4, z1: 9 }]);
    expect(blocks).toHaveLength(2);
    expect(blocks.reduce((s, r) => s + (r.x1 - r.x0) * (r.z1 - r.z0), 0)).toBeGreaterThanOrEqual(10 * 4 + 4 * 5);
    const walls = wallsFromRooms([room('A', 'living', 0, 0, 4, 4), room('B', 'bedroom', 4, 0, 8, 4)]);
    const south = walls.find((w) => w.exterior && w.a[1] === 0 && w.a[0] === 0)!;
    expect(junctionBands(walls, south).some((b) => b.lo < 4 && b.hi > 4)).toBe(true);
  });

  it('flags an opening drawn into a corner', () => {
    const doc = emptyDoc('Nhà', 'building');
    const walls = wallsFromRooms([room('A', 'living', 0, 0, 4, 4)]);
    walls[0]!.openings.push({ kind: 'window', at: .1, width: 1, height: 1, sill: 1 });
    const plan: FloorPlan = { level: 0, name: 'T', elevation: .15, height: 2.8, slab: .15, rooms: [room('A', 'living', 0, 0, 4, 4)], walls, stairs: [], voids: [] };
    expect(checkPlan(doc, plan).map((i) => i.message).join(' ')).toMatch(/cắt vào chỗ nối/);
  });

  it('builds a two-storey house from a grid of rooms: walls, doors, windows, stairs, roof and collision all generated and checked', async () => {
    const s: ToolState = { doc: emptyDoc('Nhà', 'building'), host: { assets: [], designOnly: true }, changed: false };
    expect((await runTool('define_materials', { materials: [
      { id: 'brick', name: 'Gạch trát sơn', uses: ['tường ngoài'], preset: 'brick_red' },
      { id: 'plaster', name: 'Vữa sơn', uses: ['tường trong'], preset: 'plaster_white' },
      { id: 'concrete', name: 'Bê tông', uses: ['kết cấu cầu thang'], preset: 'concrete' },
      { id: 'tiles', name: 'Ngói', uses: ['mái'], preset: 'roof_tiles' },
    ] }, s)).ok).toBe(true);
    const storey = (level: number) => ({
      level, name: level ? 'Tầng 2' : 'Tầng trệt', height: 3,
      grid: { cols: [{ size: 4 }, { size: 6 }], rows: [{ size: 5 }, { size: 4 }] },
      rooms: level
        ? [{ id: 'hall', name: 'Sảnh trên', type: 'hall', cols: [0, 1], rows: [0, 2] }, { id: 'b1', name: 'Phòng ngủ 1', type: 'bedroom', cols: [1, 2], rows: [0, 1] }, { id: 'b2', name: 'Phòng ngủ 2', type: 'bedroom', cols: [1, 2], rows: [1, 2] }]
        : [{ id: 'hall', name: 'Sảnh', type: 'hall', cols: [0, 1], rows: [0, 2] }, { id: 'living', name: 'Phòng khách', type: 'living', cols: [1, 2], rows: [0, 1] }, { id: 'kitchen', name: 'Bếp', type: 'kitchen', cols: [1, 2], rows: [1, 2] }],
      walls: 'auto', wallSpec: { exterior: { thickness: .25, material: 'brick', innerMaterial: 'plaster' }, interior: { thickness: .12, material: 'plaster' } },
      links: level ? [] : [{ a: 'Sảnh', b: 'Phòng khách' }, { a: 'Phòng khách', b: 'Bếp', kind: 'open' }],
      ...(level ? {} : { entrance: 'Sảnh' }),
      windows: 'auto',
      stairs: level ? [] : [{ id: 'st', x: .3, z: 1, width: 1, direction: 's', shape: 'u', style: 'solid', turn: 'left', material: 'concrete' }],
    });
    type Drawn = { ok: true; result: { errors: string[]; generated?: string[] } } | { ok: false; error: string };
    await runTool('research', { query: 'two storey house plan' }, s);
    for (const level of [0, 1]) {
      const r = await runTool('draw_floor_plan', storey(level), s) as Drawn;
      expect(r.ok && r.result.errors).toEqual([]);
      expect(r.ok && r.result.generated?.join(' ')).toMatch(/tường sinh từ mép phòng/);
    }
    // Redraw the ground floor now the upper storey exists (its well and arrival are checked against it).
    expect(((await runTool('draw_floor_plan', storey(0), s)) as Drawn).ok).toBe(true);
    const [g, u] = s.doc.plans!;
    for (const p of [g!, u!]) {
      expect(checkPlan(s.doc, p).filter((i) => i.level === 'error')).toEqual([]);
      // Windows only on exterior walls; each room on the outside has one.
      for (const w of p.walls) if (!w.exterior) expect(w.openings.filter((o) => o.kind === 'window')).toEqual([]);
      expect(p.walls.filter((w) => w.exterior).flatMap((w) => w.openings).filter((o) => o.kind === 'window').length).toBeGreaterThanOrEqual(4);
    }
    // Doors: the link, the open passage, the front door; upstairs every bedroom joined to the hall without being asked.
    const doorsOn = (p: FloorPlan, x: number) => p.walls.filter((w) => !w.exterior && w.a[0] === x && w.b[0] === x).flatMap((w) => w.openings);
    expect(doorsOn(g!, 4).map((o) => o.kind)).toEqual(['door']);
    expect(g!.walls.some((w) => w.openings.some((o) => o.kind === 'hole'))).toBe(true);
    expect(g!.walls.some((w) => w.exterior && w.openings.some((o) => o.kind === 'door'))).toBe(true);
    expect(doorsOn(u!, 4).filter((o) => o.kind === 'door')).toHaveLength(2);
    // Upstairs windows line up with the ones below on the same façade.
    const centres = (p: FloorPlan) => p.walls.filter((w) => w.exterior && w.a[1] === w.b[1] && w.a[1] === 9).flatMap((w) => w.openings.filter((o) => o.kind === 'window').map((o) => +(w.a[0] + Math.sign(w.b[0] - w.a[0]) * o.at).toFixed(2)));
    expect(centres(u!).some((c) => centres(g!).includes(c))).toBe(true);
    // Approved, built, verified; then the roof over the top storey.
    for (const level of [0, 1]) {
      const p = s.doc.plans!.find((x) => x.level === level)!;
      const ok = await runTool('approve_floor_plan', { level, basis: 'Nhà hai tầng 10×9 m theo lưới trục, tường và cửa sinh từ mặt bằng.', stairs: p.stairs.map((st) => ({ id: st.id, position: 'sát tường sảnh', direction: 'theo hướng vẽ', start: 'chân thang ra sảnh', landing: 'chiếu nghỉ bằng bề rộng vế', turn: 'quay trái', link: 'lên sảnh trên', headroom: 'giếng thang phủ bậc' })) }, s);
      expect(ok.ok).toBe(true);
      expect((await runTool('build_floor', { level }, s)).ok).toBe(true);
    }
    for (const p of s.doc.plans!) expect(verifyBuilt(s.doc, p)).toEqual([]);
    const roof = await runTool('build_roof', { style: 'gable', pitch: 30, material: 'tiles' }, s) as { ok: true; result: { eaves: number; verification: { ok: boolean } } };
    expect(roof.ok && roof.result.verification).toEqual({ ok: true });
    expect(roof.ok && roof.result.eaves).toBeCloseTo(u!.elevation + u!.height);
    expect(s.doc.nodes.filter((n) => n.kind === 'roof')).toHaveLength(1);
    // Built geometry the player collides with, not an empty shell.
    const report = validateDoc(s.doc);
    expect(report.issues.map((i) => i.code)).not.toEqual(expect.arrayContaining(['empty']));
    expect(report.issues.map((i) => i.code)).not.toEqual(expect.arrayContaining(['no-collision']));
    expect(s.doc.nodes.filter((n) => n.kind === 'wall').length).toBeGreaterThan(10);
  });
});
