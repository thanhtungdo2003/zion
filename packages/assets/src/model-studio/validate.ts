import { DEFAULT_CHARACTER } from '@zion/physics';
import { materialRefs, modelDocSchema, type ModelDoc, type ModelNode } from './doc';
import { bounds, evaluate, transformPoint } from './evaluate';
import { materialFromPreset } from './materials';

/**
 * Checks a model the way the game will use it — not only "it draws": broken triangles and
 * normals, missing or unused materials, implausible size for what it is, parts floating or sunk,
 * doors a player cannot pass, stairs a player cannot climb, models of the game that do not
 * exist, nothing to collide with, too many triangles or draw calls.
 */
export type IssueLevel = 'error' | 'warning' | 'info';
export interface Issue { level: IssueLevel; code: string; message: string; node?: string; fixable?: boolean }
export interface ValidationStats {
  nodes: number; triangles: number; vertices: number; drawCalls: number; materials: number; assets: number; imports: number;
  collidingTriangles: number;
  size: [number, number, number] | null; min: [number, number, number] | null;
}
export interface ValidationReport { ok: boolean; issues: Issue[]; stats: ValidationStats }

export interface ValidationContext {
  /** Registry lookup for asset parts (name, kind, bounds) — absent: not checked. */
  asset?: (id: number) => { name: string; model: { kind: string }; bounds: { radius: number; height: number } } | undefined;
  /** Imported files known to the project. */
  files?: Set<string>;
}

const SIZE: Record<string, [number, number]> = { building: [2.5, 80], prop: [.03, 30], rock: [.1, 40], vegetation: [.1, 40], furniture: [.15, 5], vehicle: [1, 25], weapon: [.1, 3], other: [.01, 200] };
const MAX_TRIS = 400_000, WARN_TRIS = 120_000;

