import { BoxGeometry, BufferGeometry, CanvasTexture, Color, DoubleSide, Float32BufferAttribute, Group, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace, Sprite, SpriteMaterial, type Material } from 'three';
import { stairFootprint, stairRise, type FloorPlan, type ModelDoc } from '@zion/assets/model-studio';

/**
 * Floor plans drawn in the 3D view at their storey's height, so the admin sees what the AI is
 * about to build (or built) and where it goes wrong: rooms tinted by use with their name and
 * area, wall centre lines at their thickness (exterior darker), doors green, windows blue,
 * stairs in orange with the climb arrow, stairwell voids in red. Drawn storeys not built yet are
 * bright; built ones fade.
 */
const ROOM_COLOURS: Record<string, number> = {
  living: 0x4fb3ff, bedroom: 0xb07cff, kitchen: 0xffa94d, dining: 0xffd43b, bathroom: 0x38d9a9, hall: 0xadb5bd, stair: 0xff922b,
  office: 0x74c0fc, storage: 0x868e96, shop: 0xf783ac, garage: 0x495057, balcony: 0x8ce99a,
};
const colourOf = (type: string) => ROOM_COLOURS[type] ?? new Color().setHSL(([...type].reduce((h, c) => h * 31 + c.charCodeAt(0), 7) % 360) / 360, .6, .6).getHex();

function label(text: string, colour = '#ffffff', scale = 1): Sprite {
  const lines = text.split('\n'), c = document.createElement('canvas'), ctx = c.getContext('2d')!, fs = 44;
  ctx.font = `600 ${fs}px sans-serif`;
  const w = Math.ceil(Math.max(...lines.map((l) => ctx.measureText(l).width)) + 24), h = lines.length * (fs + 8) + 16;
  c.width = w; c.height = h;
  ctx.font = `600 ${fs}px sans-serif`;
  ctx.fillStyle = 'rgba(12,14,16,.72)'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = colour; ctx.textBaseline = 'top';
  lines.forEach((l, i) => ctx.fillText(l, 12, 8 + i * (fs + 8)));
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  const s = new Sprite(new SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set(w / 110 * scale, h / 110 * scale, 1);
  s.renderOrder = 10;
  return s;
}

function outline(x0: number, z0: number, x1: number, z1: number, y: number, colour: number, opacity = 1): LineSegments {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute([x0, y, z0, x1, y, z0, x1, y, z0, x1, y, z1, x1, y, z1, x0, y, z1, x0, y, z1, x0, y, z0], 3));
  return new LineSegments(g, new LineBasicMaterial({ color: colour, transparent: opacity < 1, opacity, depthTest: false }));
}

export function buildPlanOverlay(doc: ModelDoc): Group {
  const root = new Group();
  root.name = 'plans';
  for (const plan of doc.plans ?? []) root.add(planGroup(doc, plan));
  return root;
}

function planGroup(doc: ModelDoc, plan: FloorPlan): Group {
  const g = new Group(), y = plan.elevation + .03, fresh = !plan.built, alpha = fresh ? .32 : .12;
  const keep: Material[] = [];
  const mat = (colour: number, opacity: number) => { const m = new MeshBasicMaterial({ color: colour, transparent: true, opacity, depthWrite: false, side: DoubleSide }); keep.push(m); return m; };
  let minX = Infinity, minZ = Infinity;
  for (const r of plan.rooms) {
    const x0 = Math.min(r.x0, r.x1), x1 = Math.max(r.x0, r.x1), z0 = Math.min(r.z0, r.z1), z1 = Math.max(r.z0, r.z1);
    minX = Math.min(minX, x0); minZ = Math.min(minZ, z0);
    const tint = colourOf(r.type);
    const m = new Mesh(new PlaneGeometry(x1 - x0, z1 - z0).rotateX(-Math.PI / 2), mat(tint, alpha));
    m.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
    m.renderOrder = 5;
    g.add(m, outline(x0, z0, x1, z1, y + .005, tint, fresh ? 1 : .5));
    if (fresh || (x1 - x0) * (z1 - z0) > 8) {
      const l = label(`${r.name}\n${((x1 - x0) * (z1 - z0)).toFixed(1)} m²`, '#ffffff', fresh ? .9 : .6);
      l.position.set((x0 + x1) / 2, y + .5, (z0 + z1) / 2);
      g.add(l);
    }
  }
  for (const w of plan.walls) {
    const dx = w.b[0] - w.a[0], dz = w.b[1] - w.a[1], len = Math.hypot(dx, dz);
    if (len < .05) continue;
    const bar = new Mesh(new BoxGeometry(len, .08, w.thickness), mat(w.exterior ? 0x1e2328 : 0x6c757d, fresh ? .95 : .4));
    bar.position.set((w.a[0] + w.b[0]) / 2, y + .04, (w.a[1] + w.b[1]) / 2);
    bar.rotation.y = Math.atan2(-dz, dx);
    bar.renderOrder = 6;
    g.add(bar);
    for (const o of w.openings) {
      const door = o.kind !== 'window';
      const mark = new Mesh(new BoxGeometry(o.width, .1, w.thickness + .12), mat(door ? 0x40c057 : 0x339af0, fresh ? .95 : .5));
      mark.position.set(w.a[0] + dx / len * o.at, y + .06, w.a[1] + dz / len * o.at);
      mark.rotation.y = Math.atan2(-dz, dx);
      mark.renderOrder = 7;
      g.add(mark);
    }
  }
  for (const s of plan.stairs) {
    const f = stairFootprint(s, stairRise(doc, plan));
    g.add(outline(f.x0, f.z0, f.x1, f.z1, y + .02, 0xff922b));
    const arrow = new BufferGeometry();
    arrow.setAttribute('position', new Float32BufferAttribute([s.x, y + .03, s.z, f.top[0], y + .03, f.top[1]], 3));
    g.add(new LineSegments(arrow, new LineBasicMaterial({ color: 0xff922b, depthTest: false })));
    const l = label(`Cầu thang ${s.shape}/${s.style}`, '#ffb366', .7);
    l.position.set((f.x0 + f.x1) / 2, y + .9, (f.z0 + f.z1) / 2);
    g.add(l);
  }
  for (const v of plan.voids) g.add(outline(Math.min(v.x0, v.x1), Math.min(v.z0, v.z1), Math.max(v.x0, v.x1), Math.max(v.z0, v.z1), y + .025, 0xff6b6b));
  if (Number.isFinite(minX)) {
    const t = label(`Tầng ${plan.level + 1}: ${plan.name} · ${fresh ? 'bản vẽ (chưa dựng)' : 'đã dựng'}`, fresh ? '#ffd43b' : '#adb5bd', 1);
    t.position.set(minX, y + 1.4, minZ);
    g.add(t);
  }
  return g;
}

/** Frees an overlay's geometry, materials and label textures. */
export function disposeOverlay(g: Group): void {
  g.traverse((o) => {
    const m = o as Mesh;
    m.geometry?.dispose();
    const mat = m.material as Material | Material[] | undefined;
    for (const x of Array.isArray(mat) ? mat : mat ? [mat] : []) { (x as SpriteMaterial).map?.dispose(); x.dispose(); }
  });
}
