import { describe, expect, it } from 'vitest';
import { emptyDoc, parseDoc } from './doc';
import { stairFootprint, stairRise } from './plans';
import { runTool, type ToolState } from './tools';
import { validateDoc } from './validate';

type R = { ok: true; result: { errors: string[]; warnings: string[]; plan: { stairs: Array<{ footprint: number[] }> } } } | { ok: false; error: string };

/** A 10 × 8 m storey: hall with the stairs and a door in, living room, bedroom behind. */
function ground(withDoor: boolean, stairs = true) {
  return {
    level: 0, name: 'Tầng trệt', height: 2.8,
    rooms: [
      { id: 'hall', name: 'Sảnh', type: 'hall', x0: 0, z0: 0, x1: 4, z1: 8, floorMaterial: 'ceramic_tiles' },
      { id: 'living', name: 'Phòng khách', type: 'living', x0: 4, z0: 0, x1: 10, z1: 5 },
      { id: 'bed', name: 'Phòng ngủ', type: 'bedroom', x0: 4, z0: 5, x1: 10, z1: 8 },
    ],
    walls: [
      { id: 'n', a: [0, 0], b: [10, 0], thickness: .25, exterior: true, material: 'brick_red', openings: [{ kind: 'window', at: 7, width: 1.2, height: 1.2, sill: .9 }] },
      { id: 'e', a: [10, 0], b: [10, 8], thickness: .25, exterior: true, material: 'brick_red', openings: [] },
      { id: 's', a: [10, 8], b: [0, 8], thickness: .25, exterior: true, material: 'brick_red', openings: withDoor ? [{ kind: 'door', at: 8, width: 1, height: 2.1, sill: 0 }] : [] },
      { id: 'w', a: [0, 8], b: [0, 0], thickness: .25, exterior: true, material: 'brick_red', openings: [] },
      { id: 'i1', a: [4, 0], b: [4, 8], thickness: .12, exterior: false, material: 'plaster_white', openings: [{ kind: 'door', at: 2.5, width: .9, height: 2.1, sill: 0 }, { kind: 'door', at: 6.5, width: .9, height: 2.1, sill: 0 }] },
      { id: 'i2', a: [4, 5], b: [10, 5], thickness: .12, exterior: false, material: 'plaster_white', openings: [] },
    ],
    stairs: stairs ? [{ id: 'st', x: 1.2, z: .4, width: 1, direction: 's', shape: 'l', style: 'stringer', turn: 'right', material: 'wood_oak' }] : [],
  };
}

describe('floor plans', () => {
  const state = (): ToolState => ({ doc: emptyDoc('Nhà', 'building'), host: { assets: [], designOnly: true }, changed: false });

  it('reviews a plan like an architect and builds it exactly as drawn', async () => {
    const s = state();
    // No way in: the review says so and building is refused.
    const bad = await runTool('draw_floor_plan', ground(false), s) as R;
    expect(bad.ok && bad.result.errors.join(' ')).toContain('cửa ra vào');
    expect((await runTool('build_floor', { level: 0 }, s)).ok).toBe(false);
    const good = await runTool('draw_floor_plan', ground(true), s) as R;
    expect(good.ok && good.result.errors).toEqual([]);
    expect((await runTool('build_floor', { level: 0 }, s)).ok).toBe(true);
    // Upper floor without a well over the flight: flagged, with the box to leave open.
    const up = { level: 1, name: 'Tầng 2', height: 2.7, rooms: [{ id: 'a', name: 'Phòng', type: 'bedroom', x0: 0, z0: 0, x1: 10, z1: 8 }], walls: ground(true).walls.slice(0, 4).map((w) => ({ ...w, openings: [] })), stairs: [], voids: [] as Array<{ x0: number; z0: number; x1: number; z1: number }> };
    const noWell = await runTool('draw_floor_plan', up, s) as R;
    expect(noWell.ok && noWell.result.errors.join(' ')).toContain('giếng thang');
    const f = stairFootprint(s.doc.plans![0]!.stairs[0]!, stairRise(s.doc, s.doc.plans![0]!));
    up.voids = [{ x0: f.x0, z0: f.z0, x1: f.x1, z1: f.z1 }];
    const ok = await runTool('draw_floor_plan', up, s) as R;
    expect(ok.ok && ok.result.errors).toEqual([]);
    expect((await runTool('build_floor', { level: 1 }, s)).ok).toBe(true);
    parseDoc(s.doc);
    // The second storey stands on the first; the L flight reaches it in risers under 19 cm.
    expect(s.doc.plans![1]!.elevation).toBeCloseTo(.15 + 2.8 + .2, 5);
    const stairs = s.doc.nodes.find((n) => n.kind === 'stairs')!;
    expect(stairs.kind === 'stairs' && stairs.shape).toBe('l');
    expect(stairs.kind === 'stairs' && stairs.rise / stairs.steps).toBeLessThan(.19);
    expect(s.doc.nodes.filter((n) => n.kind === 'wall')).toHaveLength(10);
    expect(s.doc.nodes.some((n) => n.kind === 'slab' && n.holes.length > 0)).toBe(true);
    const v = validateDoc(s.doc);
    expect(v.issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(v.issues.filter((i) => i.code === 'flipped-normals')).toEqual([]);
    // Rebuilding a storey replaces it.
    const walls = s.doc.nodes.filter((n) => n.kind === 'wall').length;
    await runTool('build_floor', { level: 0 }, s);
    expect(s.doc.nodes.filter((n) => n.kind === 'wall')).toHaveLength(walls);
  });

  it('finds rooms nobody can reach and overlapping rooms', async () => {
    const s = state();
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
