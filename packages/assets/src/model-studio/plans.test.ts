import { describe, expect, it } from 'vitest';
import { emptyDoc, parseDoc } from './doc';
import { stairFootprint, stairRise } from './plans';
import { runTool, type ToolState } from './tools';
import { validateDoc } from './validate';

type R = { ok: true; result: { errors: string[]; warnings: string[]; plan: { stairs: Array<{ footprint: number[] }> } } } | { ok: false; error: string };

/** A 10 × 8 m storey: a 5 m hall with the stairs and a door in, living room, bedroom behind. */
function ground(withDoor: boolean, stairs = true) {
  return {
    level: 0, name: 'Tầng trệt', height: 2.8,
    rooms: [
      { id: 'hall', name: 'Sảnh', type: 'hall', x0: 0, z0: 0, x1: 5, z1: 8, floorMaterial: 'ceramic_tiles' },
      { id: 'living', name: 'Phòng khách', type: 'living', x0: 5, z0: 0, x1: 10, z1: 5 },
      { id: 'bed', name: 'Phòng ngủ', type: 'bedroom', x0: 5, z0: 5, x1: 10, z1: 8 },
    ],
    walls: [
      { id: 'n', a: [0, 0], b: [10, 0], thickness: .25, exterior: true, material: 'brick_red', openings: [{ kind: 'window', at: 7, width: 1.2, height: 1.2, sill: .9 }] },
      { id: 'e', a: [10, 0], b: [10, 8], thickness: .25, exterior: true, material: 'brick_red', openings: [] },
      { id: 's', a: [10, 8], b: [0, 8], thickness: .25, exterior: true, material: 'brick_red', openings: withDoor ? [{ kind: 'door', at: 8, width: 1, height: 2.1, sill: 0 }] : [] },
      { id: 'w', a: [0, 8], b: [0, 0], thickness: .25, exterior: true, material: 'brick_red', openings: [] },
      { id: 'i1', a: [5, 0], b: [5, 8], thickness: .12, exterior: false, material: 'plaster_white', openings: [{ kind: 'door', at: 2.5, width: .9, height: 2.1, sill: 0 }, { kind: 'door', at: 6.5, width: .9, height: 2.1, sill: 0 }] },
      { id: 'i2', a: [5, 5], b: [10, 5], thickness: .12, exterior: false, material: 'plaster_white', openings: [] },
    ],
    stairs: stairs ? [{ id: 'st', x: .65, z: .15, width: 1, direction: 's', shape: 'l', style: 'solid', turn: 'right', material: 'concrete', treadMaterial: 'granite', railMaterial: 'steel', handrailMaterial: 'wood_oak' }] : [],
    finishes: { plinth: 'stone_plinth', skirting: 'wood_oak', windowFrame: 'wood_oak', doorLeaf: 'wood_oak' },
    ceilingMaterial: 'plaster_white',
  };
}

