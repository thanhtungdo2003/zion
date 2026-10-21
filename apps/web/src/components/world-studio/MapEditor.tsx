'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BIOMES, DEFAULT_FLORA, FLORA_SPECIES, eraseFlora, floraGrid, paintFlora, type FloraBrush, type FloraItem,
  DEFAULT_BRUSH, EditHistory, Heightfield, SETTLEMENT_PRESETS, Simplex2, StrokeRecorder, applyBrush, carveLake, carveRiver, checkSettlement, lakeSpillLevel, newId, newRegion, obbCorners, seedNumber,
  serializeMap, stream, validateMap, validateRegion, type BrushSettings, type CellRect, type Circle, type LootCategory, type MapIssue, type Region, type SettlementLayer,
  type SettlementResult, type Vec2, type WorldMapDoc,
} from '@zion/worldgen/editor';
import { ConfirmDialog } from '../ConfirmDialog';
import { Icon } from '../Icon';
import { saveMap, renderThumbnail } from '@/studio/world/map-store';
import { TerrainRaster } from '@/studio/world/raster';
import { JobError, runJob } from '@/studio/world/worker-client';
import { MapCanvas, type HoverInfo, type MapCanvasHandle } from './MapCanvas';
import type { EditorApi } from './editor-api';
import { TerrainPanel } from './TerrainPanel';
import { SettlementPanel } from './SettlementPanel';
import { GameplayPanel } from './GameplayPanel';
import { SettingsPanel } from './SettingsPanel';
import { drawShape, isBrush, isDraw, isFlora, type DrawTool, type EditorTab, type Layers, type Overlay, type Selection, type Tool } from './types';
import s from './world-studio.module.css';

const MapView3D = dynamic(() => import('./MapView3D'), { ssr: false, loading: () => <div className={s.empty3d}>Đang tải chế độ 3D…</div> });

const TABS: Array<{ id: EditorTab; name: string; icon: string }> = [
  { id: 'terrain', name: 'Địa hình', icon: 'mountain' }, { id: 'settlement', name: 'Khu dân cư', icon: 'building-2' },
  { id: 'gameplay', name: 'Gameplay', icon: 'crosshair' }, { id: 'settings', name: 'Thiết lập', icon: 'settings-2' },
];
const RAIL: Record<EditorTab, Array<Array<{ id: Tool; name: string; icon: string; key?: string }>>> = {
  terrain: [
    [{ id: 'select', name: 'Chọn / sửa (V)', icon: 'mouse-pointer-2', key: 'V' }, { id: 'pan', name: 'Kéo bản đồ (H, hoặc giữ Space)', icon: 'hand', key: 'H' }],
    [{ id: 'raise', name: 'Nâng (1)', icon: 'arrow-up-from-line', key: '1' }, { id: 'lower', name: 'Hạ (2)', icon: 'arrow-down-to-line', key: '2' }, { id: 'smooth', name: 'Làm mượt (3)', icon: 'waves', key: '3' },
      { id: 'flatten', name: 'San phẳng (4) — Alt+click lấy độ cao', icon: 'equal', key: '4' }, { id: 'sculpt', name: 'Tạo hình theo mẫu (5)', icon: 'stamp', key: '5' }, { id: 'noise', name: 'Thêm nhiễu (6)', icon: 'sparkles', key: '6' },
      { id: 'erosion', name: 'Xói mòn (7)', icon: 'droplets', key: '7' }, { id: 'paint', name: 'Tô bề mặt (8)', icon: 'paintbrush', key: '8' }],
    [{ id: 'trees', name: 'Vẽ cây / đá (T) — chọn loài ở bảng bên phải', icon: 'trees', key: 'T' }, { id: 'biome', name: 'Vẽ biome (B): bề mặt + cây cối', icon: 'leaf', key: 'B' }],
    [{ id: 'draw-lake', name: 'Vẽ hồ', icon: 'circle-dashed' }, { id: 'draw-river', name: 'Vẽ sông', icon: 'spline' }],
  ],
  settlement: [
    [{ id: 'select', name: 'Chọn / sửa (V)', icon: 'mouse-pointer-2', key: 'V' }, { id: 'pan', name: 'Kéo bản đồ (H)', icon: 'hand', key: 'H' }],
    [{ id: 'draw-region', name: 'Vẽ vùng (R)', icon: 'pentagon', key: 'R' }],
  ],
  gameplay: [
    [{ id: 'select', name: 'Chọn / sửa (V)', icon: 'mouse-pointer-2', key: 'V' }, { id: 'pan', name: 'Kéo bản đồ (H)', icon: 'hand', key: 'H' }],
    [{ id: 'place-playarea', name: 'Đặt tâm vùng chơi', icon: 'locate-fixed' }, { id: 'place-spawn', name: 'Điểm spawn', icon: 'triangle' }, { id: 'draw-spawnzone', name: 'Vùng spawn', icon: 'square-dashed' },
      { id: 'place-loot', name: 'Điểm loot', icon: 'package' }, { id: 'place-rare', name: 'Vùng vật phẩm hiếm', icon: 'gem' }, { id: 'place-hotspot', name: 'Điểm nóng', icon: 'flame' },
      { id: 'draw-nogo', name: 'Vùng cấm', icon: 'ban' }, { id: 'place-poi', name: 'Địa điểm (POI)', icon: 'map-pin' }],
  ],
  settings: [[{ id: 'select', name: 'Chọn (V)', icon: 'mouse-pointer-2', key: 'V' }, { id: 'pan', name: 'Kéo bản đồ (H)', icon: 'hand', key: 'H' }]],
};
const HINTS: Partial<Record<Tool, string>> = {
  select: 'Nhấp để chọn · kéo để di chuyển điểm/công trình · kéo nền để cuộn bản đồ',
  pan: 'Kéo để cuộn · lăn chuột để phóng to',
  'draw-region': 'Nhấp để thêm điểm · kéo điểm để sửa · chuột phải xóa điểm · nhấp điểm đầu / Enter để khép vùng · Esc hủy',
  'draw-lake': 'Nhấp quanh bờ hồ · Enter hoặc nhấp điểm đầu để tạo hồ (mặt nước tự lấy theo bờ thấp nhất)',
  'draw-river': 'Nhấp từ nguồn tới cửa sông · Enter để khắc lòng sông vào địa hình',
  'draw-nogo': 'Vẽ vùng cấm / không thể chơi · Enter để hoàn tất',
  'draw-spawnzone': 'Vẽ vùng spawn · Enter để hoàn tất',
  'place-spawn': 'Nhấp để đặt điểm spawn', 'place-loot': 'Nhấp để đặt điểm loot (loại chọn ở bảng bên phải)',
  'place-hotspot': 'Nhấp để đặt điểm nóng', 'place-poi': 'Nhấp để đặt POI', 'place-rare': 'Nhấp để đặt vùng vật phẩm hiếm', 'place-playarea': 'Nhấp để đặt tâm vùng chơi',
};
const DEFAULT_TOOL: Record<EditorTab, Tool> = { terrain: 'raise', settlement: 'select', gameplay: 'select', settings: 'select' };