export function validateDoc(input: unknown, ctx: ValidationContext = {}): ValidationReport {
  const issues: Issue[] = [];
  const parsed = modelDocSchema.safeParse(input);
  if (!parsed.success) {
    for (const i of parsed.error.issues.slice(0, 20)) issues.push({ level: 'error', code: 'schema', message: `${i.path.join('.') || 'doc'}: ${i.message}` });
    return { ok: false, issues, stats: { nodes: 0, triangles: 0, vertices: 0, drawCalls: 0, materials: 0, assets: 0, imports: 0, collidingTriangles: 0, size: null, min: null } };
  }
  const doc = parsed.data;
  const ev = evaluate(doc);
  let tris = 0, verts = 0, colliding = 0;
  const flippedBy = new Map<string, number>(), degenerateBy = new Map<string, number>(), nanBy = new Set<string>();
  for (const d of ev.draws) {
    const p = d.mesh.positions, n = d.mesh.normals, ix = d.mesh.indices;
    tris += ix.length / 3; verts += p.length / 3;
    if (d.collides) colliding += ix.length / 3;
    for (let k = 0; k < p.length; k++) if (!Number.isFinite(p[k]!)) { nanBy.add(d.node); break; }
    for (let k = 0; k < d.mesh.uvs.length; k++) if (!Number.isFinite(d.mesh.uvs[k]!)) { nanBy.add(d.node); break; }
    let flipped = 0, degenerate = 0;
    for (let t = 0; t < ix.length; t += 3) {
      const a = ix[t]! * 3, b = ix[t + 1]! * 3, c = ix[t + 2]! * 3;
      const ux = p[b]! - p[a]!, uy = p[b + 1]! - p[a + 1]!, uz = p[b + 2]! - p[a + 2]!, vx = p[c]! - p[a]!, vy = p[c + 1]! - p[a + 1]!, vz = p[c + 2]! - p[a + 2]!;
      const gx = uy * vz - uz * vy, gy = uz * vx - ux * vz, gz = ux * vy - uy * vx, area = Math.hypot(gx, gy, gz) / 2;
      if (area < 1e-9) { degenerate++; continue; }
      const nx = n[a]! + n[b]! + n[c]!, ny = n[a + 1]! + n[b + 1]! + n[c + 1]!, nz = n[a + 2]! + n[b + 2]! + n[c + 2]!;
      if (gx * nx + gy * ny + gz * nz < 0) flipped++;
    }
    if (flipped) flippedBy.set(d.node, (flippedBy.get(d.node) ?? 0) + flipped);
    if (degenerate) degenerateBy.set(d.node, (degenerateBy.get(d.node) ?? 0) + degenerate);
  }
  for (const id of nanBy) issues.push({ level: 'error', code: 'nan', message: 'Đỉnh hoặc UV không hợp lệ (NaN/vô hạn).', node: id });
  for (const [id, n] of flippedBy) issues.push({ level: 'warning', code: 'flipped-normals', message: `${n} mặt bị đảo pháp tuyến (hiển thị sai sáng tối).`, node: id });
  for (const [id, n] of degenerateBy) if (n > 4) issues.push({ level: 'info', code: 'degenerate', message: `${n} tam giác suy biến (diện tích 0).`, node: id });

  // Materials.
  const used = new Set<string>();
  for (const nd of doc.nodes) for (const m of materialRefs(nd)) used.add(m);
  for (const m of doc.materials) if (!used.has(m.id)) issues.push({ level: 'info', code: 'unused-material', message: `Vật liệu "${m.name}" không được dùng.`, fixable: true });
  for (const nd of doc.nodes) for (const id of materialRefs(nd)) if (!doc.materials.some((m) => m.id === id)) issues.push({ level: 'error', code: 'missing-material', message: `Thiếu vật liệu ${id}.`, node: nd.id, fixable: true });
  for (const m of doc.materials) {
    if (m.metalness > .5 && m.roughness < .02) issues.push({ level: 'info', code: 'mirror', message: `"${m.name}" là kim loại gương hoàn hảo (hiếm gặp ngoài thực tế).` });
    if (m.metalness > 0 && m.metalness < 1 && !['rust', 'corrugated'].includes(m.texture.pattern)) issues.push({ level: 'info', code: 'half-metal', message: `"${m.name}" metalness ${m.metalness}: bề mặt thật là kim loại (1) hoặc không (0); giá trị giữa chỉ hợp với vùng chuyển tiếp (gỉ, bụi).` });
    for (const [what, id] of Object.entries(m.maps ?? {})) if (id && ctx.files && !ctx.files.has(id)) issues.push({ level: 'error', code: 'missing-texture', message: `"${m.name}": thiếu ảnh texture ${what} (${id}).` });
    if (m.albedoFile && ctx.files && !ctx.files.has(m.albedoFile)) issues.push({ level: 'error', code: 'missing-texture', message: `"${m.name}": thiếu file texture ${m.albedoFile}.`, fixable: true });
  }

  // Assets and imports.
  for (const a of ev.assets) {
    const def = ctx.asset?.(a.asset);
    if (ctx.asset && !def) issues.push({ level: 'error', code: 'unknown-asset', message: `Không có model #${a.asset} trong thư viện game.`, node: a.node });
  }
  for (const i of ev.imports) if (ctx.files && !ctx.files.has(i.file)) issues.push({ level: 'error', code: 'missing-file', message: `Thiếu file import ${i.file}.`, node: i.node });

  // Size and grounding.
  const bb = bounds(ev, (id) => ctx.asset?.(id)?.bounds);
  const size: [number, number, number] | null = bb ? [bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]] : null;
  if (!bb) issues.push({ level: 'error', code: 'empty', message: 'Model chưa có hình học nào.' });
  else {
    const [lo, hi] = SIZE[doc.kind] ?? SIZE.other!;
    const big = Math.max(...size!);
    if (big < lo) issues.push({ level: 'warning', code: 'too-small', message: `Kích thước lớn nhất ${big.toFixed(2)} m — quá nhỏ cho loại "${doc.kind}" (≥ ${lo} m).` });
    if (big > hi) issues.push({ level: 'warning', code: 'too-large', message: `Kích thước lớn nhất ${big.toFixed(1)} m — quá lớn cho loại "${doc.kind}" (≤ ${hi} m).` });
    if (bb.min[1] > .05) issues.push({ level: 'warning', code: 'floating', message: `Đáy model cao ${bb.min[1].toFixed(2)} m trên mặt đất (y = 0): sẽ lơ lửng trong game.`, fixable: true });
    if (bb.min[1] < -1.5) issues.push({ level: 'warning', code: 'sunk', message: `Model lún ${(-bb.min[1]).toFixed(2)} m dưới mặt đất.`, fixable: true });
  }
  if (tris > MAX_TRIS) issues.push({ level: 'error', code: 'too-many-triangles', message: `${tris.toLocaleString()} tam giác — vượt giới hạn ${MAX_TRIS.toLocaleString()} cho một model trong game.` });
  else if (tris > WARN_TRIS) issues.push({ level: 'warning', code: 'heavy', message: `${tris.toLocaleString()} tam giác — nặng; cân nhắc giảm chi tiết.` });

  // Gameplay: passable doors, climbable stairs, something to collide with.
  const ch = DEFAULT_CHARACTER;
  for (const nd of doc.nodes) {
    if (nd.kind === 'wall') for (const o of nd.openings) {
      if (o.kind !== 'door' && o.kind !== 'arch') continue;
      const sx = Math.abs(nd.transform.scale[0]), sy = Math.abs(nd.transform.scale[1]);
      if (o.width * sx < ch.radius * 2 + .12) issues.push({ level: 'error', code: 'door-too-narrow', message: `Cửa rộng ${(o.width * sx).toFixed(2)} m — nhân vật (${(ch.radius * 2).toFixed(2)} m) không lọt.`, node: nd.id, fixable: true });
      if (o.height * sy < ch.height + .1) issues.push({ level: 'error', code: 'door-too-low', message: `Cửa cao ${(o.height * sy).toFixed(2)} m — nhân vật cao ${ch.height} m không qua được.`, node: nd.id, fixable: true });
    }
    if (nd.kind === 'stairs') {
      const riser = nd.rise / nd.steps * Math.abs(nd.transform.scale[1]);
      if (riser > ch.stepHeight) issues.push({ level: 'error', code: 'stair-step-high', message: `Bậc cao ${riser.toFixed(2)} m — nhân vật chỉ bước được ${ch.stepHeight} m.`, node: nd.id, fixable: true });
      else if (riser > .22) issues.push({ level: 'warning', code: 'stair-steep', message: `Bậc cao ${riser.toFixed(2)} m — dốc hơn cầu thang nhà ở (15–19 cm).`, node: nd.id, fixable: true });
      const tread = nd.run / nd.steps;
      if (tread < .2) issues.push({ level: 'warning', code: 'stair-tread', message: `Mặt bậc ${tread.toFixed(2)} m — hẹp (nên 25–30 cm).`, node: nd.id, fixable: true });
    }
  }
  if (doc.kind === 'building' && colliding === 0 && ev.assets.length === 0) issues.push({ level: 'error', code: 'no-collision', message: 'Công trình không có phần nào va chạm: người chơi sẽ đi xuyên qua.' });
  const mats = new Set(ev.draws.map((d) => d.material));
  const drawCalls = mats.size + new Set(ev.assets.map((a) => a.asset)).size * 2 + ev.imports.length;
  if (drawCalls > 48) issues.push({ level: 'warning', code: 'draw-calls', message: `≈${drawCalls} draw call (theo vật liệu sau khi gộp): nên gộp bớt vật liệu.` });
  const stats: ValidationStats = { nodes: doc.nodes.length, triangles: tris, vertices: verts, drawCalls, materials: doc.materials.length, assets: ev.assets.length, imports: ev.imports.length, collidingTriangles: colliding, size: size?.map((v) => Math.round(v * 100) / 100) as [number, number, number] ?? null, min: bb?.min ?? null };
  return { ok: !issues.some((i) => i.level === 'error'), issues, stats };
}

