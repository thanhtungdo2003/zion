import { describe, expect, it } from 'vitest';
import { emptyDoc, subtree, type FloorPlan, type ModelDoc } from './doc';
import { checkPlan, railSides, verifyBuilt } from './plans';
import { renderViews } from './render';
import { runTool, type ToolState } from './tools';
import { validateDoc } from './validate';

/**
 * Regression cases for designs the system must not force into one template: the same building
 * drawn two ways, stairs where the designer puts them (handrails on their open sides), open
 * corridors and balconies (railings, no walls), and an edit that really takes a wall out.
 */

type Ok = { ok: true; result: Record<string, unknown> & { errors: string[] } };
type Res = Ok | { ok: false; error: string };

async function project(): Promise<ToolState> {
  const s: ToolState = { doc: emptyDoc('Nhà phố', 'building'), host: { assets: [], designOnly: true }, changed: false };
  await runTool('define_materials', { materials: [
    { id: 'brick', name: 'Gạch trát sơn', uses: ['tường ngoài'], preset: 'brick_red' },
    { id: 'plaster', name: 'Vữa sơn', uses: ['tường trong'], preset: 'plaster_white' },
    { id: 'concrete', name: 'Bê tông', uses: ['cầu thang'], preset: 'concrete' },
    { id: 'steel', name: 'Thép sơn', uses: ['lan can'], preset: 'metal_steel' },
    { id: 'tiles', name: 'Ngói', uses: ['mái'], preset: 'roof_tiles' },
  ] }, s);
  await runTool('research', { query: 'townhouse plan' }, s);
  return s;
}

const spec = { exterior: { thickness: .25, material: 'brick', innerMaterial: 'plaster' }, interior: { thickness: .12, material: 'plaster' }, railing: { material: 'steel' } };
const grid = { cols: [{ size: 4 }, { size: 6 }], rows: [{ size: 5 }, { size: 4 }] };

/** A 10 × 9 m two-storey house; `scheme` decides the stair and how open the upper floor is. */
function storey(level: number, scheme: 'A' | 'B') {
  const ground = level === 0;
  const stairs = !ground ? [] : scheme === 'A'
    ? [{ id: 'st', x: .625, z: 1.5, width: 1, direction: 's', shape: 'straight', style: 'solid', material: 'concrete' }]
    : [{ id: 'st', x: 1.2, z: 7.9, width: 1, direction: 'n', shape: 'u', style: 'stringer', turn: 'right', material: 'concrete', railMaterial: 'steel' }];
  return {
    level, name: ground ? 'Tầng trệt' : 'Tầng 2', height: 3, grid, walls: 'auto', wallSpec: spec, windows: 'auto', stairs,
    rooms: ground
      ? [{ id: 'hall', name: 'Sảnh', type: 'hall', cols: [0, 1], rows: [0, 2] }, { id: 'living', name: 'Phòng khách', type: 'living', cols: [1, 2], rows: [0, 1] }, { id: 'kitchen', name: 'Bếp', type: 'kitchen', cols: [1, 2], rows: [1, 2] }]
      : [
          // A: an enclosed landing hall. B: the upper hall is a gallery open to the north (a railing, no wall).
          { id: 'hall', name: 'Sảnh trên', type: scheme === 'A' ? 'hall' : 'gallery', cols: [0, 1], rows: [0, 2], ...(scheme === 'B' ? { open: ['n'] } : {}) },
          { id: 'b1', name: 'Phòng ngủ 1', type: 'bedroom', cols: [1, 2], rows: [0, 1] },
          { id: 'b2', name: 'Phòng ngủ 2', type: 'bedroom', cols: [1, 2], rows: [1, 2] },
        ],
    links: ground ? [{ a: 'Sảnh', b: 'Phòng khách' }, { a: 'Phòng khách', b: 'Bếp', kind: 'open' }] : [],
    ...(ground ? { entrance: 'Sảnh' } : {}),
  };
}

async function draw(s: ToolState, args: unknown): Promise<Ok['result']> {
  const r = await runTool('draw_floor_plan', args, s) as Res;
  if (!r.ok) throw new Error(r.error);
  return r.result;
}

async function approveAndBuild(s: ToolState, level: number): Promise<Record<string, unknown>> {
  const p = s.doc.plans!.find((x) => x.level === level)!;
  const ok = await runTool('approve_floor_plan', { level, basis: 'Nhà phố hai tầng 10×9 m, phương án theo yêu cầu của chủ nhà.', stairs: p.stairs.map((st) => ({ id: st.id, position: 'trong sảnh', direction: 'theo hướng vẽ', start: 'chân thang ra sảnh', landing: 'chiếu nghỉ vuông', turn: 'quay trái', link: 'lên sảnh trên', headroom: 'giếng thang phủ bậc' })) }, s) as Res;
  if (!ok.ok) throw new Error(ok.error);
  const b = await runTool('build_floor', { level }, s) as Res;
  if (!b.ok) throw new Error(b.error);
  return b.result;
}