describe('floor plans', () => {
  const state = (): ToolState => ({ doc: emptyDoc('Nhà', 'building'), host: { assets: [], designOnly: true }, changed: false });
  /** The schedule a plan's materials must come from. */
  const schedule = (s: ToolState) => runTool('define_materials', { materials: [
    { id: 'brick_red', name: 'Gạch đỏ trát', uses: ['tường ngoài'], preset: 'brick_red' },
    { id: 'plaster_white', name: 'Vữa sơn trắng', uses: ['tường trong', 'trần'], preset: 'plaster_white' },
    { id: 'ceramic_tiles', name: 'Gạch men', uses: ['sàn sảnh'], preset: 'ceramic_tiles' },
    { id: 'concrete', name: 'Bê tông', uses: ['kết cấu', 'sàn'], preset: 'concrete' },
    { id: 'wood_oak', name: 'Gỗ sồi', uses: ['tay vịn', 'cửa'], preset: 'wood_oak' },
    { id: 'granite', name: 'Granite đỏ nhám', uses: ['mặt bậc'], preset: 'rock_granite' },
    { id: 'steel', name: 'Thép sơn', uses: ['con tiện'], preset: 'metal_steel' },
    { id: 'stone_plinth', name: 'Đá rửa', uses: ['chân tường ngoài'], preset: 'concrete' },
  ] }, s);

  it('reviews a plan like an architect and builds it exactly as drawn', async () => {
    const s = state();
    // No material schedule yet: nothing can be drawn into the building.
    const early = await runTool('draw_floor_plan', ground(true), s) as R;
    expect(early.ok && early.result.errors.join(' ')).toContain('bảng vật liệu');
    expect((await schedule(s)).ok).toBe(true);
    // No way in: the review says so and building is refused.
    const bad = await runTool('draw_floor_plan', ground(false), s) as R;
    expect(bad.ok && bad.result.errors.join(' ')).toContain('cửa ra vào');
    expect((await runTool('build_floor', { level: 0 }, s)).ok).toBe(false);
    const good = await runTool('draw_floor_plan', ground(true), s) as R;
    expect(good.ok && good.result.errors).toEqual([]);
    expect((await runTool('build_floor', { level: 0 }, s)).ok).toBe(true);
    // A well wider than the flight leaves a slot beside the last steps: flagged in cm.
    const f = stairFootprint(s.doc.plans![0]!.stairs[0]!, stairRise(s.doc, s.doc.plans![0]!));
    const up = { level: 1, name: 'Tầng 2', height: 2.7, rooms: [{ id: 'a', name: 'Phòng', type: 'bedroom', x0: 0, z0: 0, x1: 10, z1: 8 }], walls: ground(true).walls.slice(0, 4).map((w) => ({ ...w, openings: [] })), stairs: [], voids: [{ x0: f.x0, z0: f.z0, x1: f.x1 + .5, z1: f.z1 }] };
    const wide = await runTool('draw_floor_plan', up, s) as R;
    expect(wide.ok && wide.result.errors.join(' ')).toContain('rộng hơn cầu thang');
    // Left out, the well is drawn exactly over the flight.
    up.voids = [];
    const ok = await runTool('draw_floor_plan', up, s) as R & { result: { wellsAdded?: unknown[] } };
    expect(ok.ok && ok.result.wellsAdded).toHaveLength(1);
    expect(ok.ok && ok.result.errors).toEqual([]);
    expect((await runTool('build_floor', { level: 1 }, s)).ok).toBe(true);
    parseDoc(s.doc);
    // The second storey stands on the first; the L flight reaches it in risers under 19 cm.
    expect(s.doc.plans![1]!.elevation).toBeCloseTo(.15 + 2.8 + .2, 5);
    const stairs = s.doc.nodes.find((n) => n.kind === 'stairs')!;
    expect(stairs.kind === 'stairs' && stairs.shape).toBe('l');
    expect(stairs.kind === 'stairs' && stairs.rise / stairs.steps).toBeLessThan(.19);
    expect(s.doc.nodes.filter((n) => n.kind === 'wall')).toHaveLength(10);
    // Every part in its own material: treads granite, rails steel, handrail wood; frames, leaves, plinth, skirting, ceiling.
    expect(stairs).toMatchObject({ material: 'concrete', treadMaterial: 'granite', railMaterial: 'steel', handrailMaterial: 'wood_oak' });
    const names = s.doc.nodes.map((n) => n.name);
    for (const part of ['Khung trái', 'Kính', 'Cánh', 'Chân tường', 'Len chân tường']) expect(names).toContain(part);
    expect(s.doc.nodes.some((n) => n.kind === 'slab' && n.bottomMaterial === 'plaster_white')).toBe(true);
    expect(s.doc.nodes.some((n) => n.kind === 'slab' && n.holes.length > 0)).toBe(true);
    const v = validateDoc(s.doc);
    expect(v.issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(v.issues.filter((i) => i.code === 'flipped-normals')).toEqual([]);
    // Rebuilding a storey replaces it.
    const walls = s.doc.nodes.filter((n) => n.kind === 'wall').length;
    await runTool('build_floor', { level: 0 }, s);
    expect(s.doc.nodes.filter((n) => n.kind === 'wall')).toHaveLength(walls);
  });

  it('fills what a drawing leaves out: sills by opening kind, exterior walls by the rooms beside them', async () => {
    const s = state();
    await schedule(s);
    const g = ground(true) as unknown as { walls: Array<Record<string, unknown>> };
    for (const w of g.walls) { delete w.exterior; for (const o of w.openings as Array<Record<string, unknown>>) delete o.sill; }
    const r = await runTool('draw_floor_plan', g, s) as R;
    expect(r.ok).toBe(true);
    const plan = s.doc.plans![0]!;
    expect(plan.walls.filter((w) => w.exterior).map((w) => w.id).sort()).toEqual(['e', 'n', 's', 'w']);
    expect(plan.walls.find((w) => w.id === 'n')!.openings[0]!.sill).toBe(.9);
    expect(plan.walls.find((w) => w.id === 's')!.openings[0]!.sill).toBe(0);
  });

  it('closes a 10 cm gap between a flight and its wall by itself', async () => {
    const s = state();
    await schedule(s);
    const g = ground(true);
    g.stairs[0]!.x = .75;
    const r = await runTool('draw_floor_plan', g, s) as R;
    expect(r.ok && r.result.errors.join(' ')).not.toMatch(/Khe hở/);
  });

  it('auto_fix keeps the materials of the schedule and of drawings not built yet', async () => {
    const s = state();
    await schedule(s);
    await runTool('draw_floor_plan', ground(true), s);
    await runTool('auto_fix', {}, s);
    expect(s.doc.materials.map((m) => m.id)).toEqual(expect.arrayContaining(['brick_red', 'granite', 'steel', 'stone_plinth']));
  });

  it('places a flight drawn off the wall or the wrong way round: foot free, top in a room, against the wall', async () => {
    const s = state();
    await schedule(s);
    for (const [x, z, direction, shape] of [[.875, .15, 's', 'l'], [.65, 5, 'n', 'l'], [2, 3, 'e', 'l'], [.65, .15, 's', 'u'], [3, 7.8, 'n', 'u']] as const) {
      const g = ground(true);
      Object.assign(g.stairs[0]!, { x, z, direction, shape });
      const r = await runTool('draw_floor_plan', g, s) as R;
      expect(r.ok && r.result.errors).toEqual([]);
      const st = s.doc.plans![0]!.stairs[0]!, f = stairFootprint(st, stairRise(s.doc, s.doc.plans![0]!));
      // Inside the hall (0..5 × 0..8), the foot and the top on its floor, not in a wall.
      expect(f.x0).toBeGreaterThanOrEqual(0); expect(f.x1).toBeLessThanOrEqual(5); expect(f.z0).toBeGreaterThanOrEqual(0); expect(f.z1).toBeLessThanOrEqual(8);
      for (const p of [f.foot, f.top]) { expect(p[0]).toBeGreaterThan(.3); expect(p[0]).toBeLessThan(4.7); expect(p[1]).toBeGreaterThan(.3); expect(p[1]).toBeLessThan(7.7); }
    }
  });

  it('finds rooms nobody can reach and overlapping rooms', async () => {
    const s = state();
    await schedule(s);
    const g = ground(true);
    g.walls[4]!.openings = [];
    const r = await runTool('draw_floor_plan', g, s) as R;
    expect(r.ok && r.result.errors.join(' ')).toContain('Không đi tới được');
    g.rooms.push({ id: 'x', name: 'Kho', type: 'storage', x0: 8, z0: 6, x1: 10, z1: 8 });
    const r2 = await runTool('draw_floor_plan', g, s) as R;
    expect(r2.ok && r2.result.errors.join(' ')).toContain('chồng lên nhau');
  });

  it('builds every stair design without broken faces', async () => {
    for (const shape of ['straight', 'l', 'u', 'spiral']) for (const style of ['solid', 'stringer', 'open']) {
      const s = state();
      const r = await runTool('create_geometry', { type: 'stairs', params: { width: 1.1, rise: 3, shape, style, turn: 'left' } }, s);
      expect(r.ok).toBe(true);
      const v = validateDoc(s.doc);
      expect(v.issues.filter((i) => i.code === 'flipped-normals' || i.code === 'nan' || i.level === 'error')).toEqual([]);
      expect(v.stats.triangles).toBeGreaterThan(40);
    }
  });

  it('keeps the agent off the pre-designed house', async () => {
    const r = await runTool('create_geometry', { type: 'house', params: {} }, state());
    expect(r.ok).toBe(false);
  });
});