/**
 * Repairs what can be repaired without changing the design: grounds a floating or sunk model,
 * widens doors to pass a player, splits stairs into more steps, adds missing materials and drops
 * unused ones. Returns the descriptions of what it changed.
 */
export function autoFix(doc: ModelDoc, report: ValidationReport): string[] {
  const done: string[] = [];
  const codes = new Set(report.issues.map((i) => i.code));
  if (codes.has('missing-material')) {
    const known = new Set(doc.materials.map((m) => m.id));
    for (const n of doc.nodes) {
      const ids = materialRefs(n);
      for (const id of ids) if (!known.has(id)) { doc.materials.push(materialFromPreset(id, 'concrete', { name: `Vật liệu ${id}` })); known.add(id); done.push(`Tạo vật liệu thay thế "${id}" (bê tông).`); }
    }
  }
  if (codes.has('unused-material')) {
    const used = new Set<string>();
    for (const n of doc.nodes) for (const m of materialRefs(n)) used.add(m);
    const before = doc.materials.length;
    doc.materials = doc.materials.filter((m) => used.has(m.id));
    if (doc.materials.length < before) done.push(`Bỏ ${before - doc.materials.length} vật liệu không dùng.`);
  }
  for (const n of doc.nodes) {
    if (n.kind === 'wall') for (const o of n.openings) {
      if (o.kind !== 'door' && o.kind !== 'arch') continue;
      if (o.width < .85) { done.push(`Nới cửa ${n.name} từ ${o.width.toFixed(2)} lên 0.9 m.`); o.width = .9; }
      if (o.height < 1.95) { const h = Math.min(n.height - o.sill - .05, 2.1); if (h > o.height) { done.push(`Nâng cửa ${n.name} lên ${h.toFixed(2)} m.`); o.height = h; } }
    }
    if (n.kind === 'stairs') {
      const want = Math.max(n.steps, Math.ceil(n.rise / .185));
      if (want !== n.steps) { done.push(`Cầu thang ${n.name}: ${n.steps} → ${want} bậc.`); n.steps = want; n.run = Math.max(n.run, want * .26); }
    }
  }
  if ((codes.has('floating') || codes.has('sunk')) && report.stats.min) {
    const dy = -report.stats.min[1];
    for (const n of doc.nodes) if (n.parent === null) n.transform.position[1] += dy;
    done.push(`Đặt model xuống mặt đất (dịch ${dy.toFixed(2)} m).`);
  }
  return done;
}