async function house(scheme: 'A' | 'B'): Promise<ToolState> {
  const s = await project();
  await draw(s, storey(0, scheme));
  await draw(s, storey(1, scheme));
  const g = await draw(s, storey(0, scheme));
  expect(g.errors).toEqual([]);
  expect((await draw(s, storey(1, scheme))).errors).toEqual([]);
  await approveAndBuild(s, 0);
  await approveAndBuild(s, 1);
  return s;
}

describe('no template: the designer decides, the rules only keep it usable in game', () => {
  it('builds the same house as two different valid schemes', async () => {
    const a = await house('A'), b = await house('B');
    for (const s of [a, b]) {
      for (const p of s.doc.plans!) { expect(checkPlan(s.doc, p).filter((i) => i.level === 'error')).toEqual([]); expect(verifyBuilt(s.doc, p)).toEqual([]); }
      expect(validateDoc(s.doc).issues.map((i) => i.code)).not.toEqual(expect.arrayContaining(['empty', 'no-collision']));
    }
    const stairA = a.doc.nodes.find((n) => n.kind === 'stairs')!, stairB = b.doc.nodes.find((n) => n.kind === 'stairs')!;
    // Kept as designed: a straight flight against the wall vs an L flight standing in the hall.
    expect(stairA.kind === 'stairs' && [stairA.shape, stairA.style]).toEqual(['straight', 'solid']);
    expect(stairB.kind === 'stairs' && [stairB.shape, stairB.style]).toEqual(['u', 'stringer']);
    expect(a.doc.plans![0]!.stairs[0]!.x).toBe(.625);
    expect(b.doc.plans![0]!.stairs[0]!.direction).toBe('n');
    // B's gallery is open to the north: a railing there, no wall; A is walled.
    const upA = a.doc.plans![1]!, upB = b.doc.plans![1]!;
    const northOfHall = (p: FloorPlan) => p.walls.filter((w) => w.a[1] === 0 && w.b[1] === 0 && Math.max(w.a[0], w.b[0]) <= 4);
    expect(northOfHall(upA).map((w) => w.kind ?? 'wall')).toEqual(['wall']);
    expect(northOfHall(upB).map((w) => w.kind)).toEqual(['railing']);
    expect(b.doc.nodes.filter((n) => n.tags?.includes('railing')).length).toBeGreaterThan(a.doc.nodes.filter((n) => n.tags?.includes('railing')).length);
    // The models really differ.
    const [va, vb] = [renderViews(a.doc, ['iso'], 96)[0]!, renderViews(b.doc, ['iso'], 96)[0]!];
    expect(va.rgb).not.toEqual(vb.rgb);
  });

  it('puts handrails on the open sides of a flight and none against a wall, and inserts no wall at its foot', async () => {
    const a = await house('A'), b = await house('B');
    const pa = a.doc.plans![0]!, pb = b.doc.plans![0]!;
    // Against the west wall: one handrail, on the hall side.
    expect(railSides(a.doc, pa, pa.stairs[0]!)).toEqual([[true, false]]);
    const na = a.doc.nodes.find((n) => n.kind === 'stairs')!;
    expect(na.kind === 'stairs' && na.rails).toEqual([[true, false]]);
    // Standing free: both sides of each flight that are open get one.
    expect(railSides(b.doc, pb, pb.stairs[0]!).flat().filter(Boolean).length).toBeGreaterThanOrEqual(3);
    // Nothing was built across the way onto the stairs: the plan has no wall the design did not draw.
    for (const s of [a, b]) {
      const p = s.doc.plans![0]!;
      expect(checkPlan(s.doc, p).map((i) => i.message).join(' ')).not.toMatch(/Chân cầu thang|cắt qua tường/);
    }
  });

  it('keeps balconies and open corridors open: railings on their open edges, never a closed wall', async () => {
    const s = await project();
    await draw(s, { ...storey(0, 'A'), stairs: [] });
    const up = await draw(s, {
      level: 1, name: 'Tầng 2', height: 3, walls: 'auto', wallSpec: spec,
      grid: { cols: [{ size: 4 }, { size: 6 }], rows: [{ size: 1.5 }, { size: 7.5 }] },
      rooms: [
        // An open corridor along the front (railing outside), rooms behind it; a balcony needs no `open`.
        { id: 'cor', name: 'Hành lang', type: 'corridor', cols: [0, 1], rows: [0, 1], open: ['n'] },
        { id: 'bal', name: 'Ban công', type: 'balcony', cols: [1, 2], rows: [0, 1] },
        { id: 'r1', name: 'Phòng 1', type: 'bedroom', cols: [0, 1], rows: [1, 2] },
        { id: 'r2', name: 'Phòng 2', type: 'bedroom', cols: [1, 2], rows: [1, 2] },
      ],
      links: [{ a: 'Hành lang', b: 'Phòng 1' }, { a: 'Phòng 2', b: 'Ban công' }, { a: 'Hành lang', b: 'Ban công', kind: 'open' }],
    });
    const p = s.doc.plans![1]!;
    const front = p.walls.filter((w) => w.a[1] === 0 && w.b[1] === 0);
    expect(front.length).toBeGreaterThan(0);
    expect(front.every((w) => w.kind === 'railing')).toBe(true);
    // The balcony's sides too, and no window or door on a railing.
    expect(p.walls.filter((w) => w.kind === 'railing').every((w) => !w.openings.length)).toBe(true);
    expect(up.errors.filter((e) => /hở cạnh/.test(e))).toEqual([]);
    // Take a railing away: an open edge up high is a fall — refused.
    const bare = { ...p, walls: p.walls.filter((w) => !(w.kind === 'railing' && w.a[1] === 0)) };
    expect(checkPlan(s.doc, bare).map((i) => i.message).join(' ')).toMatch(/hở cạnh .* người chơi rơi xuống/);
  });

  it('takes a wall out when asked: the drawing, the built model and the pictures all change', async () => {
    const s = await house('A');
    // The ground floor seen from above (the storey over it left out of the picture).
    const groundOnly = (d: ModelDoc): ModelDoc => { const up = new Set(subtree(d, d.plans![1]!.built!).map((n) => n.id)); return { ...d, nodes: d.nodes.filter((n) => !up.has(n.id)) }; };
    const before = renderViews(groundOnly(s.doc), ['top'], 128)[0]!;
    const wallsBefore = s.doc.nodes.filter((n) => n.kind === 'wall').length;
    const e = await runTool('edit_floor_plan', { level: 0, ops: [{ op: 'remove_wall_between', a: 'Sảnh', b: 'Phòng khách' }] }, s) as Res;
    expect(e.ok).toBe(true);
    const diff = (e as Ok).result.diff as { changed: boolean; walls: { removed: string[] } };
    expect(diff.changed).toBe(true);
    expect(diff.walls.removed.length).toBe(1);
    // No wall left on the line between the hall and the living room (x = 4, z 0..5).
    const g = s.doc.plans![0]!;
    expect(g.walls.some((w) => w.kind !== 'railing' && w.a[0] === 4 && w.b[0] === 4 && Math.min(w.a[1], w.b[1]) < 4.9 && Math.max(w.a[1], w.b[1]) > .1)).toBe(false);
    // Not built until approved again; then the model follows, and says what changed.
    expect((await runTool('build_floor', { level: 0 }, s) as Res).ok).toBe(false);
    const built = await approveAndBuild(s, 0);
    expect(built.changes).toMatchObject({ wall: expect.stringMatching(/→/) });
    expect(s.doc.nodes.filter((n) => n.kind === 'wall').length).toBe(wallsBefore - 1);
    expect(verifyBuilt(s.doc, g)).toEqual([]);
    const after = renderViews(groundOnly(s.doc), ['top'], 128)[0]!;
    expect(after.rgb).not.toEqual(before.rgb);
    // Rooms still reachable, nothing in the way.
    expect(checkPlan(s.doc, g).filter((i) => i.level === 'error')).toEqual([]);
  });

  it('renders what was built from every side, and nothing when nothing was', async () => {
    const s = await house('B');
    const views = renderViews(s.doc, undefined, 96);
    expect(views.map((v) => v.view)).toEqual(['front', 'right', 'back', 'left', 'top', 'iso']);
    for (const v of views) expect(v.coverage).toBeGreaterThan(.2);
    expect(renderViews(emptyDoc('x', 'building'), ['front'], 32)[0]!.coverage).toBe(0);
    const r = await runTool('render_views', { views: ['iso'], size: 64 }, s) as Res;
    expect(r.ok && (r.result as unknown as { storeys: Array<{ stairs: Array<{ handrails: string[] }> }> }).storeys[0]!.stairs[0]!.handrails.length).toBeGreaterThan(0);
  });
});