interface Job { label: string; value: number; cancel: () => void }

export default function MapEditor({ initial, onExit }: { initial: { doc: WorldMapDoc; terrain: Heightfield }; onExit: () => void }) {
  const [doc, setDocState] = useState(initial.doc);
  const docRef = useRef(doc);
  const setDoc = useCallback((d: WorldMapDoc) => { docRef.current = d; setDocState(d); }, []);
  const terrainRef = useRef(initial.terrain);
  const rasterRef = useRef<TerrainRaster | null>(null);
  rasterRef.current ??= new TerrainRaster(initial.terrain, initial.doc.terrain.seaLevel);
  const [version, setVersion] = useState(0);
  const history = useRef(new EditHistory<WorldMapDoc>());
  const [, setHistoryTick] = useState(0);
  const [tab, setTab] = useState<EditorTab>('terrain');
  const [tool, setToolState] = useState<Tool>('raise');
  const [brush, setBrush] = useState<BrushSettings>({ ...DEFAULT_BRUSH, targetHeight: Math.round(initial.doc.terrain.seaLevel + 10) });
  const [selection, setSelection] = useState<Selection | null>(null);
  const [draft, setDraft] = useState<{ tool: DrawTool; points: Vec2[] } | null>(null);
  const [preview, setPreview] = useState<EditorApi['preview']>(null);
  const [zones, setZones] = useState<Circle[] | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [issues, setIssues] = useState<MapIssue[] | null>(null);
  const [view3d, setView3d] = useState(false);
  const [layers, setLayers] = useState<Layers>({ base: true, water: true, regions: true, buildings: true, props: true, gameplay: true, contours: true });
  const [layersOpen, setLayersOpen] = useState(false);
  const [sideOpen, setSideOpen] = useState(false);
  const [toast, setToast] = useState<{ text: string; error: boolean } | null>(null);
  const [confirm, setConfirm] = useState<{ title: string; message: string; label?: string; run: () => void } | null>(null);
  const [pickPhase, setPickPhase] = useState<number | null>(null);
  const [lootCategory, setLootCategory] = useState<LootCategory>('weapons');
  const [riverWidth, setRiverWidth] = useState(18);
  const [floraBrush, setFlora] = useState<FloraBrush>(DEFAULT_FLORA);
  const [saveState, setSaveState] = useState<'saved' | 'dirty' | 'saving' | 'error'>('saved');
  const changeSeq = useRef(0), savedSeq = useRef(0);
  const canvasRef = useRef<MapCanvasHandle>(null);
  const statusRef = useRef<HTMLSpanElement>(null);
  const alt = useRef(false);
  const lastCommit = useRef<{ key: string; at: number } | null>(null);
  const gameplay = doc.gameplay.find((g) => g.id === doc.activeGameplay);

  const flash = useCallback((text: string, error = false) => {
    setToast({ text, error });
    window.setTimeout(() => setToast((t) => (t?.text === text ? null : t)), error ? 6000 : 3200);
  }, []);
  const touched = useCallback(() => { changeSeq.current++; setSaveState('dirty'); setHistoryTick((t) => t + 1); }, []);
  const bump = useCallback((rect?: CellRect | null) => { rasterRef.current!.update(rect); setVersion((v) => v + 1); }, []);

  /* ----------------------------------------------------------------------- edits */

  const commit = useCallback<EditorApi['commit']>((label, next, opts = {}) => {
    const before = docRef.current, now = performance.now();
    const k = opts.key, last = lastCommit.current;
    if (k && !opts.terrain && last?.key === k && now - last.at < 1500 && history.current.amend(next)) { last.at = now; setDoc(next); touched(); return; }
    history.current.push({ label, doc: { before, after: next }, terrain: opts.terrain });
    lastCommit.current = k ? { key: k, at: now } : null;
    setDoc(next); touched();
  }, [setDoc, touched]);

  const updateRegion = useCallback<EditorApi['updateRegion']>((label, id, fn, key) => {
    const d = docRef.current;
    commit(label, { ...d, regions: d.regions.map((r) => (r.id === id ? fn(r) : r)) }, { key });
  }, [commit]);

  const updateGameplay = useCallback<EditorApi['updateGameplay']>((label, fn, key) => {
    const d = docRef.current, g = d.gameplay.find((x) => x.id === d.activeGameplay);
    if (!g) return;
    const next = structuredClone(g);
    fn(next);
    commit(label, { ...d, gameplay: d.gameplay.map((x) => (x.id === g.id ? next : x)) }, { key });
  }, [commit]);

  /** Settlement items follow the ground when the terrain under them changes. */
  const resettle = useCallback((d: WorldMapDoc, rect: CellRect): WorldMapDoc => {
    const hf = terrainRef.current, c = hf.cell;
    const inside = (x: number, z: number) => x >= rect.i0 * c - 20 && x <= rect.i1 * c + 20 && z >= rect.j0 * c - 20 && z <= rect.j1 * c + 20;
    let changed = false;
    const regions = d.regions.map((r) => {
      if (!r.result || !r.polygon.some(([x, z]) => inside(x, z)) && !inside(r.result.analysis.center[0], r.result.analysis.center[1])) return r;
      const buildings = r.result.buildings.map((b) => (inside(b.obb.x, b.obb.z) ? { ...b, y: [...obbCorners(b.obb), [b.obb.x, b.obb.z] as Vec2].reduce((sum, [x, z]) => sum + hf.heightAt(x, z), 0) / 5 } : b));
      const props = r.result.props.map((p) => (inside(p.x, p.z) ? { ...p, y: hf.heightAt(p.x, p.z) } : p));
      changed = true;
      return { ...r, result: { ...r.result, buildings, props } };
    });
    return changed ? { ...d, regions } : d;
  }, []);

  const terrainOp = useCallback<EditorApi['terrainOp']>((label, op, docChange) => {
    const hf = terrainRef.current, rec = new StrokeRecorder(hf);
    const rect = op(hf);
    if (!rect) { flash('Không có ô địa hình nào thay đổi.'); return; }
    rec.touch(rect);
    const patch = rec.finish()!;
    let next = resettle(docChange ? docChange(docRef.current) : docRef.current, rect);
    if (next === docRef.current) next = { ...next };
    commit(label, next, { terrain: patch });
    bump(rect);
  }, [bump, commit, flash, resettle]);

  const undo = useCallback(() => {
    const e = history.current.undo(terrainRef.current);
    if (!e) return;
    if (e.doc) setDoc(e.doc.before);
    if (e.terrain) bump(e.terrain.before.rect);
    lastCommit.current = null;
    touched(); flash(`Hoàn tác: ${e.label}`);
  }, [bump, flash, setDoc, touched]);
  const redo = useCallback(() => {
    const e = history.current.redo(terrainRef.current);
    if (!e) return;
    if (e.doc) setDoc(e.doc.after);
    if (e.terrain) bump(e.terrain.after.rect);
    touched(); flash(`Làm lại: ${e.label}`);
  }, [bump, flash, setDoc, touched]);

  /* ------------------------------------------------------------------------ save */

  const save = useCallback(async () => {
    if (changeSeq.current === savedSeq.current) return true;
    const seq = changeSeq.current, d = docRef.current, hf = terrainRef.current;
    setSaveState('saving');
    try {
      const meta = { ...d.meta, updatedAt: Date.now(), thumbnail: renderThumbnail(hf, d.terrain.seaLevel) };
      const next = { ...d, meta };
      await saveMap(next, hf);
      // Keep the new metadata without touching history.
      if (docRef.current === d) setDoc(next); else docRef.current = { ...docRef.current, meta: { ...docRef.current.meta, updatedAt: meta.updatedAt, thumbnail: meta.thumbnail } };
      savedSeq.current = seq;
      setSaveState(changeSeq.current === seq ? 'saved' : 'dirty');
      return true;
    } catch (err) {
      setSaveState('error');
      flash(`Không lưu được: ${err instanceof Error ? err.message : String(err)}. Hãy xuất file để giữ bản sao.`, true);
      return false;
    }
  }, [flash, setDoc]);

  // Autosave two seconds after the last change.
  useEffect(() => {
    if (saveState !== 'dirty') return;
    const t = window.setTimeout(() => { void save(); }, 2000);
    return () => window.clearTimeout(t);
  }, [saveState, version, doc, save]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (changeSeq.current !== savedSeq.current) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);
  const exit = useCallback(async () => { if (await save()) onExit(); else setConfirm({ title: 'Chưa lưu được bản đồ', message: 'Thay đổi gần nhất chưa được lưu vào trình duyệt. Thoát vẫn mất các thay đổi đó.', label: 'Thoát không lưu', run: onExit }); }, [onExit, save]);

  const exportFile = useCallback(() => {
    const blob = new Blob([serializeMap(docRef.current, terrainRef.current)], { type: 'application/json' });
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = `${docRef.current.meta.name.replace(/[^\p{L}\p{N}_-]+/gu, '-')}.zion-map.json`; a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
    flash(`Đã xuất ${(blob.size / 1024 / 1024).toFixed(1)} MB.`);
  }, [flash]);

  /* ----------------------------------------------------------------- generation */

  const startJob = useCallback(<T,>(label: string, handle: { promise: Promise<T>; cancel: () => void }) => {
    setJob({ label, value: 0, cancel: handle.cancel });
    return handle.promise.finally(() => setJob(null));
  }, []);

  const generateRegion = useCallback((id: string, from: SettlementLayer) => {
    const d = docRef.current, region = d.regions.find((r) => r.id === id), hf = terrainRef.current;
    if (!region) return;
    const pre = validateRegion(region.polygon, hf.size).filter((i) => i.severity === 'error');
    if (pre.length) { flash(pre.map((i) => i.message).join(' '), true); return; }
    const others = d.regions.filter((r) => r.id !== id && r.result);
    const externalRoads = [...d.base.roads.map((r) => ({ points: r.points, width: r.width })), ...others.flatMap((r) => r.result!.roads.map((q) => ({ points: q.points, width: q.width })))];
    const obstacles = [...d.base.structures, ...others.flatMap((r) => r.result!.buildings.map((b) => b.obb)), ...region.exclusions];
    const previous = preview?.region === id ? preview.result : region.result ?? undefined;
    const handle = runJob<'settlement'>({ kind: 'settlement', input: {
      polygon: region.polygon, seed: region.seed, settings: region.settings, water: d.water, seaLevel: d.terrain.seaLevel, externalRoads, obstacles, previous, from,
      terrain: { size: hf.size, cell: hf.cell, heights: hf.heights.slice().buffer, surface: hf.surface.slice().buffer },
    } }, (label, value) => setJob((j) => (j ? { ...j, label, value } : j)));
    void startJob('Sinh khu vực', handle).then((r) => {
      setPreview({ region: id, result: r.result, from });
      const errors = r.result.issues.filter((i) => i.severity === 'error').length;
      flash(`Bản xem trước: ${r.result.buildings.length} công trình, ${r.result.props.length} vật thể, ${r.result.roads.length} tuyến đường${errors ? ` · ${errors} lỗi` : ''} (${r.result.stats.ms} ms). Duyệt rồi bấm Áp dụng.`, errors > 0);
    }).catch((err: unknown) => { if (!(err instanceof JobError && err.cancelled)) flash(err instanceof Error ? err.message : String(err), true); else flash('Đã hủy sinh khu vực — bản đồ không thay đổi.'); });
  }, [flash, preview, startJob]);

  const applyPreview = useCallback(() => {
    if (!preview) return;
    const p = preview, { grading, ...result } = p.result, d = docRef.current;
    const label = `Áp dụng ${d.regions.find((r) => r.id === p.region)?.name ?? 'khu vực'}`;
    const next: WorldMapDoc = { ...d, regions: d.regions.map((r) => (r.id !== p.region ? r : {
      ...r, result,
      history: [...r.history, { at: Date.now(), from: p.from, seed: r.seed, buildings: result.buildings.length, props: result.props.length, roads: result.roads.length }].slice(-30),
    })) };
    if (grading) {
      // The cut and fill the generator worked on becomes part of the map, in the same undo step.
      const hf = terrainRef.current, before = hf.snapshot(grading.rect);
      hf.restore(grading);
      commit(label, resettle(next, grading.rect), { terrain: { before, after: hf.snapshot(grading.rect) } });
      bump(grading.rect);
    } else commit(label, next);
    setPreview(null); flash(`Đã áp dụng khu vực${grading ? ' và san nền' : ''} (có thể hoàn tác).`);
  }, [bump, commit, flash, preview, resettle]);

  const regenerateTerrain = useCallback(() => {
    const d = docRef.current;
    const handle = runJob<'terrain'>({ kind: 'terrain', settings: d.terrain }, (label, value) => setJob((j) => (j ? { ...j, label, value } : j)));
    void startJob('Sinh địa hình', handle).then((r) => {
      const hf = terrainRef.current;
      if (hf.size !== d.terrain.size) {
        // A new map size: a fresh grid (not undoable cell by cell; the previous file stays until saved).
        const next = new Heightfield(d.terrain.size, d.terrain.cell, new Float32Array(r.heights), new Uint8Array(r.surface));
        terrainRef.current = next; rasterRef.current!.reset(next, d.terrain.seaLevel);
        history.current.clear(); commit('Đổi kích thước bản đồ', { ...d, meta: { ...d.meta, size: d.terrain.size } });
        setVersion((v) => v + 1); canvasRef.current?.fit();
        flash('Đã sinh địa hình với kích thước mới. Lịch sử hoàn tác được làm mới.');
        return;
      }
      terrainOp('Sinh địa hình từ seed', (t) => { t.heights.set(new Float32Array(r.heights)); t.surface.set(new Uint8Array(r.surface)); return { i0: 0, j0: 0, i1: t.cols - 1, j1: t.rows - 1 }; });
      rasterRef.current!.reset(terrainRef.current, d.terrain.seaLevel);
      flash(`Đã sinh địa hình "${d.terrain.seed}" (${d.terrain.preset}). Có thể hoàn tác.`);
    }).catch((err: unknown) => flash(err instanceof Error ? err.message : String(err), !(err instanceof JobError && err.cancelled)));
  }, [commit, flash, startJob, terrainOp]);

  /* --------------------------------------------------------------- brush strokes */

  const stroke = useRef<{ rec: StrokeRecorder; last: Vec2; dirty: CellRect | null; raf: number; timer: number; at: Vec2; before: WorldMapDoc; flora?: FloraItem[]; grid?: ReturnType<typeof floraGrid> } | null>(null);
  const noise = useMemo(() => new Simplex2(seedNumber(doc.meta.seed, 'brush-noise')), [doc.meta.seed]);
  const brushRng = useRef(stream(doc.meta.seed, 'brush'));
  const dab = useCallback((x: number, z: number) => {
    const st = stroke.current;
    if (!st || !isBrush(tool)) return;
    let r: CellRect | null;
    if (isFlora(tool)) {
      // Trees and biomes: plants into the map's flora layer (a biome also paints its ground).
      const d = docRef.current, hf = terrainRef.current;
      st.flora ??= [...d.flora]; st.grid ??= floraGrid(st.flora);
      if (tool === 'trees' && floraBrush.erase) {
        const only = floraBrush.species.length ? new Set(floraBrush.species.flatMap((id) => FLORA_SPECIES.find((q) => q.id === id)?.assets ?? [])) : undefined;
        st.flora = eraseFlora(st.flora, brush, x, z, only); st.grid = undefined;
      } else {
        const biome = BIOMES.find((q) => q.id === floraBrush.biome)!;
        const mix = tool === 'biome' ? biome.mix : floraBrush.species.map((id) => [id, 1] as const);
        st.flora.push(...paintFlora(st.grid, st.flora.length, hf, d.water, d.terrain.seaLevel, brush, mix, tool === 'biome' ? { ...floraBrush, density: biome.density * floraBrush.density / .8 } : floraBrush, x, z, brushRng.current));
      }
      r = tool === 'biome' ? applyBrush(hf, 'paint', { ...brush, surface: BIOMES.find((q) => q.id === floraBrush.biome)!.surface }, x, z, brushRng.current, noise) : null;
      if (!st.raf) st.raf = requestAnimationFrame(() => { const s2 = stroke.current; if (!s2) return; s2.raf = 0; if (s2.dirty) bump(s2.dirty); s2.dirty = null; setDoc({ ...docRef.current, flora: s2.flora ?? docRef.current.flora }); });
      if (!r) return;
    } else r = applyBrush(terrainRef.current, tool, brush, x, z, brushRng.current, noise);
    if (!r) return;
    st.rec.touch(r);
    st.dirty = st.dirty ? { i0: Math.min(st.dirty.i0, r.i0), j0: Math.min(st.dirty.j0, r.j0), i1: Math.max(st.dirty.i1, r.i1), j1: Math.max(st.dirty.j1, r.j1) } : r;
    if (!st.raf) st.raf = requestAnimationFrame(() => { const s2 = stroke.current; if (!s2) return; s2.raf = 0; bump(s2.dirty); s2.dirty = null; });
  }, [brush, bump, floraBrush, noise, setDoc, tool]);
  const onBrush = useCallback((phase: 'start' | 'move' | 'end', x: number, z: number) => {
    if (!isBrush(tool)) return;
    if (phase === 'start') {
      if (tool === 'flatten' && alt.current) { setBrush((b) => ({ ...b, targetHeight: Math.round(terrainRef.current.heightAt(x, z) * 10) / 10 })); flash(`Độ cao san phẳng: ${terrainRef.current.heightAt(x, z).toFixed(1)} m`); return; }
      stroke.current = { rec: new StrokeRecorder(terrainRef.current), last: [x, z], dirty: null, raf: 0, timer: 0, at: [x, z], before: docRef.current };
      dab(x, z);
      // Holding still keeps working (raise, lower, smooth…), like a real brush.
      if (tool !== 'paint' && tool !== 'sculpt' && !isFlora(tool)) stroke.current.timer = window.setInterval(() => { const st = stroke.current; if (st) dab(st.at[0], st.at[1]); }, 90);
      return;
    }
    const st = stroke.current;
    if (!st) return;
    if (phase === 'move') {
      st.at = [x, z];
      const spacing = Math.max(terrainRef.current.cell, brush.radius * (tool === 'sculpt' ? .9 : isFlora(tool) ? .5 : .25));
      const [lx, lz] = st.last, d = Math.hypot(x - lx, z - lz);
      for (let t = spacing; t <= d; t += spacing) dab(lx + (x - lx) * t / d, lz + (z - lz) * t / d);
      if (d >= spacing) st.last = [x, z];
      return;
    }
    window.clearInterval(st.timer); cancelAnimationFrame(st.raf);
    if (st.dirty) bump(st.dirty);
    stroke.current = null;
    if (isFlora(tool)) {
      // One undo step for the whole stroke: the flora layer (and the biome's ground) before and after.
      const after: WorldMapDoc = { ...docRef.current, flora: st.flora ?? docRef.current.flora };
      const fpatch = st.rec.finish();
      history.current.push({ label: tool === 'biome' ? 'Vẽ biome' : floraBrush.erase ? 'Xóa cây' : 'Vẽ cây', doc: { before: st.before, after }, terrain: fpatch ?? undefined });
      lastCommit.current = null; setDoc(after); touched();
      return;
    }
    const patch = st.rec.finish();
    if (!patch) return;
    const names: Record<string, string> = { raise: 'Nâng địa hình', lower: 'Hạ địa hình', smooth: 'Làm mượt', flatten: 'San phẳng', sculpt: 'Tạo hình', noise: 'Thêm nhiễu', erosion: 'Xói mòn', paint: 'Tô bề mặt' };
    const next = resettle(docRef.current, patch.after.rect);
    history.current.push({ label: names[tool]!, terrain: patch, doc: next !== docRef.current ? { before: docRef.current, after: next } : undefined });
    lastCommit.current = null;
    if (next !== docRef.current) setDoc(next);
    touched();
  }, [brush.radius, bump, dab, flash, floraBrush.erase, resettle, setDoc, tool, touched]);

  /* ---------------------------------------------------------- drawing & placing */

  const setTool = useCallback((t: Tool) => { setToolState(t); setDraft(isDraw(t) ? { tool: t, points: [] } : null); setPickPhase(null); }, []);
  const finishDraft = useCallback(() => {
    if (!draft) return;
    const pts = draft.points, shape = drawShape(draft.tool), d = docRef.current, hf = terrainRef.current;
    if (pts.length < (shape === 'river' ? 2 : 3)) { flash(shape === 'river' ? 'Sông cần ít nhất 2 điểm.' : 'Cần ít nhất 3 điểm để khép vùng.', true); return; }
    if (shape === 'region') {
      const problems = validateRegion(pts, hf.size).filter((i) => i.severity === 'error');
      if (problems.length) { flash(problems.map((i) => i.message).join(' '), true); return; }
      const preset = SETTLEMENT_PRESETS[0]!.id;
      const region = newRegion(pts, preset, d.regions.length, `${d.meta.seed}-${d.regions.length + 1}`);
      commit(`Tạo ${region.name}`, { ...d, regions: [...d.regions, region] });
      setSelection({ kind: 'shape', shape: 'region', id: region.id });
      setToolState('select'); setDraft(null);
      flash(`Đã tạo ${region.name}. Chọn preset và bấm "Sinh khu vực".`);
      return;
    }
    if (shape === 'lake') {
      const lake = { id: newId('lake'), name: `Hồ ${d.water.lakes.length + 1}`, polygon: pts, level: 0, depth: 4 };
      lake.level = Math.round((lakeSpillLevel(hf, lake) - .4) * 10) / 10;
      if (lake.level <= d.terrain.seaLevel) { flash('Bờ hồ chạm mực nước biển — hãy vẽ hồ trên đất liền.', true); return; }
      terrainOp(`Tạo ${lake.name}`, (t) => carveLake(t, lake), (doc0) => ({ ...doc0, water: { ...doc0.water, lakes: [...doc0.water.lakes, lake] } }));
      setSelection({ kind: 'shape', shape: 'lake', id: lake.id });
    } else if (shape === 'river') {
      const river = { id: newId('river'), name: `Sông ${d.water.rivers.length + 1}`, depth: 2.5, points: pts.map(([x, z], i) => ({ x, z, width: Math.round(riverWidth * (1 + i / Math.max(1, pts.length - 1) * .5)) })) as Array<{ x: number; z: number; width: number }>, levels: undefined as number[] | undefined };
      let levels: number[] = [];
      terrainOp(`Tạo ${river.name}`, (t) => { const r = carveRiver(t, river); levels = r.levels; return r.rect; }, (doc0) => ({ ...doc0, water: { ...doc0.water, rivers: [...doc0.water.rivers, { ...river, levels }] } }));
      setSelection({ kind: 'shape', shape: 'river', id: river.id });
    } else if (shape === 'nogo') {
      const id = newId('nogo');
      updateGameplay('Thêm vùng cấm', (g) => { g.noGoZones.push({ id, name: `Vùng cấm ${g.noGoZones.length + 1}`, kind: 'no-go', polygon: pts }); });
      setSelection({ kind: 'shape', shape: 'nogo', id });
    } else {
      const id = newId('sz');
      updateGameplay('Thêm vùng spawn', (g) => { g.spawnZones.push({ id, name: `Vùng spawn ${g.spawnZones.length + 1}`, polygon: pts }); });
      setSelection({ kind: 'shape', shape: 'spawnzone', id });
    }
    setDraft({ tool: draft.tool, points: [] });
  }, [commit, draft, flash, riverWidth, terrainOp, updateGameplay]);

  const onPlace = useCallback((x: number, z: number) => {
    const hf = terrainRef.current;
    if (x < 0 || z < 0 || x > hf.size || z > hf.size) { flash('Điểm nằm ngoài bản đồ.', true); return; }
    const rx = Math.round(x * 10) / 10, rz = Math.round(z * 10) / 10;
    if (pickPhase !== null) { const i = pickPhase; updateGameplay(`Đặt tâm phase ${i + 1}`, (g) => { g.phases[i]!.center = [rx, rz]; }); setPickPhase(null); setSelection({ kind: 'phase', index: i }); return; }
    const id = newId(tool.slice(6));
    if (tool === 'place-spawn') updateGameplay('Thêm điểm spawn', (g) => { g.spawnPoints.push({ id, x: rx, z: rz }); });
    else if (tool === 'place-loot') updateGameplay('Thêm điểm loot', (g) => { g.loot.points.push({ id, x: rx, z: rz, category: lootCategory, tier: 1 }); });
    else if (tool === 'place-hotspot') updateGameplay('Thêm điểm nóng', (g) => { g.hotspots.push({ id, name: `Điểm nóng ${g.hotspots.length + 1}`, x: rx, z: rz, radius: 150, danger: 3 }); });
    else if (tool === 'place-poi') updateGameplay('Thêm POI', (g) => { g.pois.push({ id, name: `Địa điểm ${g.pois.length + 1}`, kind: 'poi', x: rx, z: rz, radius: 80 }); });
    else if (tool === 'place-rare') updateGameplay('Thêm vùng hiếm', (g) => { g.loot.rareAreas.push({ id, name: `Vùng hiếm ${g.loot.rareAreas.length + 1}`, x: rx, z: rz, radius: 120 }); });
    else if (tool === 'place-playarea') { updateGameplay('Đặt tâm vùng chơi', (g) => { g.playArea.x = rx; g.playArea.z = rz; }); setSelection({ kind: 'play-area' }); return; }
    else return;
    setSelection({ kind: 'point', point: tool.slice(6) as 'spawn', id });
  }, [flash, lootCategory, pickPhase, tool, updateGameplay]);

  const recheck = useCallback((r: Region, result: SettlementResult): SettlementResult => {
    const d = docRef.current;
    const issues = checkSettlement(result, { polygon: r.polygon, terrain: terrainRef.current, water: d.water, seaLevel: d.terrain.seaLevel, externalRoads: d.base.roads.map((q) => ({ points: q.points, width: q.width })) });
    return { ...result, issues: [...result.issues.filter((i) => !CHECK_CODES.has(i.code)), ...issues] };
  }, []);

  const onMove = useCallback((sel: Selection, x: number, z: number) => {
    const rx = Math.round(x * 10) / 10, rz = Math.round(z * 10) / 10, hf = terrainRef.current;
    if (sel.kind === 'shape' && sel.vertex !== undefined) {
      const v = sel.vertex, d = docRef.current;
      const move = (pts: Vec2[]) => pts.map((p, i) => (i === v ? [rx, rz] as Vec2 : p));
      if (sel.shape === 'region') updateRegion('Sửa đỉnh vùng', sel.id, (r) => ({ ...r, polygon: move(r.polygon) }));
      else if (sel.shape === 'lake') commit('Sửa bờ hồ', { ...d, water: { ...d.water, lakes: d.water.lakes.map((l) => (l.id === sel.id ? { ...l, polygon: move(l.polygon) } : l)) } });
      else if (sel.shape === 'river') commit('Sửa tuyến sông', { ...d, water: { ...d.water, rivers: d.water.rivers.map((l) => (l.id === sel.id ? { ...l, levels: undefined, points: l.points.map((p, i) => (i === v ? { ...p, x: rx, z: rz } : p)) } : l)) } });
      else if (sel.shape === 'nogo') updateGameplay('Sửa vùng cấm', (g) => { const q = g.noGoZones.find((o) => o.id === sel.id); if (q) q.polygon = move(q.polygon); });
      else updateGameplay('Sửa vùng spawn', (g) => { const q = g.spawnZones.find((o) => o.id === sel.id); if (q) q.polygon = move(q.polygon); });
      return;
    }
    if (sel.kind === 'building' || sel.kind === 'prop') {
      updateRegion(sel.kind === 'building' ? 'Di chuyển công trình' : 'Di chuyển vật thể', sel.region, (r) => {
        if (!r.result) return r;
        const shift = <T extends { x: number; z: number; obb: { x: number; z: number } }>(o: T) => { const dx = rx - o.obb.x, dz = rz - o.obb.z; return { ...o, x: o.x + dx, z: o.z + dz, obb: { ...o.obb, x: rx, z: rz }, manual: true }; };
        const result = sel.kind === 'building'
          ? { ...r.result, buildings: r.result.buildings.map((b) => { if (b.id !== sel.id) return b; const m = shift(b); return { ...m, door: [b.door[0] + rx - b.obb.x, b.door[1] + rz - b.obb.z] as Vec2, y: hf.heightAt(rx, rz) }; }) }
          : { ...r.result, props: r.result.props.map((p) => (p.id === sel.id ? { ...shift(p), y: hf.heightAt(rx, rz) } : p)) };
        return { ...r, result: recheck(r, result) };
      });
      return;
    }
    if (sel.kind === 'play-area') updateGameplay('Di chuyển vùng chơi', (g) => { g.playArea.x = rx; g.playArea.z = rz; });
    else if (sel.kind === 'phase') updateGameplay('Di chuyển tâm phase', (g) => { g.phases[sel.index]!.center = [rx, rz]; });
    else if (sel.kind === 'point') updateGameplay('Di chuyển điểm', (g) => {
      const list = (sel.point === 'spawn' ? g.spawnPoints : sel.point === 'poi' ? g.pois : sel.point === 'loot' ? g.loot.points : sel.point === 'hotspot' ? g.hotspots : g.loot.rareAreas) as Array<{ id: string; x: number; z: number }>;
      const q = list.find((o) => o.id === sel.id); if (q) { q.x = rx; q.z = rz; }
    });
  }, [commit, recheck, updateGameplay, updateRegion]);

  const deleteSelection = useCallback((target?: Selection) => {
    const sel = target ?? selection, d = docRef.current;
    if (!sel) return;
    if (sel.kind === 'shape' && sel.vertex !== undefined) {
      const v = sel.vertex, min = sel.shape === 'river' ? 2 : 3;
      const drop = <T,>(pts: T[]) => (pts.length > min ? pts.filter((_, i) => i !== v) : pts);
      if (sel.shape === 'region') updateRegion('Xóa đỉnh vùng', sel.id, (r) => ({ ...r, polygon: drop(r.polygon) }));
      else if (sel.shape === 'lake') commit('Xóa đỉnh hồ', { ...d, water: { ...d.water, lakes: d.water.lakes.map((l) => (l.id === sel.id ? { ...l, polygon: drop(l.polygon) } : l)) } });
      else if (sel.shape === 'river') commit('Xóa điểm sông', { ...d, water: { ...d.water, rivers: d.water.rivers.map((l) => (l.id === sel.id ? { ...l, levels: undefined, points: drop(l.points) } : l)) } });
      setSelection({ ...sel, vertex: undefined });
      return;
    }
    if (sel.kind === 'shape') {
      if (sel.shape === 'region') { const r = d.regions.find((q) => q.id === sel.id); setConfirm({ title: 'Xóa khu vực?', message: `Xóa "${r?.name}" cùng toàn bộ đường, công trình và vật thể đã sinh. Có thể hoàn tác.`, label: 'Xóa khu vực', run: () => { commit(`Xóa ${r?.name}`, { ...docRef.current, regions: docRef.current.regions.filter((q) => q.id !== sel.id) }); if (preview?.region === sel.id) setPreview(null); setSelection(null); } }); return; }
      if (sel.shape === 'lake') commit('Xóa hồ', { ...d, water: { ...d.water, lakes: d.water.lakes.filter((l) => l.id !== sel.id) } });
      if (sel.shape === 'river') commit('Xóa sông', { ...d, water: { ...d.water, rivers: d.water.rivers.filter((l) => l.id !== sel.id) } });
      if (sel.shape === 'nogo') updateGameplay('Xóa vùng cấm', (g) => { g.noGoZones = g.noGoZones.filter((q) => q.id !== sel.id); });
      if (sel.shape === 'spawnzone') updateGameplay('Xóa vùng spawn', (g) => { g.spawnZones = g.spawnZones.filter((q) => q.id !== sel.id); });
    } else if (sel.kind === 'building' || sel.kind === 'prop') {
      updateRegion(sel.kind === 'building' ? 'Xóa công trình' : 'Xóa vật thể', sel.region, (r) => {
        if (!r.result) return r;
        const item = sel.kind === 'building' ? r.result.buildings.find((b) => b.id === sel.id) : r.result.props.find((p) => p.id === sel.id);
        if (!item) return r;
        const result = sel.kind === 'building' ? { ...r.result, buildings: r.result.buildings.filter((b) => b.id !== sel.id) } : { ...r.result, props: r.result.props.filter((p) => p.id !== sel.id) };
        return { ...r, exclusions: [...r.exclusions, item.obb], result: recheck(r, result) };
      });
    } else if (sel.kind === 'point') updateGameplay('Xóa điểm', (g) => {
      if (sel.point === 'spawn') g.spawnPoints = g.spawnPoints.filter((q) => q.id !== sel.id);
      if (sel.point === 'poi') g.pois = g.pois.filter((q) => q.id !== sel.id);
      if (sel.point === 'loot') g.loot.points = g.loot.points.filter((q) => q.id !== sel.id);
      if (sel.point === 'hotspot') g.hotspots = g.hotspots.filter((q) => q.id !== sel.id);
      if (sel.point === 'rare') g.loot.rareAreas = g.loot.rareAreas.filter((q) => q.id !== sel.id);
    });
    else if (sel.kind === 'phase') updateGameplay('Bỏ tâm cố định', (g) => { g.phases[sel.index]!.center = null; });
    else return;
    setSelection(null);
  }, [commit, preview, recheck, selection, updateGameplay, updateRegion]);

  /* ----------------------------------------------------------------- keyboard */

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Alt') alt.current = true;
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); void save().then((ok) => ok && flash('Đã lưu.')); return; }
      if (typing) return;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
      if (mod) return;
      if (e.key === 'Escape') { if (draft?.points.length) setDraft({ ...draft, points: [] }); else if (pickPhase !== null) setPickPhase(null); else setSelection(null); return; }
      if (e.key === 'Enter' && draft) { finishDraft(); return; }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selection) { e.preventDefault(); deleteSelection(); return; }
      if (e.key === '[') setBrush((b) => ({ ...b, radius: Math.max(4, Math.round(b.radius / 1.2)) }));
      if (e.key === ']') setBrush((b) => ({ ...b, radius: Math.min(600, Math.round(b.radius * 1.2)) }));
      const hit = RAIL[tab].flat().find((t) => t.key && t.key.toLowerCase() === e.key.toLowerCase());
      if (hit) setTool(hit.id);
    };
    const up = (e: KeyboardEvent) => { if (e.key === 'Alt') alt.current = false; };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, [deleteSelection, draft, finishDraft, flash, pickPhase, redo, save, selection, setTool, tab, undo]);

  const changeTab = (t: EditorTab) => { setTab(t); setTool(DEFAULT_TOOL[t]); setSelection(null); };
  const onHover = useCallback((h: HoverInfo | null) => {
    if (statusRef.current) statusRef.current.textContent = h ? `X ${h.x.toFixed(0)} · Z ${h.z.toFixed(0)} · cao ${h.height.toFixed(1)} m · ${(h.scale * 100).toFixed(h.scale < .1 ? 1 : 0)}%` : 'X — · Z —';
  }, []);
  const validate = () => {
    const out = validateMap(docRef.current, terrainRef.current);
    setIssues(out);
    flash(`Kiểm tra xong: ${out.filter((i) => i.severity === 'error').length} lỗi, ${out.filter((i) => i.severity === 'warning').length} cảnh báo.`);
  };
  const generate = () => {
    if (tab === 'settlement') {
      const id = selection?.kind === 'shape' && selection.shape === 'region' ? selection.id : selection?.kind === 'building' || selection?.kind === 'prop' ? selection.region : doc.regions.length === 1 ? doc.regions[0]!.id : null;
      if (!id) { flash('Chọn một khu vực (hoặc vẽ vùng mới bằng công cụ Vẽ vùng) rồi bấm Sinh.', true); return; }
      generateRegion(id, 'roads');
    } else if (tab === 'gameplay') flash('Dùng "Mô phỏng vòng bo" trong bảng Gameplay để xem các phase.');
    else setConfirm({ title: 'Sinh lại địa hình?', message: `Thay toàn bộ độ cao và bề mặt bằng địa hình "${doc.terrain.preset}" từ seed "${doc.terrain.seed}". Hồ, sông, khu vực và cấu hình trận vẫn giữ. Có thể hoàn tác.`, label: 'Sinh địa hình', run: regenerateTerrain });
  };

  rasterRef.current.contours = layers.contours;
  useEffect(() => { bump(); }, [layers.contours, bump]);
  // A new sea level recolours the whole map.
  const seaLevel = doc.terrain.seaLevel;
  useEffect(() => { rasterRef.current!.reset(terrainRef.current, seaLevel); setVersion((v) => v + 1); }, [seaLevel]);

  const overlay: Overlay = useMemo(() => ({
    preview: preview ? { region: preview.region, result: preview.result } : null,
    zones, draft,
    markers: (issues ?? []).filter((i) => i.x !== undefined && i.severity !== 'info').slice(0, 300).map((i) => ({ x: i.x!, z: i.z!, severity: i.severity })),
    brush: isBrush(tool) ? brush : null,
  }), [brush, draft, issues, preview, tool, zones]);

  const api: EditorApi = {
    doc, terrain: terrainRef.current, gameplay, tool, setTool, brush, setBrush, selection, setSelection, removeSelection: deleteSelection, commit, updateRegion, updateGameplay, terrainOp,
    generateRegion, preview, applyPreview, discardPreview: () => { setPreview(null); flash('Đã bỏ bản xem trước.'); }, regenerateTerrain, zones, setZones,
    pickPhase, setPickPhase, lootCategory, setLootCategory, flora: floraBrush, setFlora, riverWidth, setRiverWidth, busy: !!job, flash,
    centerOn: (x, z, span) => canvasRef.current?.centerOn(x, z, span),
    confirm: (title, message, run, label) => setConfirm({ title, message, run, label }),
  };
  const counts = { regions: doc.regions.length, buildings: doc.regions.reduce((n, r) => n + (r.result?.buildings.length ?? 0), 0), props: doc.regions.reduce((n, r) => n + (r.result?.props.length ?? 0), 0) };
  const hint = pickPhase !== null ? `Nhấp bản đồ để đặt tâm phase ${pickPhase + 1} · Esc hủy` : HINTS[tool] ?? (isBrush(tool) ? 'Giữ chuột trái và kéo để chỉnh · [ ] đổi bán kính · chuột phải / Space kéo bản đồ' : '');

  return <div className={s.studio} data-testid="world-editor">
    <header className={s.top}>
      <button className={s.back} onClick={() => void exit()} title="Về danh sách bản đồ" data-testid="back"><Icon name="lucide:arrow-left" /></button>
      <div className={s.mapTitle}>
        <strong data-testid="map-name">{doc.meta.name}</strong>
        <small><i className={`${s.dot} ${saveState === 'dirty' ? s.dirty : saveState === 'saving' ? s.busy : ''}`} style={saveState === 'error' ? { background: 'var(--danger)' } : undefined} />
          <span data-testid="save-state">{saveState === 'saved' ? 'Đã lưu' : saveState === 'saving' ? 'Đang lưu…' : saveState === 'error' ? 'Lỗi lưu' : 'Chưa lưu'}</span> · {doc.meta.size} m</small>
      </div>
      <nav className={s.tabs}>{TABS.map((t) => <button key={t.id} className={`${s.tab} ${tab === t.id ? s.on : ''}`} onClick={() => changeTab(t.id)} data-testid={`tab-${t.id}`}><Icon name={`lucide:${t.icon}`} /><span>{t.name}</span></button>)}</nav>
      <div className={s.spacer} />
      <button className={s.tbtn} onClick={undo} disabled={!history.current.canUndo} title={`Hoàn tác${history.current.undoLabel ? `: ${history.current.undoLabel}` : ''} (Ctrl+Z)`} data-testid="undo"><Icon name="lucide:undo-2" /><span className={s.hideNarrow}>Hoàn tác</span></button>
      <button className={s.tbtn} onClick={redo} disabled={!history.current.canRedo} title={`Làm lại${history.current.redoLabel ? `: ${history.current.redoLabel}` : ''} (Ctrl+Shift+Z)`} data-testid="redo"><Icon name="lucide:redo-2" /></button>
      <span className={s.sep} />
      <button className={`${s.tbtn} ${s.primary}`} onClick={generate} disabled={!!job || tab === 'gameplay'} title="Sinh theo tab hiện tại" data-testid="generate"><Icon name="lucide:wand-sparkles" /><span>Sinh</span></button>
      <button className={`${s.tbtn} ${view3d ? s.on : ''}`} onClick={() => setView3d(!view3d)} title="Xem trước 3D" data-testid="toggle-3d"><Icon name="lucide:box" /><span>{view3d ? '2D' : '3D'}</span></button>
      <button className={`${s.tbtn} ${issues ? s.on : ''}`} onClick={validate} title="Kiểm tra toàn bản đồ" data-testid="validate"><Icon name="lucide:shield-check" /><span>Kiểm tra</span></button>
      <button className={s.tbtn} onClick={() => void save().then((ok) => ok && flash('Đã lưu vào trình duyệt.'))} title="Lưu (Ctrl+S)" data-testid="save"><Icon name="lucide:save" /><span>Lưu</span></button>
      <button className={s.tbtn} onClick={exportFile} title="Xuất file bản đồ" data-testid="export"><Icon name="lucide:download" /><span className={s.hideNarrow}>Xuất</span></button>
      <button className={`${s.tbtn} ${s.onlyNarrow}`} onClick={() => setSideOpen(!sideOpen)} title="Bảng thông số"><Icon name="lucide:panel-right" /></button>
    </header>

    <nav className={s.rail} aria-label="Công cụ">
      {RAIL[tab].map((group, gi) => <div key={gi} style={{ display: 'contents' }}>
        {gi > 0 && <span className={s.railGroup} />}
        {group.map((t) => <button key={t.id} className={`${s.tool} ${tool === t.id ? s.on : ''}`} onClick={() => setTool(t.id)} title={t.name} aria-label={t.name} aria-pressed={tool === t.id} data-testid={`tool-${t.id}`}><Icon name={`lucide:${t.icon}`} />{t.key && <kbd>{t.key}</kbd>}</button>)}
      </div>)}
    </nav>

    <main className={s.view}>
      {view3d
        ? <MapView3D terrain={terrainRef.current} doc={doc} version={version} tool={tool} brush={brush} onBrush={onBrush} preview={preview?.result} />
        : <MapCanvas ref={canvasRef} terrain={terrainRef.current} raster={rasterRef.current} version={version} doc={doc} gameplay={gameplay} overlay={overlay} layers={layers} tool={tool} selection={selection}
          onBrush={onBrush} onPlace={onPlace} onDraft={(points) => draft && setDraft({ ...draft, points })} onDraftFinish={finishDraft} onSelect={setSelection} onMove={onMove} onHover={onHover} />}
      {hint && <div className={s.hint}>{hint}</div>}
      <div className={s.viewTools}>
        {!view3d && <>
          <button onClick={() => canvasRef.current?.zoom(1.4)} title="Phóng to" aria-label="Phóng to"><Icon name="lucide:plus" /></button>
          <button onClick={() => canvasRef.current?.zoom(1 / 1.4)} title="Thu nhỏ" aria-label="Thu nhỏ"><Icon name="lucide:minus" /></button>
          <button onClick={() => canvasRef.current?.fit()} title="Xem toàn bản đồ" aria-label="Xem toàn bản đồ"><Icon name="lucide:maximize" /></button>
        </>}
        <button className={layersOpen ? s.on : ''} onClick={() => setLayersOpen(!layersOpen)} title="Lớp hiển thị" aria-label="Lớp hiển thị" data-testid="layers"><Icon name="lucide:layers" /></button>
      </div>
      {layersOpen && <div className={s.layersMenu}>{([['contours', 'Đường đồng mức'], ['water', 'Sông hồ'], ['base', 'Đường & công trình gốc'], ['regions', 'Khu vực'], ['buildings', 'Công trình'], ['props', 'Cây & vật thể'], ['gameplay', 'Gameplay']] as const).map(([k, name]) =>
        <label key={k}><input type="checkbox" checked={layers[k]} onChange={(e) => setLayers({ ...layers, [k]: e.target.checked })} />{name}</label>)}</div>}
      {issues && <div className={s.issuesPanel}>
        <div className={s.issuesHead}><strong>Kiểm tra bản đồ</strong><button className={s.iconBtn} onClick={() => setIssues(null)} aria-label="Đóng"><Icon name="lucide:x" /></button></div>
        <div className={s.issuesList} data-testid="issues">{issues.length === 0 && <p className={s.lead} style={{ padding: 8 }}>Không có vấn đề nào.</p>}
          {issues.map((i, k) => <button key={k} className={s.issue} onClick={() => { if (i.x !== undefined) canvasRef.current?.centerOn(i.x, i.z!, 300); }}>
            <Icon name={i.severity === 'error' ? 'lucide:circle-x' : i.severity === 'warning' ? 'lucide:triangle-alert' : 'lucide:info'} className={s[`sev-${i.severity}`]} /><span>{i.message}</span></button>)}</div>
      </div>}
      {job && <div className={s.jobBox} role="status" data-testid="job"><strong>{job.label}</strong><div className={s.bar}><i style={{ width: `${Math.round(job.value * 100)}%` }} /></div>
        <div className={s.btnRow}><span className={s.lead} style={{ flex: 1 }}>{Math.round(job.value * 100)}% · chạy nền, giao diện vẫn dùng được</span><button className={s.btn} onClick={job.cancel} data-testid="cancel-job"><Icon name="lucide:square" />Hủy</button></div></div>}
      {toast && <div className={`${s.toast} ${toast.error ? s.error : ''}`} role="status" data-testid="toast">{toast.text}</div>}
    </main>

    <aside className={`${s.side} ${sideOpen ? s.open : ''}`} aria-label="Thông số">
      <div className={s.sideScroll}>
        {tab === 'terrain' && <TerrainPanel api={api} />}
        {tab === 'settlement' && <SettlementPanel api={api} />}
        {tab === 'gameplay' && <GameplayPanel api={api} />}
        {tab === 'settings' && <SettingsPanel api={api} />}
      </div>
    </aside>

    <footer className={s.status}>
      <span ref={statusRef}>X — · Z —</span>
      <span>Khu vực <b>{counts.regions}</b></span><span>Công trình <b>{counts.buildings}</b></span><span>Vật thể <b>{counts.props}</b></span>
      <span>Hồ <b>{doc.water.lakes.length}</b> · Sông <b>{doc.water.rivers.length}</b></span>
      <span className={s.hideNarrow}>Lịch sử <b>{history.current.size}</b></span>
      <span className={s.spacer} />
      <span className={s.hideNarrow}>Seed <b>{doc.terrain.seed}</b></span>
    </footer>
    {confirm && <ConfirmDialog title={confirm.title} message={confirm.message} confirmLabel={confirm.label} onCancel={() => setConfirm(null)} onConfirm={() => { const run = confirm.run; setConfirm(null); run(); }} />}
  </div>;
}

const CHECK_CODES = new Set(['overlap', 'on-road', 'outside', 'on-water', 'no-access', 'door-blocked', 'disconnected', 'summary']);
