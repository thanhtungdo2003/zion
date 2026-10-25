'use client';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createDefaultRegistry, LIGHT_SOURCE_ASSET, uploadedMapFit, type AssetDefinition, type AssetDefinitionInput, type UploadedMapFit } from '@zion/assets';
import { Vector3, type Mesh } from 'three';
import { gltfLoader } from '@/game/render/gltf-loader';
import { DEFAULT_INFECTION_MAP, blankInfectionMap, infectionMapSchema, type InfectionMapDef, type InfectionMaps, type InfectionPart, type InfectionRules } from '@zion/shared';
import { studioActivateInfectionMap, studioDeleteInfectionMap, studioInfectionMaps, studioInfectionModels, studioLogin, studioPreviewInfectionMap, studioSaveInfectionMap, studioUploadInfectionModel, type InfectionMapModel, type InfectionMapPreview } from '@/lib/api';
import { ConfirmDialog } from './ConfirmDialog';
import { Icon } from './Icon';
import { Spinner } from './Spinner';

const registry = createDefaultRegistry();

/** Centring and collision of a map model, from its triangles as three.js decodes them. */
async function mapFitOf(buf: ArrayBuffer): Promise<UploadedMapFit> {
  const gltf = await gltfLoader().parseAsync(buf, '');
  gltf.scene.updateMatrixWorld(true);
  const tris: Array<Array<[number, number, number]>> = [], a = new Vector3(), b = new Vector3(), c = new Vector3();
  gltf.scene.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    const pos = mesh.geometry.getAttribute('position'), index = mesh.geometry.getIndex();
    if (!pos) return;
    const n = index ? index.count : pos.count, at = (k: number) => (index ? index.getX(k) : k);
    for (let k = 0; k + 2 < n; k += 3) {
      a.fromBufferAttribute(pos, at(k)).applyMatrix4(mesh.matrixWorld); b.fromBufferAttribute(pos, at(k + 1)).applyMatrix4(mesh.matrixWorld); c.fromBufferAttribute(pos, at(k + 2)).applyMatrix4(mesh.matrixWorld);
      tris.push([a.toArray(), b.toArray(), c.toArray()]);
    }
  });
  return uploadedMapFit(tris);
}
// WebGL viewer: client only, loaded when first shown.
const ModelPreview = dynamic(() => import('./ModelPreview'), { ssr: false });
const InfectionMap3D = dynamic(() => import('./InfectionMap3D'), { ssr: false });
type Group = 'buildings' | 'materials' | 'nature';
const GROUPS: Array<{ id: Group; label: string; icon: string }> = [
  { id: 'buildings', label: 'Công trình', icon: 'lucide:house' },
  { id: 'materials', label: 'Vật liệu', icon: 'lucide:box' },
  { id: 'nature', label: 'Thiên nhiên', icon: 'game-icons:pine-tree' },
];
function groupOf(def: AssetDefinition): Group | null {
  if (def.tags?.includes('plane') || def.id.startsWith('imported.drive_')) return null;
  if (def.category === 'tree' || def.category === 'vegetation' || def.category === 'rock') return 'nature';
  if (def.category === 'structure' && def.bounds.radius >= 3.5) return 'buildings';
  return 'materials';
}
const CATALOG = registry.all().flatMap((def) => { const g = groupOf(def); return g ? [{ def, group: g }] : []; });

type Tool = { kind: 'select' } | { kind: 'place'; asset: number } | { kind: 'spawn' } | { kind: 'zombie' };
type Sel = { kind: 'part'; index: number } | { kind: 'spawn'; index: number } | { kind: 'zombie'; index: number } | null;

const RULES: Array<{ key: keyof InfectionRules; label: string; min: number; max: number; step: number; scale?: number; unit?: string }> = [
  { key: 'zombieHealth', label: 'Máu zombie (người = 100)', min: 1, max: 5000, step: 10 },
  { key: 'zombieSpeed', label: 'Tốc độ zombie (×)', min: .5, max: 3, step: .05 },
  { key: 'zombieJump', label: 'Lực nhảy zombie (×)', min: .5, max: 3, step: .05 },
  { key: 'zombieRespawnMs', label: 'Zombie hồi sinh sau', min: 0, max: 60, step: 1, scale: 1000, unit: 's' },
  { key: 'knockPerDamage', label: 'Đẩy lùi mỗi điểm sát thương', min: 0, max: 2, step: .01 },
  { key: 'knockMax', label: 'Đẩy lùi tối đa (m/s)', min: 0, max: 30, step: .5 },
  { key: 'perZombie', label: 'Số người / 1 zombie đầu tiên', min: 1, max: 32, step: 1 },
  { key: 'maxPlayers', label: 'Số người chơi tối đa', min: 2, max: 32, step: 1 },
  { key: 'minPlayers', label: 'Người thật cần để bắt đầu', min: 1, max: 32, step: 1 },
  { key: 'rounds', label: 'Số vòng mỗi trận', min: 1, max: 20, step: 1 },
  { key: 'countdownMs', label: 'Đếm ngược đầu vòng', min: 3, max: 120, step: 1, scale: 1000, unit: 's' },
  { key: 'outbreakMs', label: 'Bùng phát sau', min: 1, max: 120, step: 1, scale: 1000, unit: 's' },
  { key: 'roundMs', label: 'Thời gian vòng', min: 30, max: 1800, step: 10, scale: 1000, unit: 's' },
  { key: 'finishedMs', label: 'Màn kết quả', min: 3, max: 60, step: 1, scale: 1000, unit: 's' },
];

