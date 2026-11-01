'use client';

import { BUILDING_CONDITIONS, BUILDING_CONDITION_NAMES, LOT_CLASSES, LOT_CLASS_NAMES, SETTLEMENT_AREA_IDS, SETTLEMENT_AREA_NAMES, describeLotFit, lotFitFromLegacy, type LotFit } from '@zion/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { AssetRegistry } from '@zion/assets';
import {
  ASSET_KINDS, MATERIAL_PRESETS, buildRoof, checkPlan, openLinks, OPENING_KINDS, placeWindows, planHash, roofCovers, TEXTURE_PATTERNS, materialFromPreset, materialTextures, subtree,
  type Issue, type ModelDoc, type ModelMaterial, type ModelNode, type ValidationReport,
  classifyModel,
} from '@zion/assets/model-studio';
import { Icon } from '@/components/Icon';
import { msApi, type ProjectFile, type ProjectSummary, type PublishedModel, type TextureHit, type TextureSet, type VersionInfo } from '@/lib/model-studio-api';
import s from './model-studio.module.css';

export type Mutate = (label: string, fn: (doc: ModelDoc) => void) => void;
const DEG = 180 / Math.PI;
const fmt = (v: number, d = 3) => String(Math.round(v * 10 ** d) / 10 ** d);

/* ------------------------------------------------------------------ projects */

export function ProjectsPanel(p: {
  projects: ProjectSummary[]; deleted: ProjectSummary[]; current: string | null;
  open(id: string): void; create(name: string): void; rename(id: string, name: string): void; duplicate(id: string): void; remove(id: string): void; undelete(id: string): void; purge(id: string): void;
}) {
  const [name, setName] = useState('');
  const [showDeleted, setShowDeleted] = useState(false);
  return (
    <div className={s.pane}>
      <div className={s.section}>
        <h3><Icon name="lucide:folder-plus" /> Dự án mới</h3>
        <form className={s.row} onSubmit={(e) => { e.preventDefault(); if (name.trim()) { p.create(name.trim()); setName(''); } }}>
          <input className={s.text} value={name} maxLength={80} placeholder="Tên model…" onChange={(e) => setName(e.target.value)} />
          <button className={`${s.tbtn} ${s.primary}`} disabled={!name.trim()}>Tạo</button>
        </form>
      </div>
      <div className={s.section}>
        <h3><Icon name="lucide:folder" /> Dự án ({p.projects.length})</h3>
        <div className={s.list}>
          {p.projects.map((x) => (
            <div key={x.id} className={`${s.item} ${x.id === p.current ? s.on : ''}`} onClick={() => p.open(x.id)} title={`Cập nhật ${new Date(x.updatedAt).toLocaleString('vi-VN')}`}>
              <Icon name={x.kind === 'building' ? 'lucide:house' : x.kind === 'rock' ? 'lucide:mountain' : 'lucide:box'} />
              <span className={s.grow}>{x.name}</span>
              <small>{x.nodes} phần · v{x.version}</small>
              <button className={s.ibtn} title="Đổi tên" onClick={(e) => { e.stopPropagation(); const n = prompt('Tên mới', x.name); if (n?.trim()) p.rename(x.id, n.trim().slice(0, 80)); }}><Icon name="lucide:pencil" /></button>
              <button className={s.ibtn} title="Nhân bản" onClick={(e) => { e.stopPropagation(); p.duplicate(x.id); }}><Icon name="lucide:copy" /></button>
              <button className={`${s.ibtn} ${s.del}`} title="Xóa dự án (khôi phục được)" onClick={(e) => { e.stopPropagation(); if (confirm(`Xóa dự án "${x.name}"? Có thể khôi phục trong mục "Đã xóa".`)) p.remove(x.id); }}><Icon name="lucide:trash-2" /></button>
            </div>
          ))}
          {!p.projects.length && <p className={s.muted}>Chưa có dự án. Tạo một dự án rồi dùng ô AI bên dưới khung 3D, hoặc thêm hình khối, model game, file GLB.</p>}
        </div>
      </div>
      <div className={s.section}>
        <h3><button className={s.twist} onClick={() => setShowDeleted(!showDeleted)}>{showDeleted ? '▾' : '▸'}</button> Đã xóa ({p.deleted.length})</h3>
        {showDeleted && <div className={s.list}>{p.deleted.map((x) => (
          <div key={x.id} className={s.item}><span className={s.grow}>{x.name}</span><button className={s.tbtn} onClick={() => p.undelete(x.id)}>Khôi phục</button>
            <button className={`${s.tbtn} ${s.danger}`} title="Xóa vĩnh viễn (mọi phiên bản)" onClick={() => { if (confirm(`Xóa VĨNH VIỄN dự án "${x.name}" và mọi phiên bản? Không hoàn tác được. Model đã xuất bản vào game vẫn giữ.`)) p.purge(x.id); }}><Icon name="lucide:trash-2" /></button></div>
        ))}</div>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- library */

const CATEGORY_NAME: Record<string, string> = { tree: 'Cây', vegetation: 'Bụi cỏ', rock: 'Đá', decor: 'Đồ vật', structure: 'Công trình', block: 'Khối' };

export function LibraryPanel(p: {
  registry: AssetRegistry; files: ProjectFile[]; doc: ModelDoc | null;
  addAsset(id: number): void; addPreset(preset: string): void; importFile(f: File): void; addImport(file: ProjectFile): void; useImage(file: ProjectFile): void;
}) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<string>('');
  const [tab, setTab] = useState<'models' | 'materials' | 'files'>('models');
  const input = useRef<HTMLInputElement>(null);
  const assets = useMemo(() => p.registry.all().filter((a) => !a.tags.includes('infection-map')), [p.registry]);
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = assets.filter((a) => (!cat || a.category === cat) && words.every((w) => `${a.id} ${a.name} ${a.numericId} ${a.tags.join(' ')}`.toLowerCase().includes(w))).slice(0, 300);
  const usage = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of p.doc?.nodes ?? []) if ('material' in n) m.set(n.material, (m.get(n.material) ?? 0) + 1);
    return m;
  }, [p.doc]);
  return (
    <div className={s.pane}>
      <div className={s.chips} style={{ marginBottom: 8 }}>
        {([['models', 'Model game'], ['materials', 'Vật liệu PBR'], ['files', 'File đã import']] as const).map(([k, n]) => <button key={k} className={`${s.chip} ${tab === k ? s.on : ''}`} onClick={() => setTab(k)}>{n}</button>)}
      </div>
      {tab === 'models' && <>
        <div className={s.row}><input className={s.text} placeholder="Tìm: tree, chair, wall, 2850…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className={s.chips} style={{ marginBottom: 8 }}>
          <button className={`${s.chip} ${!cat ? s.on : ''}`} onClick={() => setCat('')}>Tất cả</button>
          {Object.entries(CATEGORY_NAME).map(([k, n]) => <button key={k} className={`${s.chip} ${cat === k ? s.on : ''}`} onClick={() => setCat(k)}>{n}</button>)}
        </div>
        <p className={s.muted}>{shown.length} model · bấm để đặt vào cảnh (tham chiếu, không sao chép model gốc).</p>
        <div className={s.list}>
          {shown.map((a) => (
            <div key={a.numericId} className={s.item} onClick={() => p.addAsset(a.numericId)} title={`${a.id} · ${a.model.kind} · r ${a.bounds.radius.toFixed(1)} m · cao ${a.bounds.height.toFixed(1)} m`}>
              <Icon name={a.category === 'tree' ? 'lucide:tree-pine' : a.category === 'rock' ? 'lucide:mountain' : a.category === 'structure' ? 'lucide:building-2' : 'lucide:box'} />
              <span className={s.grow}>{a.name}</span><small>#{a.numericId}</small>
            </div>
          ))}
        </div>
      </>}
      {tab === 'materials' && <>
        <p className={s.muted}>Preset vật liệu thật (thông số PBR đo đạc). Bấm để thêm vào dự án; gán ở tab Vật liệu.</p>
        <div className={s.list}>
          {MATERIAL_PRESETS.map((m) => (
            <div key={m.id} className={s.item} onClick={() => p.addPreset(m.id)} title={m.note}>
              <span style={{ width: 14, height: 14, borderRadius: 3, background: m.color, flex: 'none', border: '1px solid #000' }} />
              <span className={s.grow}>{m.name}</span><small>R {m.roughness} · M {m.metalness}</small>
            </div>
          ))}
        </div>
        {p.doc && <div className={s.section} style={{ marginTop: 12 }}>
          <h3>Trong dự án ({p.doc.materials.length})</h3>
          {p.doc.materials.map((m) => <div key={m.id} className={s.item}><span style={{ width: 14, height: 14, borderRadius: 3, background: m.color, flex: 'none' }} /><span className={s.grow}>{m.name}</span><small>{usage.get(m.id) ?? 0} phần</small></div>)}
        </div>}
      </>}
      {tab === 'files' && <>
        <input ref={input} type="file" accept=".glb,.gltf,.png,.jpg,.jpeg" multiple hidden onChange={(e) => { for (const f of Array.from(e.target.files ?? [])) p.importFile(f); e.target.value = ''; }} />
        <button className={`${s.tbtn} ${s.primary}`} onClick={() => input.current?.click()}><Icon name="lucide:upload" /> Import GLB / GLTF / ảnh texture</button>
        <p className={s.muted}>GLB/GLTF (nhúng dữ liệu) ≤ 40 MB; ảnh PNG/JPEG dùng làm màu nền cho vật liệu.</p>
        <div className={s.list}>
          {p.files.map((f) => (
            <div key={f.id} className={s.item}>
              <Icon name={f.mime.startsWith('image/') ? 'lucide:image' : 'lucide:file-box'} />
              <span className={s.grow}>{f.name}</span><small>{(f.size / 1024 / 1024).toFixed(1)} MB</small>
              {f.mime.startsWith('image/') ? <button className={s.tbtn} onClick={() => p.useImage(f)}>Làm texture</button> : <button className={s.tbtn} onClick={() => p.addImport(f)}>Đặt vào cảnh</button>}
            </div>
          ))}
        </div>
      </>}
    </div>
  );
}