/** A short text picture of the scene for the agent (hierarchy, sizes, materials). */
export function describeDoc(doc: ModelDoc, maxNodes = 120): string {
  const ev = evaluate(doc);
  const bb = bounds(ev);
  const lines = [`"${doc.name}" (${doc.kind}), ${doc.nodes.length} phần, ${doc.materials.length} vật liệu${bb ? `, kích thước ${(bb.max[0] - bb.min[0]).toFixed(2)}×${(bb.max[1] - bb.min[1]).toFixed(2)}×${(bb.max[2] - bb.min[2]).toFixed(2)} m` : ''}.`];
  const depth = (n: ModelNode) => { let d = 0; for (let p = n.parent; p && d < 12; d++) p = doc.nodes.find((x) => x.id === p)?.parent ?? null; return d; };
  for (const n of doc.nodes.slice(0, maxNodes)) {
    const m = ev.matrices.get(n.id), at = m ? transformPoint(m, 0, 0, 0).map((v) => v.toFixed(2)).join(',') : '';
    const extra = n.kind === 'primitive' ? ` ${n.shape} ${JSON.stringify(n.params)}` : n.kind === 'asset' ? ` asset #${n.asset}` : n.kind === 'wall' ? ` ${n.length.toFixed(2)}×${n.height.toFixed(2)} m, ${n.openings.length} lỗ mở` : n.kind === 'rock' ? ` ${JSON.stringify(n.params)}` : '';
    lines.push(`${'  '.repeat(depth(n))}- ${n.id} [${n.kind}] "${n.name}"${extra}${'material' in n ? ` mat=${n.material}` : ''} @(${at})`);
  }
  if (doc.nodes.length > maxNodes) lines.push(`… và ${doc.nodes.length - maxNodes} phần nữa.`);
  lines.push('Vật liệu: ' + doc.materials.map((m) => `${m.id} (${m.preset ?? m.texture.pattern}, rough ${m.roughness.toFixed(2)}, metal ${m.metalness.toFixed(2)})`).join('; '));
  return lines.join('\n');
}