const uid = () => Math.random().toString(36).slice(2, 8);
const slug = (name: string) => name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'map';

/** Rotated footprint boxes of a model (colliders, or a circle of its bounds when it has none). */
function footprint(asset: number): Array<{ cx: number; cz: number; hx: number; hz: number }> | null {
  const def = registry.byNumericId(asset);
  const boxes = def?.colliders.filter((c) => c.type === 'box') ?? [];
  return boxes.length ? boxes.map((b) => ({ cx: b.center[0], cz: b.center[2], hx: b.halfExtents[0], hz: b.halfExtents[2] })) : null;
}

/**
 * Studio "Lây nhiễm": the Infection maps. Make a map from a seed (size, hills, banks, wall),
 * dress it (grass, trees, bushes, rocks, ground, time of day), place buildings and materials
 * from the catalogue on a top-down plan, set human and zombie spawn points and tune every round
 * rule. The active map is what new Infection matches are played on.
 */
/** 06:30-style clock for a time of day (0…1). */
const clockOf = (t: number) => { const m = Math.round(t * 24 * 60) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
/** A sky gradient for the time of day (night blue, dawn orange, day blue). */
function skyColour(t: number): string {
  const h = t * 24, day = Math.max(0, Math.min(1, (Math.min(h, 24 - h) - 5) / 2.5)), dusk = Math.max(0, 1 - Math.abs(h - 6.2) / 1.6, 1 - Math.abs(h - 18.6) / 1.6);
  const top = day > .5 ? '#3f86d6' : dusk > .2 ? '#5a4a7a' : '#0c1630', bottom = dusk > .2 ? '#f0985a' : day > .5 ? '#a8d0f2' : '#1d2b4a';
  return `linear-gradient(180deg, ${top}, ${bottom})`;
}

export default function InfectionStudio() {
  const [status, setStatus] = useState<'loading' | 'locked' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [maps, setMaps] = useState<InfectionMaps | null>(null);
  const [draft, setDraft] = useState<InfectionMapDef | null>(null);
  const [saved, setSaved] = useState('');
  const [preview, setPreview] = useState<InfectionMapPreview | null>(null);
  const [view3d, setView3d] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [tool, setTool] = useState<Tool>({ kind: 'select' });
  const [sel, setSel] = useState<Sel>(null);
  const [group, setGroup] = useState<Group>('buildings');
  const [search, setSearch] = useState('');
  const [ghostYaw, setGhostYaw] = useState(0);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [creating, setCreating] = useState(false);

  const flash = useCallback((t: string) => { setToast(t); window.setTimeout(() => setToast((x) => (x === t ? null : x)), 2600); }, []);
  const adopt = useCallback((next: InfectionMaps, id?: string) => {
    setMaps(next);
    const map = next.maps.find((m) => m.id === (id ?? next.active)) ?? next.maps[0]!;
    setDraft(structuredClone(map)); setSaved(JSON.stringify(map)); setSel(null);
  }, []);
  const load = useCallback(() => studioInfectionMaps().then((m) => { adopt(m); setStatus('ready'); }).catch((e: unknown) => {
    const code = (e as { status?: number }).status;
    if (code === 401 || code === 403) setStatus('locked'); else { setStatus('error'); setError((e as Error).message); }
  }), [adopt]);
  useEffect(() => { void load(); }, [load]);
  // Map models uploaded earlier: registered here so the plan and the 3D view can draw them.
  const [models, setModels] = useState<InfectionMapModel[]>([]);
  const [uploading, setUploading] = useState(false);
  const adoptModels = useCallback((list: InfectionMapModel[]) => {
    for (const m of list) { try { registry.registerUploaded(m.def as AssetDefinitionInput); } catch { /* invalid entry */ } }
    setModels(list);
  }, []);
  useEffect(() => { if (status === 'ready') void studioInfectionModels().then((r) => adoptModels(r.models)).catch(() => undefined); }, [status, adoptModels]);
  const uploadModel = (file: File) => {
    if (file.size > 48 * 1024 * 1024) { flash('File lớn hơn 48 MB.'); return; }
    setUploading(true);
    void file.arrayBuffer().then(async (buf) => {
      // Decoded here (compressed models too): its triangles give the centring and the collision.
      const fit = await mapFitOf(buf);
      let bin = ''; const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return studioUploadInfectionModel(file.name.replace(/\.glb$/i, '').slice(0, 60), btoa(bin), fit);
    }).then((m) => {
      adoptModels([...models.filter((x) => x.asset !== m.asset), m]);
      // Models made in centimetres (hundreds of "metres" tall) start at 1/100.
      const height = (m.def as { bounds?: { height?: number } }).bounds?.height ?? 10;
      const scale = height > 300 ? .01 : height < .3 ? 100 : 1;
      patch((d) => { d.base = 'model'; d.model = { asset: m.asset, scale, yaw: 0, y: 0 }; });
      setView3d(true);
      flash(`Đã tải lên ${m.name}: so kích thước với nhân vật trong 3D và chỉnh "Tỉ lệ model".`);
    }).catch((e: unknown) => flash(`Không tải lên được: ${(e as Error).message}`)).finally(() => setUploading(false));
  };

  const dirty = !!draft && JSON.stringify(draft) !== saved;
  const valid = useMemo(() => (draft ? infectionMapSchema.safeParse(draft) : null), [draft]);

  // Preview: ground, grass and nature as the server builds them (debounced while editing).
  const previewKey = draft ? JSON.stringify({ ...draft, rules: undefined, name: undefined }) : '';
  useEffect(() => {
    if (!draft || !valid?.success) return;
    const t = window.setTimeout(() => {
      setPreviewing(true);
      studioPreviewInfectionMap(draft).then(setPreview).catch((e: unknown) => flash((e as Error).message)).finally(() => setPreviewing(false));
    }, 500);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey]);

  const patch = (fn: (d: InfectionMapDef) => void) => setDraft((d) => { if (!d) return d; const next = structuredClone(d); fn(next); return next; });

  /* ----------------------------------------------------------------------------- the plan */
  const canvas = useRef<HTMLCanvasElement>(null);
  const view = useRef({ cx: 0, cz: 0, zoom: 3 });
  const [, redraw] = useState(0);
  const mouse = useRef<{ x: number; z: number } | null>(null);
  const drag = useRef<{ kind: 'pan' | 'move'; sx: number; sy: number; ox: number; oz: number; moved: boolean } | null>(null);

  const toScreen = (x: number, z: number, w: number, h: number) => ({ x: w / 2 + (x - view.current.cx) * view.current.zoom, y: h / 2 + (z - view.current.cz) * view.current.zoom });
  const toWorld = (sx: number, sy: number) => {
    const c = canvas.current!, r = c.getBoundingClientRect();
    return { x: (sx - r.left - r.width / 2) / view.current.zoom + view.current.cx, z: (sy - r.top - r.height / 2) / view.current.zoom + view.current.cz };
  };

  const draw = useCallback(() => {
    const c = canvas.current;
    if (!c || !draft) return;
    const w = c.clientWidth, h = c.clientHeight, dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#0b0c0d'; g.fillRect(0, 0, w, h);
    const z = view.current.zoom;
    // Ground: height shading and grass.
    if (preview) {
      const { size, step, origin, heights, grass } = preview;
      let lo = Infinity, hi = -Infinity;
      for (const v of heights) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
      for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
        const k = j * size + i, t = hi > lo ? (heights[k]! - lo) / (hi - lo) : .5;
        const p = toScreen(origin + i * step - step / 2, origin + j * step - step / 2, w, h);
        const l = Math.round(26 + t * 70);
        g.fillStyle = grass[k] ? `rgb(${l * .55},${l * .95},${l * .45})` : `rgb(${l * .9},${l * .82},${l * .68})`;
        g.fillRect(p.x, p.y, step * z + 1, step * z + 1);
      }
    }
    // Play area.
    const a = toScreen(-draft.half, -draft.half, w, h);
    g.strokeStyle = '#ff3b30'; g.lineWidth = 2; g.setLineDash([8, 6]); g.strokeRect(a.x, a.y, draft.half * 2 * z, draft.half * 2 * z); g.setLineDash([]);
    // Grid every 10 m.
    g.strokeStyle = 'rgba(255,255,255,.05)'; g.lineWidth = 1;
    for (let v = -Math.ceil(draft.half / 10) * 10; v <= draft.half; v += 10) {
      const p = toScreen(v, v, w, h);
      g.beginPath(); g.moveTo(p.x, 0); g.lineTo(p.x, h); g.moveTo(0, p.y); g.lineTo(w, p.y); g.stroke();
    }
    const shape = (asset: number, x: number, zz: number, yaw: number, scale: number, fill: string, stroke: string) => {
      const boxes = footprint(asset), cy = Math.cos(yaw), sy = Math.sin(yaw);
      g.fillStyle = fill; g.strokeStyle = stroke; g.lineWidth = 1;
      if (!boxes) {
        const p = toScreen(x, zz, w, h), r = Math.max(1.5, (registry.byNumericId(asset)?.bounds.radius ?? .5) * scale * z * .6);
        g.beginPath(); g.arc(p.x, p.y, r, 0, Math.PI * 2); g.fill(); g.stroke(); return;
      }
      for (const b of boxes) {
        g.beginPath();
        for (const [lx, lz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
          const px = (b.cx + lx * b.hx) * scale, pz = (b.cz + lz * b.hz) * scale;
          const p = toScreen(x + px * cy + pz * sy, zz - px * sy + pz * cy, w, h);
          g.lineTo(p.x, p.y);
        }
        g.closePath(); g.fill(); g.stroke();
      }
    };
    for (const p of preview?.base ?? []) shape(p.asset, p.x, p.z, p.yaw, p.scale, 'rgba(150,150,150,.5)', 'rgba(220,220,220,.35)');
    for (const p of preview?.wall ?? []) shape(p.asset, p.x, p.z, p.yaw, p.scale, 'rgba(90,90,90,.9)', '#222');
    for (const p of preview?.nature ?? []) shape(p.asset, p.x, p.z, p.yaw, p.scale, 'rgba(60,140,70,.55)', 'rgba(20,60,25,.8)');
    draft.parts.forEach((p, i) => {
      const on = sel?.kind === 'part' && sel.index === i;
      shape(p.asset, p.x, p.z, p.yaw, p.scale, on ? 'rgba(255,176,0,.75)' : 'rgba(255,176,0,.35)', on ? '#fff' : '#ffb000');
    });
    const marker = (x: number, zz: number, color: string, on: boolean, auto = false) => {
      const p = toScreen(x, zz, w, h);
      g.fillStyle = color; g.globalAlpha = auto ? .45 : 1;
      g.beginPath(); g.moveTo(p.x, p.y - 9); g.lineTo(p.x + 7, p.y); g.lineTo(p.x, p.y + 9); g.lineTo(p.x - 7, p.y); g.closePath(); g.fill();
      g.globalAlpha = 1;
      if (on) { g.strokeStyle = '#fff'; g.lineWidth = 2; g.stroke(); }
    };
    if (!draft.spawns.length) for (const s of preview?.spawns ?? []) marker(s.x, s.z, '#7fc8ff', false, true);
    if (!draft.zombieSpawns.length && draft.spawns.length === 0) { /* zombies share the human spawns */ }
    draft.spawns.forEach((s, i) => marker(s.x, s.z, '#7fc8ff', sel?.kind === 'spawn' && sel.index === i));
    draft.zombieSpawns.forEach((s, i) => marker(s.x, s.z, '#ff3b30', sel?.kind === 'zombie' && sel.index === i));
    // Placement ghost.
    if (tool.kind === 'place' && mouse.current) shape(tool.asset, mouse.current.x, mouse.current.z, ghostYaw, 1, 'rgba(255,255,255,.25)', '#fff');
  }, [draft, preview, sel, tool, ghostYaw]);
  useEffect(() => { draw(); });
  useEffect(() => {
    const onResize = () => draw();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [draw]);

  /** What is under the cursor (spawns first, then the topmost part). */
  const pick = (x: number, z: number): Sel => {
    if (!draft) return null;
    const near = (s: { x: number; z: number }) => Math.hypot(s.x - x, s.z - z) < 10 / view.current.zoom;
    const zi = draft.zombieSpawns.findIndex(near); if (zi >= 0) return { kind: 'zombie', index: zi };
    const si = draft.spawns.findIndex(near); if (si >= 0) return { kind: 'spawn', index: si };
    for (let i = draft.parts.length - 1; i >= 0; i--) {
      const p = draft.parts[i]!, boxes = footprint(p.asset), c = Math.cos(p.yaw), s = Math.sin(p.yaw);
      const dx = x - p.x, dz = z - p.z, lx = (dx * c - dz * s) / p.scale, lz = (dx * s + dz * c) / p.scale;
      if (boxes ? boxes.some((b) => Math.abs(lx - b.cx) <= b.hx && Math.abs(lz - b.cz) <= b.hz) : Math.hypot(dx, dz) < (registry.byNumericId(p.asset)?.bounds.radius ?? 1) * p.scale) return { kind: 'part', index: i };
    }
    return null;
  };
  const snap = (v: number) => Math.round(v * 2) / 2;

  const onDown = (e: React.PointerEvent) => {
    if (!draft) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    const w = toWorld(e.clientX, e.clientY);
    if (e.button === 1 || e.button === 2 || e.shiftKey) { drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, ox: view.current.cx, oz: view.current.cz, moved: false }; return; }
    if (tool.kind === 'place') {
      patch((d) => { d.parts.push({ asset: tool.asset, x: snap(w.x), y: 0, z: snap(w.z), yaw: ghostYaw, scale: 1 }); });
      setSel({ kind: 'part', index: draft.parts.length });
      return;
    }
    if (tool.kind === 'spawn' || tool.kind === 'zombie') {
      const list = tool.kind === 'spawn' ? 'spawns' : 'zombieSpawns';
      const hit = draft[list].findIndex((s) => Math.hypot(s.x - w.x, s.z - w.z) < 10 / view.current.zoom);
      patch((d) => { if (hit >= 0) d[list].splice(hit, 1); else d[list].push({ x: snap(w.x), z: snap(w.z) }); });
      return;
    }
    const s = pick(w.x, w.z);
    setSel(s);
    if (s) {
      const o = s.kind === 'part' ? draft.parts[s.index]! : s.kind === 'spawn' ? draft.spawns[s.index]! : draft.zombieSpawns[s.index]!;
      drag.current = { kind: 'move', sx: w.x, sy: w.z, ox: o.x, oz: o.z, moved: false };
    } else drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, ox: view.current.cx, oz: view.current.cz, moved: false };
  };
  const onMove = (e: React.PointerEvent) => {
    const w = toWorld(e.clientX, e.clientY);
    mouse.current = w;
    const d = drag.current;
    if (d?.kind === 'pan') {
      view.current.cx = d.ox - (e.clientX - d.sx) / view.current.zoom; view.current.cz = d.oz - (e.clientY - d.sy) / view.current.zoom;
      draw(); return;
    }
    if (d?.kind === 'move' && sel) {
      const x = snap(d.ox + w.x - d.sx), z = snap(d.oz + w.z - d.sy);
      d.moved = true;
      patch((m) => { const o = sel.kind === 'part' ? m.parts[sel.index] : sel.kind === 'spawn' ? m.spawns[sel.index] : m.zombieSpawns[sel.index]; if (o) { o.x = x; o.z = z; if (sel.kind !== 'part') delete (o as { y?: number }).y; } });
      return;
    }
    if (tool.kind === 'place') draw();
  };
  const onUp = () => { drag.current = null; };
  const onWheel = (e: React.WheelEvent) => {
    const before = toWorld(e.clientX, e.clientY);
    view.current.zoom = Math.max(.6, Math.min(20, view.current.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
    const after = toWorld(e.clientX, e.clientY);
    view.current.cx += before.x - after.x; view.current.cz += before.z - after.z;
    redraw((n) => n + 1);
  };

  const removeSel = useCallback(() => {
    if (!sel) return;
    patch((d) => { if (sel.kind === 'part') d.parts.splice(sel.index, 1); else if (sel.kind === 'spawn') d.spawns.splice(sel.index, 1); else d.zombieSpawns.splice(sel.index, 1); });
    setSel(null);
  }, [sel]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, select, textarea')) return;
      if (e.key === 'Escape') { setTool({ kind: 'select' }); setSel(null); }
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel) { e.preventDefault(); removeSel(); }
      const turn = e.key === 'q' || e.key === 'Q' ? -Math.PI / 12 : e.key === 'e' || e.key === 'E' ? Math.PI / 12 : 0;
      if (turn) {
        if (tool.kind === 'place') setGhostYaw((y) => y + turn);
        else if (sel?.kind === 'part') patch((d) => { d.parts[sel.index]!.yaw += turn; });
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'd' && sel?.kind === 'part') {
        e.preventDefault();
        patch((d) => { const p = d.parts[sel.index]!; d.parts.push({ ...p, x: p.x + 2, z: p.z + 2 }); });
        setSel({ kind: 'part', index: draft!.parts.length });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sel, tool, removeSel, draft]);

  /* ------------------------------------------------------------------------------ actions */
  const save = async () => {
    if (!draft || !valid?.success) return;
    setBusy(true);
    try { adopt(await studioSaveInfectionMap(draft), draft.id); flash(maps?.active === draft.id ? 'Đã lưu · các trận mới dùng bản đồ này ngay' : 'Đã lưu bản đồ'); }
    catch (e) { flash((e as Error).message); }
    finally { setBusy(false); }
  };
  const activate = async () => {
    if (!draft) return;
    setBusy(true);
    try { if (dirty) await studioSaveInfectionMap(draft); adopt(await studioActivateInfectionMap(draft.id), draft.id); flash('Các trận Lây nhiễm mới sẽ chơi bản đồ này'); }
    catch (e) { flash((e as Error).message); }
    finally { setBusy(false); }
  };
  const create = (from: 'blank' | 'copy') => {
    if (!maps || !draft) return;
    const name = from === 'copy' ? `${draft.name} (bản sao)` : 'Bản đồ mới';
    const id = `${slug(name)}-${uid()}`;
    const map = from === 'copy' ? { ...structuredClone(draft), id, name } : blankInfectionMap(id, name, `seed-${uid()}`);
    setMaps({ ...maps, maps: [...maps.maps, map] });
    setDraft(map); setSaved(''); setSel(null); setCreating(false);
    view.current = { cx: 0, cz: 0, zoom: 3 };
  };
  const switchTo = (id: string) => {
    const map = maps?.maps.find((m) => m.id === id);
    if (!map) return;
    setDraft(structuredClone(map)); setSaved(JSON.stringify(map)); setSel(null); setPreview(null);
  };

  /* ------------------------------------------------------------------------------- render */
  if (status === 'locked') return (
    <div className="studio-root studio-gate"><div className="overlay-card"><h2>Xưởng Lây nhiễm</h2>
      <form className="studio-unlock" onSubmit={(e) => { e.preventDefault(); void studioLogin(password).then(() => { setStatus('loading'); return load(); }).catch(() => setError('Sai mật khẩu xưởng.')); }}>
        <p>Nhập mật khẩu xưởng để quản lý bản đồ Lây nhiễm.</p>
        <input type="password" autoFocus placeholder="Mật khẩu xưởng" value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <p className="error">{error}</p>}
        <button className="btn btn-primary" type="submit" disabled={!password}>Vào</button>
      </form></div></div>
  );
  if (status !== 'ready' || !draft || !maps) return <div className="studio-root studio-gate"><div className="overlay-card">{status === 'error' ? <p className="error">{error}</p> : <Spinner />}</div></div>;

  const num = (label: string, value: number, set: (v: number) => void, min: number, max: number, step: number, unit = '') => (
    <label className="ix-field"><span>{label}<b>{Number.isInteger(step) ? value : value.toFixed(step < .1 ? 2 : 1)}{unit}</b></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => set(Number(e.target.value))} /></label>
  );
  const part = sel?.kind === 'part' ? draft.parts[sel.index] : undefined;
  const setPart = (fn: (p: InfectionPart) => void) => sel?.kind === 'part' && patch((d) => fn(d.parts[sel.index]!));
  const shown = CATALOG.filter((c) => c.group === group && (!search || `${c.def.name} ${c.def.id}`.toLowerCase().includes(search.toLowerCase())));
  const isActive = maps.active === draft.id;

  return (
    <div className="ix-page">
      <header className="studio-bar">
        <Link href="/studio" className="studio-back" title="Về Xưởng căn cứ"><Icon name="lucide:arrow-left" /></Link>
        <h1>Xưởng Lây nhiễm</h1>
        <select className="ix-map-select" value={draft.id} onChange={(e) => switchTo(e.target.value)} disabled={dirty} title={dirty ? 'Lưu hoặc hủy thay đổi trước khi đổi bản đồ' : undefined}>
          {maps.maps.map((m) => <option key={m.id} value={m.id}>{m.name}{m.id === maps.active ? ' · đang dùng' : ''}</option>)}
        </select>
        <button className="btn" onClick={() => setCreating(true)} disabled={dirty}><Icon name="lucide:plus" /> Tạo map mới</button>
        {isActive ? <span className="studio-badge custom">Đang dùng cho trận mới</span> : <button className="btn" onClick={() => void activate()} disabled={busy || !valid?.success}><Icon name="lucide:play" /> Dùng cho trận</button>}
        {dirty && <span className="studio-badge unsaved">Chưa lưu</span>}
        <div className="studio-spacer" />
        {previewing && <Spinner />}
        <button className="btn" onClick={() => switchTo(draft.id)} disabled={!dirty || !saved}>Hủy thay đổi</button>
        <button className="btn" onClick={() => setDeleting(true)} disabled={isActive || busy}><Icon name="lucide:trash" /></button>
        <button className="btn btn-primary" onClick={() => void save()} disabled={!dirty || busy || !valid?.success}>{busy ? <Spinner /> : <><Icon name="lucide:save" /> Lưu</>}</button>
      </header>
      {creating && (
        <div className="confirm-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setCreating(false); }}>
          <div className="confirm-dialog ix-create"><h2>Tạo map mới</h2>
            <button className="btn" onClick={() => create('blank')}><Icon name="lucide:file-plus" /> Bản đồ trống · địa hình theo seed</button>
            <button className="btn" onClick={() => create('copy')}><Icon name="lucide:copy" /> Nhân bản “{draft.name}”</button>
            <button className="btn" onClick={() => setCreating(false)}>Đóng</button>
          </div>
        </div>
      )}
      {deleting && <ConfirmDialog title={`Xóa ${draft.name}?`} message="Xóa vĩnh viễn bản đồ này." confirmLabel="Xóa" onCancel={() => setDeleting(false)}
        onConfirm={async () => { if (saved) adopt(await studioDeleteInfectionMap(draft.id)); else adopt({ ...maps, maps: maps.maps.filter((m) => m.id !== draft.id) }); setDeleting(false); }} />}
      {valid && !valid.success && <p className="error ix-error">{valid.error.issues.slice(0, 2).map((i) => `${i.path.join('.')}: ${i.message}`).join(' · ')}</p>}

      <div className="ix-layout">
        <aside className="ix-panel ix-catalog">
          <div className="ix-tools">
            <button className={tool.kind === 'select' ? 'on' : ''} onClick={() => setTool({ kind: 'select' })} title="Chọn / kéo (Esc)"><Icon name="lucide:mouse-pointer-2" /></button>
            <button className={tool.kind === 'spawn' ? 'on' : ''} onClick={() => setTool({ kind: 'spawn' })} title="Điểm xuất hiện của người (bấm lại để xóa)"><Icon name="lucide:user-round-plus" /></button>
            <button className={tool.kind === 'zombie' ? 'on zombie' : 'zombie'} onClick={() => setTool({ kind: 'zombie' })} title="Điểm hồi sinh zombie (bấm lại để xóa)"><Icon name="game-icons:shambling-zombie" /></button>
          </div>
          <div className="ix-groups">{GROUPS.map((g) => <button key={g.id} className={group === g.id ? 'on' : ''} onClick={() => setGroup(g.id)}><Icon name={g.icon} />{g.label}</button>)}</div>
          {(() => {
            // 3D look at the model being placed (or the part selected): drag to turn, wheel to zoom.
            const asset = tool.kind === 'place' ? tool.asset : part?.asset;
            return asset !== undefined ? <div className="ix-preview"><ModelPreview key={asset} model={{ asset }} title={registry.byNumericId(asset)?.name ?? String(asset)} /></div> : null;
          })()}
          <input className="ix-search" placeholder="Tìm mô hình…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="ix-list">
            {shown.map(({ def }) => (
              <button key={def.numericId} className={tool.kind === 'place' && tool.asset === def.numericId ? 'on' : ''} onClick={() => { setTool({ kind: 'place', asset: def.numericId }); setSel(null); }}>
                <b>{def.name}</b><small>{(def.bounds.radius * 2).toFixed(1)} m · {def.id}</small>
              </button>
            ))}
          </div>
          <p className="ix-hint">Kéo: di chuyển · Shift/chuột phải kéo: xem bản đồ · Lăn chuột: thu phóng · Q/E: xoay 15° · Ctrl+D: nhân bản · Delete: xóa</p>
        </aside>

        <div className="ix-plan">
          <button className={`btn ix-view-toggle${view3d ? ' on' : ''}`} onClick={() => setView3d((v) => !v)} title="Xem toàn bộ bản đồ dạng 3D"><Icon name={view3d ? 'lucide:map' : 'lucide:box'} /> {view3d ? 'Mặt bằng' : '3D'}</button>
          {view3d && preview && (() => {
            // Rebuilt when the layout changes (not on every slider move).
            const key = `${draft.id}:${draft.base}:${JSON.stringify(draft.model ?? null)}:${draft.parts.length}:${preview.base.length}:${preview.wall.length}:${preview.nature.length}:${preview.heights.length}:${models.length}`;
            return <InfectionMap3D preview={preview} draft={draft} registry={registry} buildKey={key} tool={tool.kind === 'spawn' || tool.kind === 'zombie' ? tool.kind : null}
              onPoint={(kind, p, remove) => patch((d) => { const list = kind === 'spawn' ? d.spawns : d.zombieSpawns; if (remove >= 0) list.splice(remove, 1); else if (p) list.push(p); })} />;
          })()}
          <canvas ref={canvas} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={() => { mouse.current = null; draw(); }} onWheel={onWheel} onContextMenu={(e) => e.preventDefault()} />
          <div className="ix-legend">
            <span><i style={{ background: '#ffb000' }} />Đã đặt ({draft.parts.length})</span>
            <span><i style={{ background: '#3c8c46' }} />Cây, bụi, đá theo seed ({preview?.nature.length ?? 0})</span>
            <span><i style={{ background: '#7fc8ff' }} />Người ({draft.spawns.length || 'tự động'})</span>
            <span><i style={{ background: '#ff3b30' }} />Zombie ({draft.zombieSpawns.length || 'dùng điểm người'})</span>
          </div>
        </div>

        <aside className="ix-panel ix-settings">
          {part && (
            <section className="ix-section ix-selected">
              <h3>{registry.byNumericId(part.asset)?.name ?? part.asset}</h3>
              <div className="ix-xyz">
                {(['x', 'z', 'y'] as const).map((k) => <label key={k}>{k.toUpperCase()}<input type="number" step={.5} value={part[k]} onChange={(e) => setPart((p) => { p[k] = Number(e.target.value); })} /></label>)}
              </div>
              {num('Xoay', Math.round(((part.yaw * 180 / Math.PI) % 360 + 360) % 360), (v) => setPart((p) => { p.yaw = v * Math.PI / 180; }), 0, 359, 1, '°')}
              {part.asset === LIGHT_SOURCE_ASSET
                ? num('Độ sáng', part.scale, (v) => setPart((p) => { p.scale = v; }), .1, 10, .1, '×')
                : num('Tỉ lệ', part.scale, (v) => setPart((p) => { p.scale = v; }), .1, 4, .05, '×')}
              <div className="ix-row">
                <button className="btn" onClick={() => { patch((d) => { const p = d.parts[sel!.index]!; d.parts.push({ ...p, x: p.x + 2, z: p.z + 2 }); }); setSel({ kind: 'part', index: draft.parts.length }); }}><Icon name="lucide:copy" /> Nhân bản</button>
                <button className="btn" onClick={removeSel}><Icon name="lucide:trash" /> Xóa</button>
              </div>
            </section>
          )}
          {sel && sel.kind !== 'part' && <section className="ix-section"><h3>{sel.kind === 'spawn' ? 'Điểm xuất hiện người' : 'Điểm hồi sinh zombie'}</h3><button className="btn" onClick={removeSel}><Icon name="lucide:trash" /> Xóa điểm</button></section>}

          <section className="ix-section">
            <h3>Bản đồ</h3>
            <label className="ix-field"><span>Tên</span><input value={draft.name} onChange={(e) => patch((d) => { d.name = e.target.value; })} maxLength={60} /></label>
            <label className="ix-field"><span>Seed địa hình</span>
              <span className="ix-seed"><input value={draft.seed} onChange={(e) => patch((d) => { d.seed = e.target.value; })} maxLength={60} /><button className="btn" title="Seed ngẫu nhiên" onClick={() => patch((d) => { d.seed = `seed-${uid()}`; })}><Icon name="lucide:dices" /></button></span>
            </label>
            <label className="ix-field"><span>Nền bản đồ</span>
              <select value={draft.base} onChange={(e) => patch((d) => { d.base = e.target.value as InfectionMapDef['base']; })}>
                <option value="empty">Trống (chỉ những gì bạn đặt)</option>
                <option value="warehouse">Warehouse</option>
                <option value="friday13">The Street (cũ)</option>
                <option value="model">Model tải lên (GLB)</option>
              </select>
            </label>
            {draft.base === 'model' && <>
              <label className="ix-field"><span>Model bản đồ</span>
                <select value={draft.model?.asset ?? ''} onChange={(e) => patch((d) => { const asset = Number(e.target.value); d.model = asset ? { asset, scale: d.model?.scale ?? 1, yaw: d.model?.yaw ?? 0, y: d.model?.y ?? 0 } : undefined; })}>
                  <option value="">— chọn model —</option>
                  {models.map((m) => <option key={m.asset} value={m.asset}>{m.name}</option>)}
                </select>
              </label>
              <label className={`btn${uploading ? ' disabled' : ''}`} title="Một file GLB chứa cả bản đồ; va chạm được tính khi tải lên">
                {uploading ? <><Spinner /> Đang tải lên và tính va chạm…</> : <><Icon name="lucide:upload" /> Tải lên file GLB</>}
                <input type="file" accept=".glb" hidden disabled={uploading} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) uploadModel(f); }} />
              </label>
              {draft.model && <>
                {(() => {
                  const b = registry.byNumericId(draft.model.asset)?.bounds;
                  return b ? <p className="ix-hint">Kích thước sau tỉ lệ: rộng ~{(b.radius * 2 * draft.model.scale).toFixed(1)} m · cao {(b.height * draft.model.scale).toFixed(1)} m (nhân vật cao ~1,8 m)</p> : <p className="ix-hint">Model chưa tải được trong Studio.</p>;
                })()}
                <label className="ix-field"><span>Tỉ lệ model<b>{draft.model.scale}×</b></span>
                  <input type="number" min={.001} max={1000} step="any" value={draft.model.scale} onChange={(e) => { const v = Number(e.target.value); if (v > 0) patch((d) => { d.model!.scale = Math.min(1000, Math.max(.001, v)); }); }} /></label>
                {num('Tỉ lệ (kéo nhanh)', draft.model.scale, (v) => patch((d) => { d.model!.scale = v; }), .01, 10, .01, '×')}
                {num('Xoay', Math.round(draft.model.yaw * 180 / Math.PI), (v) => patch((d) => { d.model!.yaw = v * Math.PI / 180; }), -180, 180, 1, '°')}
                {num('Độ cao so với mặt đất', draft.model.y, (v) => patch((d) => { d.model!.y = v; }), -30, 30, .1, ' m')}
                <p className="ix-hint">Bật 3D để so model với nhân vật (cao ~1,8 m) đứng ở các điểm xuất hiện. Đặt điểm trong 3D: chọn công cụ điểm người / zombie rồi nhấp lên sàn.</p>
              </>}
            </>}
            {num('Kích thước (nửa cạnh)', draft.half, (v) => patch((d) => { d.half = v; }), 30, 170, 1, ' m')}
          </section>

          <section className="ix-section">
            <h3>Địa hình</h3>
            {num('Đồi núi trong sân', draft.terrain.hills, (v) => patch((d) => { d.terrain.hills = v; }), 0, 1, .05)}
            {num('Dốc bao quanh', draft.terrain.banks, (v) => patch((d) => { d.terrain.banks = v; }), 0, 80, 1, ' m')}
            <label className="ix-field"><span>Tường bao</span>
              <select value={draft.terrain.wall} onChange={(e) => patch((d) => { d.terrain.wall = e.target.value as InfectionMapDef['terrain']['wall']; })}>
                <option value="none">Không có</option><option value="concrete">Bê tông</option><option value="mossy">Bê tông rêu</option><option value="stone">Gạch đá</option>
              </select>
            </label>
            {draft.terrain.wall !== 'none' && num('Độ cao tường', draft.terrain.wallScale, (v) => patch((d) => { d.terrain.wallScale = v; }), .5, 3, .1, '×')}
          </section>

          <section className="ix-section">
            <h3>Môi trường</h3>
            <label className="ix-field"><span>Mặt đất</span>
              <select value={draft.environment.ground} onChange={(e) => patch((d) => { d.environment.ground = e.target.value as InfectionMapDef['environment']['ground']; })}>
                <option value="dirt">Đất</option><option value="grass">Cỏ</option><option value="gravel">Sỏi</option><option value="sand">Cát</option><option value="asphalt">Nhựa đường</option><option value="snow">Tuyết</option>
              </select>
            </label>
            {num('Cỏ phủ', draft.environment.grass, (v) => patch((d) => { d.environment.grass = v; }), 0, 1, .05)}
            {num('Cây / ha', draft.environment.trees, (v) => patch((d) => { d.environment.trees = v; }), 0, 200, 1)}
            {num('Bụi rậm / ha', draft.environment.bushes, (v) => patch((d) => { d.environment.bushes = v; }), 0, 300, 1)}
            {num('Đá / ha', draft.environment.rocks, (v) => patch((d) => { d.environment.rocks = v; }), 0, 200, 1)}
            {num('Tỉ lệ cây chết', draft.environment.deadTrees, (v) => patch((d) => { d.environment.deadTrees = v; }), 0, 1, .05)}
          </section>

          <section className="ix-section">
            <h3>Ngày & đêm</h3>
            <div className="ix-sky" style={{ background: skyColour(draft.rules.timeOfDay) }}><span>{clockOf(draft.rules.timeOfDay)}</span><small>{(draft.rules.dayCycleMinutes ?? 0) > 0 ? `chu kỳ ${draft.rules.dayCycleMinutes} phút` : 'giờ cố định'}</small></div>
            <div className="ix-row ix-presets">
              {([['Bình minh', 6], ['Trưa', 12], ['Hoàng hôn', 18.5], ['Đêm', 22.5], ['Nửa đêm', 0]] as const).map(([label, h]) => (
                <button key={label} className={`btn${Math.abs(draft.rules.timeOfDay * 24 - h) < .01 ? ' on' : ''}`} onClick={() => patch((d) => { d.rules.timeOfDay = h / 24; })}>{label}</button>
              ))}
            </div>
            {num('Giờ bắt đầu', Math.round(draft.rules.timeOfDay * 24 * 4) / 4, (v) => patch((d) => { d.rules.timeOfDay = (v % 24) / 24; }), 0, 23.75, .25, ' h')}
            {num('Chu kỳ ngày đêm (0 = cố định)', draft.rules.dayCycleMinutes ?? 0, (v) => patch((d) => { d.rules.dayCycleMinutes = v; }), 0, 240, 1, ' phút')}
          </section>

          <section className="ix-section">
            <h3>Luật chơi</h3>
            {RULES.map((r) => num(r.label, (draft.rules[r.key] as number) / (r.scale ?? 1), (v) => patch((d) => { (d.rules[r.key] as number) = Math.round(v * (r.scale ?? 1) * 1000) / 1000; }), r.min, r.max, r.step, r.unit ? ` ${r.unit}` : ''))}
            <button className="btn" onClick={() => patch((d) => { d.rules = { ...DEFAULT_INFECTION_MAP.rules, timeOfDay: d.rules.timeOfDay, dayCycleMinutes: d.rules.dayCycleMinutes }; })}><Icon name="lucide:rotate-ccw" /> Luật mặc định</button>
          </section>
        </aside>
      </div>
      {toast && <div className="studio-toast">{toast}</div>}
    </div>
  );
}