/* ------------------------------------------------------------------ hierarchy */

const KIND_ICON: Record<string, string> = { group: 'lucide:folder', primitive: 'lucide:box', rock: 'lucide:mountain', wall: 'lucide:brick-wall', roof: 'lucide:house', stairs: 'lucide:footprints', slab: 'lucide:square', asset: 'lucide:package', import: 'lucide:file-box' };

export function HierarchyPanel(p: { doc: ModelDoc; selected: string[]; select(id: string, additive: boolean): void; mutate: Mutate }) {
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const kids = useMemo(() => {
    const m = new Map<string | null, ModelNode[]>();
    for (const n of p.doc.nodes) m.set(n.parent, [...(m.get(n.parent) ?? []), n]);
    return m;
  }, [p.doc]);
  // Reveal the selection.
  useEffect(() => {
    if (!p.selected.length) return;
    const add = new Set(open);
    for (const id of p.selected) for (let at = p.doc.nodes.find((n) => n.id === id)?.parent; at; at = p.doc.nodes.find((n) => n.id === at)?.parent) add.add(at);
    if (add.size !== open.size) setOpen(add);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.selected]);
  const reparent = (id: string, parent: string | null) => p.mutate('Đổi cha', (d) => {
    if (parent && subtree(d, id).some((n) => n.id === parent)) return;
    const n = d.nodes.find((x) => x.id === id);
    if (n) n.parent = parent;
  });
  const row = (n: ModelNode, depth: number): React.ReactNode => {
    const children = kids.get(n.id) ?? [];
    const isOpen = open.has(n.id);
    return (
      <div key={n.id}>
        <div
          className={`${s.item} ${p.selected.includes(n.id) ? s.on : ''} ${over === n.id ? s.dropTarget : ''}`}
          style={{ paddingLeft: 4 + depth * 12 }}
          draggable onDragStart={() => setDrag(n.id)} onDragEnd={() => { setDrag(null); setOver(null); }}
          onDragOver={(e) => { if (drag && drag !== n.id) { e.preventDefault(); setOver(n.id); } }}
          onDrop={(e) => { e.preventDefault(); if (drag) reparent(drag, n.id); setOver(null); }}
          onClick={(e) => p.select(n.id, e.shiftKey || e.ctrlKey)}
        >
          <button className={s.twist} onClick={(e) => { e.stopPropagation(); const o = new Set(open); if (isOpen) o.delete(n.id); else o.add(n.id); setOpen(o); }}>{children.length ? (isOpen ? '▾' : '▸') : ''}</button>
          <Icon name={KIND_ICON[n.kind] ?? 'lucide:box'} />
          <span className={s.grow} style={{ opacity: n.visible === false ? .45 : 1 }}>{n.name}</span>
          {n.collision === 'none' && <small title="Không va chạm">◌</small>}
          <button className={s.ibtn} title={n.visible === false ? 'Hiện' : 'Ẩn'} onClick={(e) => { e.stopPropagation(); p.mutate('Ẩn/hiện', (d) => { const x = d.nodes.find((y) => y.id === n.id)!; x.visible = x.visible === false; }); }}><Icon name={n.visible === false ? 'lucide:eye-off' : 'lucide:eye'} /></button>
        </div>
        {isOpen && children.map((c) => row(c, depth + 1))}
      </div>
    );
  };
  return (
    <div className={`${s.pane} ${s.tree}`} onDragOver={(e) => { if (drag) e.preventDefault(); }} onDrop={(e) => { if (drag && !over) { e.preventDefault(); reparent(drag, null); } }}>
      <p className={s.muted}>Kéo một phần thả lên phần khác để đổi cha; thả ra ngoài để đưa về gốc. Shift/Ctrl + bấm để chọn nhiều.</p>
      {(kids.get(null) ?? []).map((n) => row(n, 0))}
      {!p.doc.nodes.length && <p className={s.muted}>Cảnh trống.</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ inspector */

function Num({ value, onChange, step = .1, min, max, width }: { value: number; onChange(v: number): void; step?: number; min?: number; max?: number; width?: number }) {
  const [text, setText] = useState(fmt(value));
  useEffect(() => setText(fmt(value)), [value]);
  return <input className={s.num} style={width ? { width } : undefined} type="number" step={step} min={min} max={max} value={text}
    onChange={(e) => setText(e.target.value)} onBlur={() => { const v = Number(text); if (Number.isFinite(v) && v !== value) onChange(v); else setText(fmt(value)); }}
    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />;
}

function Vec({ value, onChange, scale = 1, step = .1 }: { value: [number, number, number]; onChange(v: [number, number, number]): void; scale?: number; step?: number }) {
  return <div className={s.vec}>{[0, 1, 2].map((i) => <Num key={i} step={step} value={value[i]! * scale} onChange={(v) => { const out = [...value] as [number, number, number]; out[i] = v / scale; onChange(out); }} />)}</div>;
}

const PARAM_NAMES: Record<string, string> = {
  width: 'Rộng (m)', height: 'Cao (m)', depth: 'Sâu (m)', radius: 'Bán kính', radiusTop: 'Bán kính trên', segments: 'Số cạnh', ridge: 'Đỉnh (0–1)', tube: 'Ống', roughness: 'Độ lởm chởm', layers: 'Phân lớp', detail: 'Chi tiết (1–5)', seed: 'Seed',
};

export function Inspector({ doc, nodes, mutate }: { doc: ModelDoc; nodes: ModelNode[]; mutate: Mutate }) {
  if (!nodes.length) return <div className={s.pane}><ModelInfo doc={doc} mutate={mutate} /></div>;
  if (nodes.length > 1) return <div className={s.pane}><p className={s.muted}>{nodes.length} phần đang chọn. Dùng gizmo để di chuyển phần chọn cuối; các nút Nhân bản/Xóa áp dụng cho tất cả.</p></div>;
  const n = nodes[0]!;
  const edit = (label: string, fn: (x: ModelNode) => void) => mutate(label, (d) => { const x = d.nodes.find((y) => y.id === n.id); if (x) fn(x); });
  const t = n.transform;
  return (
    <div className={s.pane}>
      <div className={s.section}>
        <h3>{n.kind} · {n.id}</h3>
        <div className={s.row}><label>Tên</label><input className={s.text} value={n.name} maxLength={80} onChange={(e) => edit('Đổi tên', (x) => { x.name = e.target.value || x.name; })} /></div>
        <div className={s.row}><label>Vị trí (m)</label><Vec value={t.position} onChange={(v) => edit('Vị trí', (x) => { x.transform.position = v; })} /></div>
        <div className={s.row}><label>Xoay (°)</label><Vec value={t.rotation} scale={DEG} step={5} onChange={(v) => edit('Xoay', (x) => { x.transform.rotation = v; })} /></div>
        <div className={s.row}><label>Tỉ lệ</label><Vec value={t.scale} step={.05} onChange={(v) => edit('Tỉ lệ', (x) => { x.transform.scale = v.map((k) => (Math.abs(k) < .001 ? .001 : k)) as typeof v; })} /></div>
        <div className={s.row}><label>Va chạm</label>
          <select className={s.select} value={n.collision ?? 'auto'} onChange={(e) => edit('Va chạm', (x) => { x.collision = e.target.value as 'auto'; })}>
            <option value="auto">Tự động (kính, lá, vải: không)</option><option value="mesh">Có (theo hình học)</option><option value="none">Không</option>
          </select>
        </div>
        <div className={s.row}><label>Khóa</label><input type="checkbox" checked={!!n.locked} onChange={(e) => edit('Khóa', (x) => { x.locked = e.target.checked; })} /><span className={s.muted}>Không cho kéo bằng gizmo</span></div>
      </div>
      {(n.kind === 'primitive' || n.kind === 'rock') && (
        <div className={s.section}>
          <h3>Tham số {n.kind === 'primitive' ? `(${n.shape})` : '(đá)'}</h3>
          {Object.entries(n.params).map(([k, v]) => <div className={s.row} key={k}><label>{PARAM_NAMES[k] ?? k}</label><Num value={v} step={k === 'seed' || k === 'segments' || k === 'detail' ? 1 : .05} onChange={(nv) => edit(`Tham số ${k}`, (x) => { if ('params' in x) x.params[k] = nv; })} /></div>)}
          {n.kind === 'rock' && <button className={s.tbtn} onClick={() => edit('Seed mới', (x) => { if (x.kind === 'rock') x.params.seed = Math.floor(Math.random() * 1e6); })}><Icon name="lucide:dices" /> Hình dạng khác</button>}
        </div>
      )}
      {n.kind === 'wall' && (
        <div className={s.section}>
          <h3>Tường</h3>
          {(['length', 'height', 'thickness'] as const).map((k) => <div className={s.row} key={k}><label>{k === 'length' ? 'Dài' : k === 'height' ? 'Cao' : 'Dày'} (m)</label><Num value={n[k]} step={.05} onChange={(v) => edit(`Tường ${k}`, (x) => { if (x.kind === 'wall') x[k] = Math.max(.02, v); })} /></div>)}
          <h3 style={{ marginTop: 8 }}>Lỗ mở ({n.openings.length})</h3>
          {n.openings.map((o, i) => (
            <div className={s.card} key={i}>
              <div className={s.row}>
                <select className={s.select} value={o.kind} onChange={(e) => edit('Loại lỗ', (x) => { if (x.kind === 'wall') x.openings[i]!.kind = e.target.value as typeof o.kind; })}>{OPENING_KINDS.map((k) => <option key={k} value={k}>{({ door: 'Cửa đi', window: 'Cửa sổ', arch: 'Vòm', hole: 'Lỗ thủng' } as const)[k]}</option>)}</select>
                <button className={s.ibtn} title="Bỏ" onClick={() => edit('Bỏ lỗ mở', (x) => { if (x.kind === 'wall') x.openings.splice(i, 1); })}><Icon name="lucide:x" /></button>
              </div>
              <div className={s.grid2}>
                {(['offset', 'width', 'height', 'sill'] as const).map((k) => <label key={k} className={s.muted}>{({ offset: 'Vị trí', width: 'Rộng', height: 'Cao', sill: 'Bậu' } as const)[k]} <Num width={56} value={o[k]} step={.05} onChange={(v) => edit('Lỗ mở', (x) => { if (x.kind === 'wall') x.openings[i]![k] = k === 'offset' ? v : Math.max(0, v); })} /></label>)}
              </div>
            </div>
          ))}
          <div className={s.row}>
            <button className={s.tbtn} onClick={() => edit('Thêm cửa', (x) => { if (x.kind === 'wall') x.openings.push({ kind: 'door', offset: 0, width: .9, height: 2.1, sill: 0 }); })}>+ Cửa đi</button>
            <button className={s.tbtn} onClick={() => edit('Thêm cửa sổ', (x) => { if (x.kind === 'wall') x.openings.push({ kind: 'window', offset: 0, width: 1.2, height: 1.2, sill: .9 }); })}>+ Cửa sổ</button>
          </div>
        </div>
      )}
      {n.kind === 'roof' && (
        <div className={s.section}>
          <h3>Mái</h3>
          <div className={s.row}><label>Kiểu</label><select className={s.select} value={n.style} onChange={(e) => edit('Kiểu mái', (x) => { if (x.kind === 'roof') x.style = e.target.value as typeof n.style; })}>{(['gable', 'hip', 'shed', 'flat'] as const).map((k) => <option key={k} value={k}>{({ gable: 'Hai mái', hip: 'Bốn mái', shed: 'Một mái', flat: 'Mái bằng' } as const)[k]}</option>)}</select></div>
          {(['width', 'depth', 'rise', 'overhang', 'thickness', 'damage'] as const).map((k) => <div className={s.row} key={k}><label>{({ width: 'Rộng', depth: 'Sâu', rise: 'Chiều cao', overhang: 'Đua mái', thickness: 'Dày', damage: 'Hư hỏng 0–1' } as const)[k]}</label><Num value={n[k]} step={.05} onChange={(v) => edit(`Mái ${k}`, (x) => { if (x.kind === 'roof') x[k] = k === 'damage' ? Math.max(0, Math.min(1, v)) : Math.max(0, v); })} /></div>)}
        </div>
      )}
      {n.kind === 'stairs' && (
        <div className={s.section}>
          <h3>Cầu thang</h3>
          {(['width', 'rise', 'run'] as const).map((k) => <div className={s.row} key={k}><label>{({ width: 'Rộng', rise: 'Tổng cao', run: 'Tổng dài' } as const)[k]}</label><Num value={n[k]} step={.05} onChange={(v) => edit(`Cầu thang ${k}`, (x) => { if (x.kind === 'stairs') x[k] = Math.max(.1, v); })} /></div>)}
          <div className={s.row}><label>Số bậc</label><Num value={n.steps} step={1} onChange={(v) => edit('Số bậc', (x) => { if (x.kind === 'stairs') x.steps = Math.max(1, Math.round(v)); })} /></div>
          <p className={s.muted}>Bậc cao {(n.rise / n.steps * 100).toFixed(1)} cm, mặt bậc {(n.run / n.steps * 100).toFixed(1)} cm (nhân vật bước tối đa 45 cm).</p>
        </div>
      )}
      {n.kind === 'slab' && (
        <div className={s.section}>
          <h3>Sàn</h3>
          {(['width', 'depth', 'thickness'] as const).map((k) => <div className={s.row} key={k}><label>{({ width: 'Rộng', depth: 'Sâu', thickness: 'Dày' } as const)[k]}</label><Num value={n[k]} step={.05} onChange={(v) => edit(`Sàn ${k}`, (x) => { if (x.kind === 'slab') x[k] = Math.max(.01, v); })} /></div>)}
          <p className={s.muted}>{n.holes.length} lỗ (giếng thang).</p>
        </div>
      )}
      {n.kind === 'asset' && <div className={s.section}><h3>Model game #{n.asset}</h3><p className={s.muted}>Tham chiếu model có sẵn — model gốc không bị sửa. Khi xuất cho game, nó được đặt kèm và vẽ instanced.</p></div>}
      {n.kind === 'import' && <div className={s.section}><h3>File import</h3><p className={s.muted}>{n.fileName ?? n.file}</p></div>}
    </div>
  );
}

/**
 * Where the building stands on maps — the same lot classes, conditions and kinds of area (and
 * names) as the World Studio's settlements; several of each may be chosen.
 */
export function LotFitEditor({ doc, mutate }: { doc: ModelDoc; mutate: Mutate }) {
  const fit: LotFit = doc.fit ?? lotFitFromLegacy(doc.lotClass) ?? { lots: ['residential', 'commercial'], conditions: ['intact'], areas: [] };
  const set = (label: string, next: LotFit) => mutate(label, (d) => { d.fit = next; delete d.lotClass; });
  const toggle = <T extends string>(list: readonly T[], v: T, keep1: boolean): T[] => list.includes(v) ? (keep1 && list.length === 1 ? [...list] : list.filter((x) => x !== v)) : [...list, v];
  return <div className={s.section}>
    <h3>Đặt trên bản đồ</h3>
    <p className={s.muted}>Dùng chung với World Studio: khi sinh khu vực, công trình được đặt vào những lô hợp với cả ba lựa chọn dưới đây.</p>
    <div className={s.row}><label>Loại lô</label><div className={s.chips}>{LOT_CLASSES.map((k) => <button key={k} type="button" className={`${s.chip} ${fit.lots.includes(k) ? s.on : ''}`} onClick={() => set('Loại lô', { ...fit, lots: toggle(fit.lots, k, true) })}>{LOT_CLASS_NAMES[k]}</button>)}</div></div>
    <div className={s.row}><label>Tình trạng</label><div className={s.chips}>{BUILDING_CONDITIONS.map((k) => <button key={k} type="button" className={`${s.chip} ${fit.conditions.includes(k) ? s.on : ''}`} onClick={() => set('Tình trạng', { ...fit, conditions: toggle(fit.conditions, k, true) })}>{BUILDING_CONDITION_NAMES[k]}</button>)}</div></div>
    <div className={s.row}><label>Kiểu khu vực</label><div className={s.chips}>
      <button type="button" className={`${s.chip} ${fit.areas.length ? '' : s.on}`} onClick={() => set('Kiểu khu vực', { ...fit, areas: [] })}>Mọi khu vực</button>
      {SETTLEMENT_AREA_IDS.map((k) => <button key={k} type="button" className={`${s.chip} ${fit.areas.includes(k) ? s.on : ''}`} onClick={() => set('Kiểu khu vực', { ...fit, areas: toggle(fit.areas, k, false) })}>{SETTLEMENT_AREA_NAMES[k]}</button>)}
    </div></div>
    <p className={s.muted}>{describeLotFit(fit)}{doc.fit ? '' : ' (mặc định)'}</p>
    <button type="button" className={s.tbtn} title="Suy ra từ tên, ghi chú, phòng, số tầng, vật liệu" onClick={() => {
      const c = classifyModel(doc);
      mutate('Tự phân loại', (d) => { d.kind = c.kind; if (c.fit) { d.fit = c.fit; delete d.lotClass; } });
    }}>Tự phân loại</button>
  </div>;
}

function ModelInfo({ doc, mutate }: { doc: ModelDoc; mutate: Mutate }) {
  return (
    <div className={s.section}>
      <h3>Model</h3>
      <div className={s.row}><label>Tên</label><input className={s.text} value={doc.name} maxLength={80} onChange={(e) => mutate('Tên model', (d) => { d.name = e.target.value || d.name; })} /></div>
      <div className={s.row}><label>Loại</label><select className={s.select} value={doc.kind} onChange={(e) => mutate('Loại model', (d) => { d.kind = e.target.value as typeof d.kind; })}>{ASSET_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}</select></div>
      <LotFitEditor doc={doc} mutate={mutate} />
      <div className={s.row}><label>Ghi chú</label><textarea className={s.text} rows={3} value={doc.notes ?? ''} onChange={(e) => mutate('Ghi chú', (d) => { d.notes = e.target.value.slice(0, 4000); })} /></div>
      <p className={s.muted}>Chọn một phần trong khung 3D hoặc tab Cảnh để sửa nó.</p>
      {!!doc.plans?.length && (
        <div className={s.section} style={{ marginTop: 12 }}>
          <h3>Bản vẽ mặt bằng ({doc.plans.length} tầng)</h3>
          {[...doc.plans].sort((a, b) => b.level - a.level).map((p) => {
            const issues = checkPlan(doc, p), errors = issues.filter((i) => i.level === 'error');
            return (
              <div key={p.level} className={s.card}>
                <div className={s.row}><b>Tầng {p.level + 1}</b><span className={s.grow} style={{ flex: 1 }}>{p.name}</span><small className={s.muted}>{p.built ? 'đã dựng' : 'bản vẽ'} · +{p.elevation.toFixed(2)} m</small></div>
                <div className={s.muted}>{p.rooms.length} phòng · {p.walls.length} tường · {p.walls.reduce((n, w) => n + w.openings.filter((o) => o.kind === 'window').length, 0)} cửa sổ · {p.stairs.length} cầu thang · {p.approved ? (p.approved.hash === planHash(doc, p) ? 'đã duyệt' : 'đã sửa sau khi duyệt') : 'chưa duyệt'}</div>
                {p.approved?.assumptions?.map((a, k) => <div key={k} className={s.muted}>Giả định: {a}</div>)}
                {errors.map((i, k) => <div key={k} className={`${s.issue} ${s.error}`}>✕ {i.message}</div>)}
                <div className={s.row}>
                  <button className={s.tbtn} title="Cửa sổ trên tường ngoài theo nhịp mặt đứng, cỡ theo loại phòng, thẳng hàng tầng dưới, tránh cửa và góc" onClick={() => mutate(`Cửa sổ tầng ${p.level + 1}`, (d) => {
                    const q = d.plans!.find((x) => x.level === p.level)!;
                    placeWindows(q, d.plans!.find((x) => x.level === p.level - 1));
                  })}>Tự sinh cửa sổ</button>
                  <button className={s.tbtn} title="Mở cửa cho mọi phòng chưa tới được, qua hành lang/sảnh kề bên" onClick={() => mutate(`Nối phòng tầng ${p.level + 1}`, (d) => {
                    openLinks(d.plans!.find((x) => x.level === p.level)!, []);
                  })}>Nối phòng kín</button>
                </div>
              </div>
            );
          })}
          <RoofFromPlan doc={doc} mutate={mutate} />
        </div>
      )}
    </div>
  );
}

/** A roof over the top storey drawn, from its footprint (L/T blocks meet in valleys). */
function RoofFromPlan({ doc, mutate }: { doc: ModelDoc; mutate: Mutate }) {
  const [style, setStyle] = useState<'gable' | 'hip' | 'shed' | 'flat'>('gable');
  const [pitch, setPitch] = useState(30);
  const [note, setNote] = useState('');
  const roofMat = doc.materials.find((m) => /roof|ngói|mái|tôn|shingle/i.test(`${m.id} ${m.name}`))?.id ?? 'roof_tiles';
  const lerp = () => {
    let msg = '';
    mutate('Lợp mái theo mặt bằng', (d) => {
      try { const r = buildRoof(d, { style, pitch, material: roofMat }); const gaps = roofCovers(d); msg = `Mái ${r.rects.length} khối, chân mái +${r.eaves.toFixed(2)} m${gaps.length ? ` — ${gaps.join(', ')}` : ''}.`; } catch (e) { msg = (e as Error).message; }
    });
    setNote(msg);
  };
  return (
    <div className={s.card}>
      <div className={s.row}><b>Mái theo mặt bằng</b></div>
      <div className={s.row}>
        <select className={s.select} value={style} onChange={(e) => setStyle(e.target.value as typeof style)}>{(['gable', 'hip', 'shed', 'flat'] as const).map((k) => <option key={k} value={k}>{({ gable: 'Hai mái', hip: 'Bốn mái', shed: 'Một mái', flat: 'Mái bằng' } as const)[k]}</option>)}</select>
        <Num value={pitch} step={5} min={0} max={60} width={56} onChange={(v) => setPitch(Math.max(0, Math.min(60, v)))} /><span className={s.muted}>°</span>
        <button className={s.tbtn} onClick={lerp}>Lợp mái</button>
      </div>
      {note && <div className={s.muted}>{note}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------- material */

function Swatch({ m }: { m: ModelMaterial }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const id = window.setTimeout(() => {
      const t = materialTextures(m, 128), ctx = c.getContext('2d')!, img = ctx.createImageData(t.size, t.size);
      img.data.set(t.albedo);
      ctx.putImageData(img, 0, 0);
    }, 30);
    return () => window.clearTimeout(id);
  }, [m]);
  return <canvas ref={ref} width={128} height={128} className={s.swatch} />;
}

export function MaterialPanel({ doc, nodes, mutate, files, projectId, addFiles }: { doc: ModelDoc; nodes: ModelNode[]; mutate: Mutate; files: ProjectFile[]; projectId: string; addFiles(f: ProjectFile[]): void }) {
  const withMat = nodes.filter((n) => 'material' in n) as Array<ModelNode & { material: string }>;
  const [picked, setPicked] = useState<string | null>(null);
  const id = withMat[0]?.material ?? picked ?? doc.materials[0]?.id ?? null;
  const m = id ? doc.materials.find((x) => x.id === id) : undefined;
  const edit = (label: string, fn: (x: ModelMaterial) => void) => mutate(label, (d) => { const x = d.materials.find((y) => y.id === id); if (x) fn(x); });
  const assign = (matId: string) => mutate('Gán vật liệu', (d) => { for (const n of nodes) for (const x of subtree(d, n.id)) if ('material' in x) (x as { material: string }).material = matId; });
  return (
    <div className={s.pane}>
      <div className={s.section}>
        <h3>Vật liệu {withMat.length ? `của phần chọn` : ''}</h3>
        <div className={s.row}>
          <select className={s.select} value={id ?? ''} onChange={(e) => (nodes.length ? assign(e.target.value) : setPicked(e.target.value))}>
            {doc.materials.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.id})</option>)}
          </select>
        </div>
        <div className={s.row}>
          <select className={s.select} value="" onChange={(e) => { const preset = e.target.value; if (!preset) return; mutate('Vật liệu mới', (d) => { let k = 1; while (d.materials.some((x) => x.id === `${preset}-${k}`)) k++; const mat = materialFromPreset(`${preset}-${k}`, preset); d.materials.push(mat); for (const n of nodes) for (const x of subtree(d, n.id)) if ('material' in x) (x as { material: string }).material = mat.id; }); setPicked(null); }}>
            <option value="">+ Vật liệu mới từ preset…</option>
            {MATERIAL_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      </div>
      {m && <TextureBrowser projectId={projectId} material={m} apply={(set) => { addFiles(set.files); edit(`Texture ${set.source.name}`, (x) => { x.maps = set.maps; x.source = set.source; x.texture.scale = set.scale; x.color = '#ffffff'; }); }} clear={() => edit('Bỏ texture thật', (x) => { delete x.maps; delete x.source; })} />}
      {m && <>
        <div className={s.grid2} style={{ marginBottom: 10 }}>
          <Swatch m={m} />
          <div className={s.muted}>
            <div><b>{m.name}</b></div>
            <div>Preset: {m.preset ?? '—'}</div>
            <div>{MATERIAL_PRESETS.find((p) => p.id === m.preset)?.note}</div>
          </div>
        </div>
        <div className={s.section}>
          <h3>PBR</h3>
          <div className={s.row}><label>Tên</label><input className={s.text} value={m.name} onChange={(e) => edit('Tên vật liệu', (x) => { x.name = e.target.value || x.name; })} /></div>
          <div className={s.row}><label>Màu nền</label><input type="color" value={m.color} onChange={(e) => edit('Màu', (x) => { x.color = e.target.value; })} />
            {m.texture.accent !== undefined && <><label style={{ width: 'auto' }} className={s.muted}>Màu phụ</label><input type="color" value={m.texture.accent} onChange={(e) => edit('Màu phụ', (x) => { x.texture.accent = e.target.value; })} /></>}
          </div>
          {([['roughness', 'Độ nhám', 0, 1], ['metalness', 'Kim loại', 0, 1], ['normalStrength', 'Normal', 0, 4], ['aoStrength', 'AO', 0, 1], ['opacity', 'Độ đục', .02, 1]] as const).map(([k, label, min, max]) => (
            <div className={s.row} key={k}><label>{label}</label><input type="range" min={min} max={max} step={.01} value={m[k]} onChange={(e) => edit(label, (x) => { x[k] = Number(e.target.value); if (k === 'opacity' && x.opacity < 1) x.doubleSided = true; })} /><span className={s.muted} style={{ width: 34 }}>{m[k].toFixed(2)}</span></div>
          ))}
          {m.metalness > .05 && m.metalness < .95 && !['rust', 'corrugated'].includes(m.texture.pattern) && <p className={s.muted}>⚠ Bề mặt thật gần như luôn là kim loại (1) hoặc không (0).</p>}
        </div>
        <div className={s.section}>
          <h3>Texture (sinh tự động: màu, normal, nhám, kim loại, AO)</h3>
          <div className={s.row}><label>Mẫu</label><select className={s.select} value={m.texture.pattern} onChange={(e) => edit('Mẫu texture', (x) => { x.texture.pattern = e.target.value as typeof x.texture.pattern; })}>{TEXTURE_PATTERNS.map((k) => <option key={k} value={k}>{k}</option>)}</select></div>
          <div className={s.row}><label>Ô texture (m)</label><Num value={m.texture.scale} step={.1} onChange={(v) => edit('Tỉ lệ texture', (x) => { x.texture.scale = Math.max(.05, Math.min(50, v)); })} /></div>
          {([['variation', 'Biến thiên'], ['wear', 'Mài mòn'], ['dirt', 'Bụi bẩn'], ['moss', 'Rêu'], ['cracks', 'Nứt']] as const).map(([k, label]) => (
            <div className={s.row} key={k}><label>{label}</label><input type="range" min={0} max={1} step={.01} value={m.texture[k]} onChange={(e) => edit(label, (x) => { x.texture[k] = Number(e.target.value); })} /><span className={s.muted} style={{ width: 34 }}>{m.texture[k].toFixed(2)}</span></div>
          ))}
          <div className={s.row}><label>Seed</label><Num value={m.texture.seed} step={1} onChange={(v) => edit('Seed texture', (x) => { x.texture.seed = Math.max(0, Math.round(v)) >>> 0; })} /></div>
          <div className={s.row}><label>Độ phân giải</label><select className={s.select} value={m.resolution ?? 512} onChange={(e) => edit('Độ phân giải', (x) => { x.resolution = Number(e.target.value) as 512; })}>{[256, 512, 1024].map((r) => <option key={r} value={r}>{r}² khi xuất</option>)}</select></div>
          <div className={s.row}><label>Ảnh màu nền</label><select className={s.select} value={m.albedoFile ?? ''} onChange={(e) => edit('Ảnh texture', (x) => { if (e.target.value) x.albedoFile = e.target.value; else delete x.albedoFile; })}>
            <option value="">(sinh tự động)</option>{files.filter((f) => f.mime.startsWith('image/')).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select></div>
          {m.albedoFile && <p className={s.muted}>Ảnh import dùng làm màu nền khi xuất GLB; khung 3D vẫn xem trước bằng texture sinh tự động.</p>}
        </div>
      </>}
    </div>
  );
}

/* ---------------------------------------------------------------------- checks */

export function ChecksPanel({ report, server, select, fix, runServer }: { report: ValidationReport | null; server: ValidationReport | null; select(id: string): void; fix(): void; runServer(): void }) {
  const r = server ?? report;
  if (!r) return <div className={s.pane} />;
  const order: Issue['level'][] = ['error', 'warning', 'info'];
  const st = r.stats;
  return (
    <div className={s.pane}>
      <div className={s.section}>
        <h3>{r.ok ? '✓ Dùng được trong game' : '✕ Còn lỗi phải sửa'} {server ? '(máy chủ)' : '(trong trình duyệt)'}</h3>
        <div className={s.row}>
          <button className={s.tbtn} onClick={fix} disabled={!r.issues.some((i) => i.fixable)}><Icon name="lucide:wand-sparkles" /> Tự sửa</button>
          <button className={s.tbtn} onClick={runServer}><Icon name="lucide:server" /> Kiểm tra trên máy chủ</button>
        </div>
      </div>
      <div className={s.section}>
        <h3>Thông số</h3>
        <div className={s.stat}><span>Kích thước</span><span>{st.size ? st.size.map((v) => v.toFixed(2)).join(' × ') + ' m' : '—'}</span></div>
        <div className={s.stat}><span>Tam giác</span><span>{st.triangles.toLocaleString('vi-VN')}</span></div>
        <div className={s.stat}><span>Tam giác va chạm</span><span>{st.collidingTriangles.toLocaleString('vi-VN')}</span></div>
        <div className={s.stat}><span>Draw call (sau gộp)</span><span>≈ {st.drawCalls}</span></div>
        <div className={s.stat}><span>Phần / vật liệu</span><span>{st.nodes} / {st.materials}</span></div>
        <div className={s.stat}><span>Model game / file import</span><span>{st.assets} / {st.imports}</span></div>
      </div>
      <div className={s.section}>
        <h3>Vấn đề ({r.issues.length})</h3>
        {order.flatMap((lv) => r.issues.filter((i) => i.level === lv)).map((i, k) => (
          <div key={k} className={`${s.issue} ${s[i.level]}`} onClick={() => i.node && select(i.node)} title={i.code}>
            <span>{i.level === 'error' ? '✕' : i.level === 'warning' ? '!' : 'i'}</span><span>{i.message}{i.fixable ? ' (tự sửa được)' : ''}</span>
          </div>
        ))}
        {!r.issues.length && <p className={s.muted}>Không có vấn đề.</p>}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------- versions, publish */

export function VersionsPanel(p: {
  versions: VersionInfo[]; published: PublishedModel[]; projectId: string; trial: { active: number[]; saved: number[] } | null; busy: boolean;
  snapshot(note: string): void; preview(v: number): void; restore(v: number): void; exportGlb(mode: 'game' | 'editable'): void;
  publish(opts: { lotClass?: string; replaceAsset?: number }): void; unpublish(asset: number): void; setTrial(assets: number[]): void;
  /** The model (its placement on maps is chosen right before publishing). */
  doc: ModelDoc; mutate: Mutate;
}) {
  const [note, setNote] = useState('');
  const mine = p.published.filter((x) => x.projectId === p.projectId);
  return (
    <div className={s.pane}>
      <div className={s.section}>
        <h3><Icon name="lucide:download" /> Xuất</h3>
        <div className={s.row}>
          <button className={s.tbtn} disabled={p.busy} onClick={() => p.exportGlb('editable')} title="Giữ phân cấp và tham số; import lại vào Studio vẫn sửa được">GLB chỉnh sửa được</button>
          <button className={s.tbtn} disabled={p.busy} onClick={() => p.exportGlb('game')} title="Gộp theo vật liệu như game tải">GLB cho game</button>
        </div>
      </div>
      <div className={s.section}>
        <h3><Icon name="lucide:rocket" /> Xuất bản vào game</h3>
        <LotFitEditor doc={p.doc} mutate={p.mutate} />
        <div className={s.row}>
          <button className={`${s.tbtn} ${s.primary}`} disabled={p.busy} onClick={() => { if (confirm('Xuất bản model này thành model MỚI trong game? Nó sẽ có trong thư viện của World Studio và các bản đồ; bản đồ đang chạy không đổi cho tới khi dựng lại.')) p.publish({}); }}>Xuất bản mới</button>
        </div>
        {mine.map((x) => (
          <div key={x.asset} className={s.card}>
            <div className={s.row}><b>#{x.asset}</b><span className={s.grow}>{x.name}</span><small className={s.muted}>bản dự án v{x.projectVersion}</small></div>
            <div className={s.muted}>{x.report.triangles?.toLocaleString('vi-VN')} tam giác · {x.report.materials} vật liệu · {((x.report.bytes ?? 0) / 1024 / 1024).toFixed(1)} MB · {x.report.refs ?? 0} model kèm</div>
            <div className={s.row} style={{ marginTop: 6 }}>
              <button className={s.tbtn} disabled={p.busy} onClick={() => { if (confirm(`Ghi đè model #${x.asset} trong game bằng phiên bản hiện tại? Mọi bản đồ dùng nó sẽ nhận bản mới khi dựng lại.`)) p.publish({ replaceAsset: x.asset }); }}>Cập nhật</button>
              <button className={`${s.tbtn} ${s.danger}`} disabled={p.busy} onClick={() => { if (confirm(`Gỡ model #${x.asset} khỏi game? Bản đồ đặt nó sẽ mất nó ở lần dựng sau.`)) p.unpublish(x.asset); }}>Gỡ</button>
            </div>
          </div>
        ))}
      </div>
      <div className={s.section}>
        <h3><Icon name="lucide:history" /> Phiên bản</h3>
        <form className={s.row} onSubmit={(e) => { e.preventDefault(); p.snapshot(note || 'Lưu thủ công'); setNote(''); }}>
          <input className={s.text} value={note} placeholder="Ghi chú phiên bản…" maxLength={200} onChange={(e) => setNote(e.target.value)} />
          <button className={s.tbtn} disabled={p.busy}>Lưu bản</button>
        </form>
        <div className={s.list}>
          {p.versions.map((v) => (
            <div key={v.version} className={s.item} title={new Date(v.createdAt).toLocaleString('vi-VN')}>
              <b>v{v.version}</b><span className={s.grow}>{v.note || '—'}</span><small>{v.author === 'agent' ? 'AI' : ''} {v.nodes} phần</small>
              <button className={s.ibtn} title="Xem trước (không lưu)" onClick={() => p.preview(v.version)}><Icon name="lucide:eye" /></button>
              <button className={s.ibtn} title="Khôi phục" onClick={() => { if (confirm(`Khôi phục phiên bản ${v.version}? Bản hiện tại vẫn được giữ thành một phiên bản.`)) p.restore(v.version); }}><Icon name="lucide:undo-2" /></button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- texture sets */

function Thumb({ id }: { id: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true, made: string | null = null;
    msApi.textureThumb(id).then((u) => { made = u; if (alive) setUrl(u); else URL.revokeObjectURL(u); }).catch(() => undefined);
    return () => { alive = false; if (made) URL.revokeObjectURL(made); };
  }, [id]);
  return url ? <img src={url} alt="" style={{ width: '100%', aspectRatio: '1', borderRadius: 4, display: 'block' }} /> : <div style={{ width: '100%', aspectRatio: '1', background: '#22262a', borderRadius: 4 }} />;
}

/**
 * Real texture sets for the selected material: search the PBR library (scanned, CC0) and apply
 * a set, or have the AI paint one from a description.
 */
function TextureBrowser({ projectId, material, apply, clear }: { projectId: string; material: ModelMaterial; apply(set: TextureSet): void; clear(): void }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<TextureHit[] | null>(null);
  const [canPaint, setCanPaint] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [paint, setPaint] = useState('');
  const [res, setRes] = useState<'1k' | '2k'>('1k');
  const search = async (text: string) => {
    if (!text.trim()) return;
    setBusy('search'); setErr(null);
    try { const r = await msApi.textures(text.trim()); setHits(r.results); setCanPaint(r.canPaint); } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  };
  useEffect(() => { msApi.textures('concrete').then((r) => setCanPaint(r.canPaint)).catch(() => undefined); }, []);
  const run = async (what: string, fn: () => Promise<TextureSet>) => {
    setBusy(what); setErr(null);
    try { apply(await fn()); } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  };
  return (
    <div className={s.section}>
      <h3><Icon name="lucide:images" /> Texture thật</h3>
      {material.source
        ? <div className={s.row}><span className={s.muted} style={{ flex: 1 }}>{material.source.kind === 'polyhaven' ? 'Thư viện' : 'AI vẽ'}: {material.source.name}{material.source.license ? ` · ${material.source.license}` : ''}</span><button className={s.tbtn} onClick={clear}>Bỏ</button></div>
        : <p className={s.muted}>Đang dùng texture sinh tự động. Tìm bộ texture thật (ảnh scan PBR) hoặc để AI vẽ.</p>}
      <form className={s.row} onSubmit={(e) => { e.preventDefault(); void search(q); }}>
        <input className={s.text} value={q} placeholder="vd: smooth concrete, rusty metal, marble…" onChange={(e) => setQ(e.target.value)} />
        <select className={s.select} style={{ flex: 'none', width: 56 }} value={res} onChange={(e) => setRes(e.target.value as '1k')}><option value="1k">1K</option><option value="2k">2K</option></select>
        <button className={s.tbtn} disabled={!!busy}>{busy === 'search' ? '…' : 'Tìm'}</button>
      </form>
      {hits && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginBottom: 8 }}>
          {hits.map((h) => (
            <button key={h.id} className={s.card} style={{ padding: 4, margin: 0, cursor: 'pointer', textAlign: 'left', opacity: busy && busy !== h.id ? .6 : 1 }} disabled={!!busy} title={`${h.name}${h.sizeM ? ` · ô ${h.sizeM.toFixed(1)} m` : ''}\n${h.description}`} onClick={() => void run(h.id, () => msApi.downloadTexture(projectId, h.id, res))}>
              <Thumb id={h.id} />
              <div style={{ fontSize: 11, marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{busy === h.id ? 'Đang tải…' : h.name}</div>
            </button>
          ))}
          {!hits.length && <p className={s.muted}>Không thấy — thử từ tiếng Anh khác.</p>}
        </div>
      )}
      <div className={s.row}>
        <input className={s.text} value={paint} disabled={!canPaint} placeholder={canPaint ? 'AI vẽ: weathered green painted wood with peeling paint…' : 'AI vẽ texture cần API key (Cấu hình AI)'} onChange={(e) => setPaint(e.target.value)} />
        <button className={s.tbtn} disabled={!canPaint || paint.trim().length < 8 || !!busy} onClick={() => void run('paint', () => msApi.paintTexture(projectId, paint.trim(), material.roughness, material.metalness))}>{busy === 'paint' ? 'Đang vẽ…' : 'Vẽ'}</button>
      </div>
      {err && <p style={{ color: '#ff8b80', fontSize: 12 }}>{err}</p>}
    </div>
  );
}
